import { Router } from 'express';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

// GET /api/export/csv
router.get('/csv', async (req: AuthRequest, res) => {
  try {
    const { from, to, type } = req.query;

    const filter: Record<string, unknown> = { owner: req.userId };
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = new Date(from as string);
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = toDate;
      }
      filter.date = dateFilter;
    }
    if (type) filter.type = type;

    const expenses = await ExpenseModel.find(filter)
      .sort({ date: -1 })
      .lean();

    const headers = ['Date', 'Description', 'Category', 'Type', 'Amount', 'Participants'];
    const rows = expenses.map((e) => [
      new Date(e.date ?? new Date()).toISOString().split('T')[0],
      e.description || '',
      e.category || '',
      e.type || '',
      e.amount || 0,
      e.participants?.join(';') || '',
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const str = String(cell);
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      )
      .join('\n');

    const filename = `money-flow-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch {
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

export default router;
