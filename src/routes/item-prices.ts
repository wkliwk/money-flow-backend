import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import ItemPriceModel from '../models/ItemPrice';

const router = Router();
router.use(protect);

interface LineItem {
  itemName: string;
  price: number;
  currency?: string;
}

interface ExtractBody {
  merchant: string;
  items: LineItem[];
  receiptDate?: string;
}

const extractValidation = [
  body('merchant')
    .isString()
    .withMessage('merchant must be a string')
    .trim()
    .notEmpty()
    .withMessage('merchant is required')
    .isLength({ max: 200 })
    .withMessage('merchant must not exceed 200 characters'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('items must be a non-empty array'),
  body('items.*.itemName')
    .isString()
    .withMessage('each item must have a string itemName')
    .trim()
    .notEmpty()
    .withMessage('itemName must not be empty')
    .isLength({ max: 300 })
    .withMessage('itemName must not exceed 300 characters'),
  body('items.*.price')
    .isFloat({ min: 0 })
    .withMessage('each item price must be a non-negative number'),
  body('items.*.currency')
    .optional()
    .isString()
    .withMessage('currency must be a string')
    .isLength({ min: 3, max: 3 })
    .withMessage('currency must be a 3-letter ISO code'),
  body('receiptDate')
    .optional()
    .isISO8601()
    .withMessage('receiptDate must be a valid ISO 8601 date'),
];

// POST /api/item-prices/extract
// Extracts line items from a receipt scan and upserts them into the price index.
router.post('/extract', extractValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  const userId = req.userId!;
  const { merchant, items, receiptDate } = req.body as ExtractBody;
  const seenDate = receiptDate ? new Date(receiptDate) : new Date();
  const normalizedMerchant = merchant.trim();

  const upserted: string[] = [];

  try {
    for (const item of items) {
      const normalizedItemName = item.itemName.trim();
      const currency = (item.currency ?? 'HKD').toUpperCase();

      await ItemPriceModel.findOneAndUpdate(
        { userId, merchant: normalizedMerchant, itemName: normalizedItemName },
        {
          $set: {
            price: item.price,
            currency,
            lastSeen: seenDate,
          },
          $push: {
            priceHistory: { price: item.price, date: seenDate },
          },
          $inc: { occurrences: 1 },
          $setOnInsert: {
            userId,
            merchant: normalizedMerchant,
            itemName: normalizedItemName,
          },
        },
        { upsert: true, new: true }
      );

      upserted.push(normalizedItemName);
    }

    res.status(200).json({ stored: upserted.length, merchant: normalizedMerchant });
  } catch (err) {
    console.error('item-prices extract error:', err);
    res.status(500).json({ error: 'Failed to store item prices' });
  }
});

const lookupValidation = [
  query('merchant')
    .optional()
    .isString()
    .withMessage('merchant must be a string')
    .trim()
    .notEmpty()
    .withMessage('merchant must not be empty'),
  query('item')
    .optional()
    .isString()
    .withMessage('item must be a string')
    .trim()
    .notEmpty()
    .withMessage('item must not be empty'),
];

// GET /api/item-prices?merchant=X&item=Y
// Looks up the latest known price for a given merchant + item pair.
router.get('/', lookupValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  const userId = req.userId!;
  const { merchant, item } = req.query as { merchant?: string; item?: string };

  const filter: Record<string, unknown> = { userId };
  if (merchant) filter.merchant = merchant.trim();
  if (item) filter.itemName = item.trim();

  try {
    const results = await ItemPriceModel.find(filter)
      .select('merchant itemName price currency lastSeen occurrences')
      .sort({ lastSeen: -1 })
      .lean();

    res.json(results);
  } catch (err) {
    console.error('item-prices lookup error:', err);
    res.status(500).json({ error: 'Failed to fetch item prices' });
  }
});

const suggestValidation = [
  query('merchant')
    .isString()
    .withMessage('merchant must be a string')
    .trim()
    .notEmpty()
    .withMessage('merchant is required'),
];

// GET /api/item-prices/suggest?merchant=X
// Returns all known items and latest prices at a given merchant.
router.get('/suggest', suggestValidation, async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  const userId = req.userId!;
  const merchant = (req.query.merchant as string).trim();

  try {
    const items = await ItemPriceModel.find({ userId, merchant })
      .select('itemName price currency lastSeen occurrences')
      .sort({ occurrences: -1, lastSeen: -1 })
      .lean();

    res.json({ merchant, items });
  } catch (err) {
    console.error('item-prices suggest error:', err);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

export default router;
