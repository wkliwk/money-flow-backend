import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import Anthropic from '@anthropic-ai/sdk';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(protect);

// In-memory rate limiter: userId -> timestamps of requests in the last hour
const parseTimestamps = new Map<string, number[]>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const times = (parseTimestamps.get(userId) ?? []).filter((t) => t > cutoff);
  if (times.length >= RATE_LIMIT) return true;
  times.push(now);
  parseTimestamps.set(userId, times);
  return false;
}

const CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Entertainment',
  'Health',
  'Utilities',
  'Groceries',
  'Travel',
  'Education',
  'Dining',
  'Subscriptions',
  'Housing',
  'Insurance',
  'Personal Care',
  'Other',
];

const SUBCATEGORIES: Record<string, string[]> = {
  Food: ['Fast Food', 'Restaurant', 'Cafe', 'Bakery', 'Street Food', 'Other'],
  Transport: ['Bus', 'MTR', 'Taxi', 'Uber', 'Ferry', 'Parking', 'Fuel', 'Other'],
  Shopping: ['Clothing', 'Electronics', 'Books', 'Home', 'Sports', 'Beauty', 'Other'],
  Entertainment: ['Cinema', 'Concert', 'Sports', 'Games', 'Streaming', 'Other'],
  Health: ['Pharmacy', 'Doctor', 'Gym', 'Dental', 'Vision', 'Other'],
  Utilities: ['Electricity', 'Water', 'Gas', 'Internet', 'Phone', 'Other'],
  Groceries: ['Supermarket', 'Wet Market', 'Convenience Store', 'Online', 'Other'],
  Travel: ['Flights', 'Hotel', 'Tour', 'Visa', 'Other'],
  Education: ['Tuition', 'Books', 'Course', 'Exam', 'Other'],
  Dining: ['Lunch', 'Dinner', 'Breakfast', 'Brunch', 'Drinks', 'Other'],
  Subscriptions: ['Streaming', 'Software', 'Membership', 'Other'],
  Housing: ['Rent', 'Mortgage', 'Maintenance', 'Furniture', 'Other'],
  Insurance: ['Life', 'Health', 'Car', 'Home', 'Other'],
  'Personal Care': ['Haircut', 'Skincare', 'Spa', 'Other'],
  Other: ['Other'],
};

const PARSE_PROMPT = `You are a financial transaction parser for a Hong Kong expense tracking app.
Parse the user's natural language text (which may be in Cantonese, English, or a mix) and extract structured transaction data.

Today's date is: {TODAY}

Return ONLY a valid JSON object with exactly these fields:
- merchant: string | null (merchant or vendor name, translated to English if in Chinese)
- amount: number | null (numeric amount, null if not mentioned)
- currency: string (3-letter ISO code; default HKD unless specified; common: HKD, USD, CNY, JPY)
- category: string (must be one of: ${CATEGORIES.join(', ')})
- subcategory: string | null (subcategory within the category, or null if unclear)
- participants: string[] (other people mentioned as sharing the expense, e.g. ["Casey"]; empty array if none)
- date: string | null (ISO 8601 YYYY-MM-DD; use today if "today"/"今日", infer from context, null if truly unknown)
- notes: string | null (brief English description of what was purchased)
- confidence: number (0.0–1.0; high if amount+merchant+date all found, lower if any are missing)
- missing_fields: string[] (list of field names that could not be determined, e.g. ["amount", "date"])

Rules:
- Cantonese: 食 = eat/food, 買 = buy, 搭 = take (transport), 去 = go, 今日 = today, 聽日 = tomorrow, 尋日/噚日 = yesterday
- Common HK merchants: 麥當勞 = McDonald's, 肯德基 = KFC, 大家樂 = Café de Coral, 大快活 = Fairwood, 美心 = Maxim's, 惠康 = Wellcome, 百佳 = ParknShop, 759阿信屋 = 759 Store, 莎莎 = Sa Sa, 屈臣氏 = Watsons
- $ without currency prefix defaults to HKD in HK context
- If multiple items, sum them or pick the total; note items in notes field
- missing_fields should only list: merchant, amount, currency, date (do not list fields with defaults like participants)

Return ONLY the JSON object, no explanation.`;

interface ParsedTransaction {
  merchant: string | null;
  amount: number | null;
  currency: string;
  category: string;
  subcategory: string | null;
  participants: string[];
  date: string | null;
  notes: string | null;
  confidence: number;
  missing_fields: string[];
}

function sanitiseResult(raw: Record<string, unknown>): ParsedTransaction {
  const merchant = typeof raw.merchant === 'string' ? raw.merchant : null;
  const amount = typeof raw.amount === 'number' && raw.amount > 0 ? raw.amount : null;
  const currency = typeof raw.currency === 'string' && raw.currency.length === 3 ? raw.currency.toUpperCase() : 'HKD';
  const category = typeof raw.category === 'string' && CATEGORIES.includes(raw.category) ? raw.category : 'Other';
  const subcategory = typeof raw.subcategory === 'string' ? raw.subcategory : null;
  const participants = Array.isArray(raw.participants)
    ? (raw.participants as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const notes = typeof raw.notes === 'string' ? raw.notes : null;
  const confidence =
    typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.5;
  const missing_fields = Array.isArray(raw.missing_fields)
    ? (raw.missing_fields as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];

  // Validate subcategory against known subcategories for this category
  const validSubs = SUBCATEGORIES[category] ?? [];
  const resolvedSubcategory =
    subcategory && validSubs.includes(subcategory) ? subcategory : null;

  return { merchant, amount, currency, category, subcategory: resolvedSubcategory, participants, date, notes, confidence, missing_fields };
}

const parseTextValidation = [
  body('text')
    .isString()
    .withMessage('text must be a string')
    .trim()
    .notEmpty()
    .withMessage('text is required')
    .isLength({ max: 1000 })
    .withMessage('text must not exceed 1000 characters'),
  body('locale')
    .optional()
    .isString()
    .withMessage('locale must be a string')
    .isIn(['zh-HK', 'en', 'zh-CN'])
    .withMessage('locale must be one of: zh-HK, en, zh-CN'),
];

// POST /api/transactions/parse-text
router.post('/parse-text', parseTextValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  const userId = req.userId!;

  if (isRateLimited(userId)) {
    res.status(429).json({ error: 'Rate limit exceeded. Maximum 30 parses per hour.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Text parsing is not configured' });
    return;
  }

  const { text } = req.body as { text: string; locale?: string };
  const today = new Date().toISOString().split('T')[0];
  const prompt = PARSE_PROMPT.replace('{TODAY}', today);

  const client = new Anthropic({ apiKey });

  let rawText: string;
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nText to parse: "${text}"`,
        },
      ],
    });

    const block = message.content[0];
    rawText = block.type === 'text' ? block.text : '';
  } catch (err) {
    console.error('Claude API error:', err);
    res.status(422).json({ error: 'Could not parse transaction text' });
    return;
  }

  let parsed: ParsedTransaction;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    parsed = sanitiseResult(raw);
  } catch {
    res.status(422).json({ error: 'Could not parse transaction text' });
    return;
  }

  res.json(parsed);
});

export default router;
