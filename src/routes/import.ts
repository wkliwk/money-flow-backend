import { Router, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(protect);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,$\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// POST /api/import/expenses
router.post('/expenses', upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ message: 'No file uploaded' });
    return;
  }

  let rows: Record<string, string>[];
  try {
    rows = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (e) {
    res.status(400).json({ message: 'Failed to parse CSV', detail: String(e) });
    return;
  }

  const owner = req.userId!;
  let imported = 0;
  let skipped = 0;
  const errors: { row: number; reason: string }[] = [];
  const toInsert: object[] = [];

  // Normalise header names to lowercase
  const normalize = (r: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    Object.entries(r).forEach(([k, v]) => { out[k.toLowerCase().trim()] = v; });
    return out;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = normalize(rows[i]);
    const rowNum = i + 2; // 1-indexed, +1 for header

    const dateRaw = row['date'] || row['transaction date'] || row['txn date'] || '';
    const descRaw = row['description'] || row['memo'] || row['name'] || '';
    const amountRaw = row['amount'] || row['debit'] || '';
    const categoryRaw = row['category'] || '';
    const typeRaw = (row['type'] || '').toLowerCase();
    const notesRaw = row['notes'] || row['note'] || '';

    if (!dateRaw || !amountRaw) {
      errors.push({ row: rowNum, reason: 'Missing required fields: date, amount' });
      skipped++;
      continue;
    }

    const date = parseDate(dateRaw);
    if (!date) {
      errors.push({ row: rowNum, reason: `Unparseable date: "${dateRaw}"` });
      skipped++;
      continue;
    }

    const amount = parseAmount(amountRaw);
    if (amount === null) {
      errors.push({ row: rowNum, reason: `Unparseable amount: "${amountRaw}"` });
      skipped++;
      continue;
    }

    // Infer type from amount sign or explicit type column
    const absAmount = Math.abs(amount);
    let type: string;
    if (typeRaw === 'income' || typeRaw === 'credit') {
      type = 'income';
    } else if (typeRaw === 'expense' || typeRaw === 'debit') {
      type = 'expense';
    } else {
      type = amount >= 0 ? 'income' : 'expense';
    }

    // Duplicate detection: same owner + date + description + amount
    const exists = await ExpenseModel.exists({
      owner,
      date: { $gte: new Date(date.getTime() - 1000), $lte: new Date(date.getTime() + 1000) },
      description: descRaw,
      amount: absAmount,
    });

    if (exists) {
      skipped++;
      continue;
    }

    toInsert.push({
      owner,
      date,
      description: descRaw,
      amount: absAmount,
      type,
      category: categoryRaw || 'Other',
      notes: notesRaw || undefined,
    });
    imported++;
  }

  if (toInsert.length > 0) {
    await ExpenseModel.insertMany(toInsert);
  }

  res.json({ imported, skipped, errors });
});

export default router;
