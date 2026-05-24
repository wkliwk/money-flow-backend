import { Router, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import Anthropic from '@anthropic-ai/sdk';
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

// Statement scanning

export interface StatementTxn {
  date: string;        // YYYY-MM-DD
  description: string;
  amount: number;
  type: 'income' | 'expense';
}

interface MatchedPair {
  extracted: StatementTxn;
  existingId: string;
  existingDescription: string;
}

interface Discrepancy {
  extracted: StatementTxn;
  existingId: string;
  existingDescription: string;
  existingAmount: number;
  reason: string;
}

const STATEMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
];

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = STATEMENT_MIME_TYPES.some((m) => file.mimetype === m) ||
      file.originalname.match(/\.(pdf|jpg|jpeg|png|heic|heif|webp)$/i);
    if (ok) cb(null, true);
    else cb(new Error('Only PDF and image files are accepted'));
  },
});

async function extractTransactionsFromFile(
  buffer: Buffer,
  mimeType: string
): Promise<StatementTxn[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey });
  const data = buffer.toString('base64');

  const prompt = `You are extracting transactions from a bank or credit card statement.

Return ONLY a valid JSON array. Each element must have these fields:
- date: string in YYYY-MM-DD format
- description: string (merchant or payee name, cleaned up)
- amount: number (always positive)
- type: "expense" for debits/withdrawals/purchases, "income" for credits/deposits

Rules:
- Ignore balance rows, total rows, fee rows labelled as "interest" or "minimum payment"
- If a row has parentheses around the amount or is labelled as a debit, it is an expense
- If a row is a credit, deposit, or refund, it is income
- Do NOT include any text outside the JSON array
- Do NOT include markdown code blocks

Example output: [{"date":"2026-03-01","description":"Starbucks","amount":45.50,"type":"expense"},{"date":"2026-03-05","description":"Salary","amount":25000,"type":"income"}]`;

  let contentBlock: Anthropic.MessageParam['content'];

  if (mimeType === 'application/pdf') {
    contentBlock = [
      {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data },
      },
      { type: 'text' as const, text: prompt },
    ];
  } else {
    const imageType = mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    contentBlock = [
      {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: imageType, data },
      },
      { type: 'text' as const, text: prompt },
    ];
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: contentBlock }],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response from Claude');

  const text = block.text.trim();
  const jsonStart = text.indexOf('[');
  const jsonEnd = text.lastIndexOf(']');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON array found in response');

  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown[];
  const result: StatementTxn[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.date !== 'string' || typeof t.description !== 'string' || typeof t.amount !== 'number') continue;
    result.push({
      date: t.date,
      description: t.description,
      amount: Math.abs(t.amount),
      type: t.type === 'income' ? 'income' : 'expense',
    });
  }
  return result;
}

async function reconcile(
  userId: string,
  extracted: StatementTxn[]
): Promise<{ matched: MatchedPair[]; missing: StatementTxn[]; discrepancies: Discrepancy[] }> {
  if (extracted.length === 0) return { matched: [], missing: [], discrepancies: [] };

  const dates = extracted.map((t) => new Date(t.date));
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  // Expand range by 2 days for matching tolerance
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);

  const existing = await ExpenseModel.find({
    owner: userId,
    date: { $gte: minDate, $lte: maxDate },
  }).lean();

  const matched: MatchedPair[] = [];
  const discrepancies: Discrepancy[] = [];
  const missing: StatementTxn[] = [];
  const usedExistingIds = new Set<string>();

  for (const txn of extracted) {
    const txnDate = new Date(txn.date);
    const AMOUNT_TOLERANCE = 0.05;
    const DATE_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

    // Look for exact match: same amount (±tolerance) and same date (±2 days)
    const exactMatch = existing.find((e) => {
      if (usedExistingIds.has(String(e._id))) return false;
      if (e.type !== txn.type) return false;
      const amountMatch = Math.abs(e.amount - txn.amount) <= AMOUNT_TOLERANCE;
      const eDateMs = new Date(e.date ?? e.createdAt ?? 0).getTime();
      const dateMatch = Math.abs(eDateMs - txnDate.getTime()) <= DATE_TOLERANCE_MS;
      return amountMatch && dateMatch;
    });

    if (exactMatch) {
      usedExistingIds.add(String(exactMatch._id));
      matched.push({
        extracted: txn,
        existingId: String(exactMatch._id),
        existingDescription: (exactMatch.item || exactMatch.description || '') as string,
      });
      continue;
    }

    // Look for same amount but date mismatch → discrepancy
    const amountMatch = existing.find((e) => {
      if (usedExistingIds.has(String(e._id))) return false;
      if (e.type !== txn.type) return false;
      return Math.abs(e.amount - txn.amount) <= AMOUNT_TOLERANCE;
    });

    if (amountMatch) {
      usedExistingIds.add(String(amountMatch._id));
      discrepancies.push({
        extracted: txn,
        existingId: String(amountMatch._id),
        existingDescription: (amountMatch.item || amountMatch.description || '') as string,
        existingAmount: amountMatch.amount,
        reason: 'Date mismatch',
      });
      continue;
    }

    missing.push(txn);
  }

  return { matched, missing, discrepancies };
}

// POST /api/import/statement — scan + reconcile (no DB write)
router.post('/statement', statementUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Statement scanning is not configured' });
    return;
  }

  try {
    const extracted = await extractTransactionsFromFile(req.file.buffer, req.file.mimetype);
    const { matched, missing, discrepancies } = await reconcile(req.userId!, extracted);
    res.json({ extracted, matched, missing, discrepancies });
  } catch (err) {
    console.error('import.ts:scan failed:', err);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// POST /api/import/statement/apply — create missing transactions
router.post('/statement/apply', async (req: AuthRequest, res: Response): Promise<void> => {
  const transactions = req.body.transactions as StatementTxn[] | undefined;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    res.status(400).json({ error: 'No transactions provided' });
    return;
  }

  try {
    const toInsert = transactions.map((t) => ({
      owner: req.userId!,
      date: new Date(t.date),
      description: t.description,
      amount: t.amount,
      type: t.type,
      category: 'Other',
    }));

    await ExpenseModel.insertMany(toInsert);
    res.json({ imported: toInsert.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to import transactions' });
  }
});

export default router;
