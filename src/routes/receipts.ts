import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(protect);

// In-memory rate limiter: userId -> timestamps of scans in the last hour
const scanTimestamps = new Map<string, number[]>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const times = (scanTimestamps.get(userId) ?? []).filter((t) => t > cutoff);
  if (times.length >= RATE_LIMIT) return true;
  times.push(now);
  scanTimestamps.set(userId, times);
  return false;
}

const ACCEPTED_MIMETYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIMETYPES.includes(file.mimetype) || file.originalname.match(/\.(jpg|jpeg|png|heic|heif)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and HEIC images are accepted'));
    }
  },
});

const CATEGORIES = [
  'Food', 'Transport', 'Shopping', 'Entertainment', 'Health',
  'Utilities', 'Groceries', 'Travel', 'Education', 'Dining',
  'Subscriptions', 'Housing', 'Insurance', 'Personal Care', 'Other',
];

const EXTRACTION_PROMPT = `You are a receipt data extraction assistant. Extract transaction data from this receipt image.

The receipt may be in English or Traditional Chinese (繁體中文).

Return ONLY a valid JSON object with these fields:
- amount: number (total amount paid, required)
- description: string (short description of purchase, e.g. "Grocery shopping at ParknShop")
- merchant: string | null (store/merchant name)
- date: string | null (ISO 8601 date YYYY-MM-DD, or null if not found)
- category: string (best matching category from: ${CATEGORIES.join(', ')})
- currency: string (3-letter ISO currency code, e.g. HKD, USD, CNY — default to HKD if unclear)

Rules:
- amount must be the final total paid (including tax, excluding tips if itemised separately)
- For Traditional Chinese receipts, translate merchant and description to English
- If amount cannot be determined, return null for amount
- Return ONLY the JSON object, no explanation`;

function computeConfidence(data: {
  amount: number | null;
  date: string | null;
  merchant: string | null;
  description: string | null;
}): 'high' | 'medium' | 'low' {
  if (data.amount && data.date && data.merchant) return 'high';
  if (data.amount && (data.date || data.merchant)) return 'medium';
  return 'low';
}

function resolveMediaType(mimetype: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (mimetype === 'image/png') return 'image/png';
  // HEIC/HEIF are JPEG-compatible containers — pass as jpeg; Claude will attempt to process
  return 'image/jpeg';
}

// POST /api/receipts/scan
router.post('/scan', (req: Request, res: Response, next: NextFunction) => {
  upload.single('image')(req, res, (err) => {
    if (err instanceof MulterError) {
      res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large. Maximum size is 10MB.' : err.message });
      return;
    }
    if (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    next();
  });
}, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No image uploaded' });
    return;
  }

  const userId = req.userId!;

  if (isRateLimited(userId)) {
    res.status(429).json({ error: 'Rate limit exceeded. Maximum 10 scans per hour.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Receipt scanning is not configured' });
    return;
  }

  const client = new Anthropic({ apiKey });
  const imageBase64 = req.file.buffer.toString('base64');
  const mediaType = resolveMediaType(req.file.mimetype);

  let rawText: string;
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const block = message.content[0];
    rawText = block.type === 'text' ? block.text : '';
  } catch (err) {
    console.error('Claude API error:', err);
    res.status(422).json({ error: 'Could not extract data from receipt' });
    return;
  }

  let extracted: {
    amount: number | null;
    description: string | null;
    merchant: string | null;
    date: string | null;
    category: string;
    currency: string;
  };

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    extracted = JSON.parse(jsonMatch[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not extract data from receipt';
    res.status(422).json({ error: message });
    return;
  }

  if (extracted.amount === null || extracted.amount === undefined) {
    res.status(422).json({ error: 'Could not extract data from receipt' });
    return;
  }

  const confidence = computeConfidence(extracted);

  res.json({
    amount: extracted.amount,
    description: extracted.description ?? null,
    category: extracted.category ?? 'Other',
    date: extracted.date ?? null,
    merchant: extracted.merchant ?? null,
    currency: extracted.currency ?? 'HKD',
    confidence,
  });
});

export default router;
