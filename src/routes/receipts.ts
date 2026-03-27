import { Router, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(protect);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and HEIC images are accepted'));
    }
  },
});

const scanRateLimit = new Map<string, number[]>();

const checkScanRateLimit = (userId: string): boolean => {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const timestamps = (scanRateLimit.get(userId) || []).filter((t) => now - t < hour);
  if (timestamps.length >= 10) return false;
  timestamps.push(now);
  scanRateLimit.set(userId, timestamps);
  return true;
};

const EXTRACTION_PROMPT = `You are a receipt data extractor. Analyze this receipt image and extract the following fields as JSON:

{
  "amount": <total amount as a number>,
  "description": "<brief description of the purchase>",
  "category": "<suggest one: Food, Transport, Shopping, Entertainment, Bills, Health, Education, Travel, Other>",
  "date": "<date in YYYY-MM-DD format>",
  "merchant": "<store/merchant name>",
  "currency": "<3-letter currency code, e.g. HKD, USD, TWD>",
  "confidence": "<high if all fields clearly extracted, medium if some guessed, low if many unclear>"
}

Rules:
- Extract the TOTAL amount (not subtotal)
- If the receipt is in Chinese (Traditional or Simplified), still extract all fields
- If a field cannot be determined, use null
- Return ONLY valid JSON, no other text`;

// POST /api/receipts/scan
router.post('/scan', upload.single('receipt'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No receipt image provided' });
    return;
  }

  if (!req.userId || !checkScanRateLimit(req.userId)) {
    res.status(429).json({ error: 'Rate limit exceeded. Max 10 scans per hour.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Receipt scanning not configured' });
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const base64Image = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype === 'image/heic' || req.file.mimetype === 'image/heif'
      ? 'image/jpeg' as const
      : req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Image },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      res.status(422).json({ error: 'Could not extract data from receipt' });
      return;
    }

    const parsed = JSON.parse(textBlock.text);
    res.json(parsed);
  } catch {
    res.status(422).json({ error: 'Could not extract data from receipt' });
  }
});

export default router;
