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
    const headers = ['Date', 'Description', 'Category', 'Type', 'Amount', 'Participants'];
    const rows = expenses.map((e: any) => [
      new Date(e.date || e.createdAt).toISOString().split('T')[0],
      e.description || '',
      e.category || '',
      e.type || '',
      e.amount || 0,
      e.participants?.join(';') || '',
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

// GET /api/export/json
router.get('/json', async (req: AuthRequest, res) => {
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

    // Fetch expenses
    const expenses = await ExpenseModel.find(filter)
      .sort({ date: -1 })
      .lean();

    // Build JSON with metadata
    const data = {
      metadata: {
        exportDate: new Date().toISOString(),
        transactionCount: expenses.length,
        dateRange: {
          from: from || null,
          to: to || null,
        },
      },
      transactions: expenses.map((e: any) => ({
        _id: e._id,
        description: e.description,
        amount: e.amount,
        type: e.type,
        category: e.category,
        date: e.date,
        participants: e.participants || [],
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    };

    // Return JSON file
    const filename = `money-flow-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  } catch {
    res.status(500).json({ error: 'Failed to export JSON' });
  }
});

export default router;
