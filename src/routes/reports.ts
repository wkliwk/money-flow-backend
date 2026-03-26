import { Router, Response } from 'express';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';
import { sendWeeklyDigestForUser, aggregateWeeklyData, formatDigestMessage } from '../utils/weeklyDigest';

const router = Router();

router.use(protect);

function monthLabel(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function subtractMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get('/monthly', async (req: AuthRequest, res: Response) => {
  try {
    const months = Math.min(parseInt(req.query.months as string) || 6, 24);
    const now = new Date();
    const startDate = subtractMonths(now, months - 1);

    const rows = await ExpenseModel.aggregate([
      {
        $match: {
          owner: req.userId,
          date: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          income: {
            $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] },
          },
          expenses: {
            $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] },
          },
          transactionCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const monthMap: Record<string, { income: number; expenses: number; transactionCount: number }> = {};
    for (const row of rows) {
      monthMap[row._id] = {
        income: row.income,
        expenses: row.expenses,
        transactionCount: row.transactionCount,
      };
    }

    const data = Array.from({ length: months }, (_, i) => {
      const d = subtractMonths(now, months - 1 - i);
      const label = monthLabel(d);
      const entry = monthMap[label] || { income: 0, expenses: 0, transactionCount: 0 };
      return {
        month: label,
        income: entry.income,
        expenses: entry.expenses,
        net: entry.income - entry.expenses,
        transactionCount: entry.transactionCount,
      };
    });

    res.json({ data });
  } catch {
    res.status(500).json({ error: 'Failed to fetch monthly report' });
  }
});

router.post('/weekly-digest', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId as string;
    const data = await aggregateWeeklyData(userId, new Date());
    const message = formatDigestMessage(data);
    const sent = await sendWeeklyDigestForUser(userId);
    res.json({ sent, digest: data, message });
  } catch {
    res.status(500).json({ error: 'Failed to generate weekly digest' });
  }
});

export default router;
