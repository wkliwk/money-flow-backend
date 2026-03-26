import { Router } from 'express';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

// GET /api/export/csv
router.get('/csv', async (req: AuthRequest, res) => {
  try {
    const { from, to, type } = req.query;

    // Build filter
    const filter: any = { owner: req.userId };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        filter.date.$lte = toDate;
      }
    }
    if (type) filter.type = type;

    // Fetch expenses with lean() for performance
    const expenses = await ExpenseModel.find(filter)
      .sort({ date: -1 })
      .lean();

    // Build CSV
    const headers = ['Date', 'Description', 'Category', 'Type', 'Amount', 'Payment Method', 'Participants'];
    const rows = expenses.map((e: Record<string, unknown>) => [
      new Date((e.date || e.createdAt) as string).toISOString().split('T')[0],
      (e.description as string) || '',
      (e.category as string) || '',
      (e.type as string) || '',
      (e.amount as number) || 0,
      (e.paymentMethod as string) || '',
      (e.participants as string[])?.join(';') || '',
    ]);

    // Build CSV content
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            // Escape quotes and wrap in quotes if contains comma/newline
            const str = String(cell);
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      )
      .join('\n');

    // Return CSV file
    const filename = `money-flow-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch {
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

export default router;
