import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { compareTwoStrings } from 'string-similarity';
import ExpenseModel, { PAYMENT_METHODS, SUPPORTED_CURRENCIES } from '../models/Expense';
import UserModel from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';
import { checkAndQueueBudgetAlerts } from '../utils/alerts';

const router = Router();

router.use(protect);

// Helper: check for potential duplicates in the last 24 hours
async function checkDuplicates(userId: string, description: string, amount: number) {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentExpenses = await ExpenseModel.find({
    owner: userId,
    amount: amount,
    createdAt: { $gte: last24h },
  }).lean();

  const potential = recentExpenses.filter((exp) => {
    if (!exp.description) return false;
    const similarity = compareTwoStrings(description.toLowerCase(), exp.description.toLowerCase());
    return similarity >= 0.9;
  });

  return potential.length > 0 ? potential[0] : null;
}

const participantsValidation = body('participants')
  .optional()
  .custom((value) => {
    if (value === undefined || value === null) return true;
    if (!Array.isArray(value)) throw new Error('participants must be an array');
    if (value.length > 20) throw new Error('participants cannot exceed 20 items');
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== 'string') throw new Error('each participant must be a string');
      if (item.trim() === '') throw new Error('participant names cannot be empty');
      if (item.length > 100) throw new Error('participant names cannot exceed 100 characters');
      const lower = item.toLowerCase();
      if (seen.has(lower)) throw new Error(`duplicate participant: "${item}"`);
      seen.add(lower);
    }
    return true;
  });

const paymentMethodValidation = body('paymentMethod')
  .optional({ values: 'null' })
  .isIn([...PAYMENT_METHODS])
  .withMessage(`paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}`);

const currencyValidation = body('currency')
  .optional()
  .isIn([...SUPPORTED_CURRENCIES])
  .withMessage(`currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`);

const originalAmountValidation = body('originalAmount')
  .optional({ values: 'null' })
  .isFloat({ gt: 0 })
  .withMessage('originalAmount must be a positive number');

const exchangeRateValidation = body('exchangeRate')
  .optional({ values: 'null' })
  .isNumeric()
  .withMessage('exchangeRate must be a number');

const expenseValidation = [
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
  currencyValidation,
  originalAmountValidation,
  exchangeRateValidation,
  participantsValidation,
  paymentMethodValidation,
];

// GET /api/expenses/last-amounts — map of item/description → most recent amount
router.get('/last-amounts', async (req: AuthRequest, res: Response) => {
  try {
    const results = await ExpenseModel.aggregate([
      { $match: { owner: req.userId } },
      { $sort: { date: -1, createdAt: -1 } },
      {
        $group: {
          _id: { $toLower: { $ifNull: ['$item', '$description'] } },
          amount: { $first: '$amount' },
          date: { $first: '$date' },
        },
      },
    ]);
    const map: Record<string, number> = {};
    for (const r of results) {
      if (r._id) map[r._id] = r.amount;
    }
    res.json(map);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch last amounts';
    res.status(500).json({ error: message });
  }
});

// GET /api/expenses/price-history/:item — price history for a specific item
router.get('/price-history/:item', async (req: AuthRequest, res: Response) => {
  try {
    const itemName = req.params.item;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    const results = await ExpenseModel.find({
      owner: req.userId,
      $or: [
        { item: { $regex: new RegExp(`^${itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        { description: { $regex: new RegExp(`^${itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      ],
    })
      .sort({ date: -1, createdAt: -1 })
      .limit(limit)
      .select('amount date description item category currency')
      .lean();

    const amounts = results.map((r) => r.amount);
    const stats = amounts.length > 0 ? {
      count: amounts.length,
      latest: amounts[0],
      min: Math.min(...amounts),
      max: Math.max(...amounts),
      avg: Math.round((amounts.reduce((s, a) => s + a, 0) / amounts.length) * 100) / 100,
    } : null;

    res.json({ item: itemName, history: results, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch price history';
    res.status(500).json({ error: message });
  }
});

// GET /api/expenses/analytics
router.get('/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    let year: number;
    let month: number;

    if (monthParam) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
        res.status(400).json({ error: 'month must be in YYYY-MM format' });
        return;
      }
      [year, month] = monthParam.split('-').map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const matchStage = {
      $match: {
        owner: req.userId,
        date: { $gte: startDate, $lt: endDate },
      },
    };

    const [summaryResult, categoryResult, dailyResult] = await Promise.all([
      ExpenseModel.aggregate([
        matchStage,
        {
          $group: {
            _id: '$type',
            total: { $sum: '$amount' },
          },
        },
      ]),
      ExpenseModel.aggregate([
        matchStage,
        { $match: { type: 'expense' } },
        {
          $group: {
            _id: '$category',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
      ExpenseModel.aggregate([
        matchStage,
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
              type: '$type',
            },
            total: { $sum: '$amount' },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),
    ]);

    const totalIncome = summaryResult.find((r) => r._id === 'income')?.total ?? 0;
    const totalExpense = summaryResult.find((r) => r._id === 'expense')?.total ?? 0;
    const netBalance = totalIncome - totalExpense;

    const grandExpenseTotal = categoryResult.reduce((sum: number, c: { total: number }) => sum + c.total, 0);
    const categoryBreakdown = categoryResult.map((c: { _id: string | null; total: number; count: number }) => ({
      category: c._id ?? 'Uncategorised',
      total: c.total,
      count: c.count,
      percentage: grandExpenseTotal > 0 ? Math.round((c.total / grandExpenseTotal) * 10000) / 100 : 0,
    }));

    const dailyMap = new Map<string, { income: number; expense: number }>();
    for (const row of dailyResult) {
      const date: string = row._id.date;
      if (!dailyMap.has(date)) dailyMap.set(date, { income: 0, expense: 0 });
      const entry = dailyMap.get(date)!;
      if (row._id.type === 'income') entry.income += row.total;
      else if (row._id.type === 'expense') entry.expense += row.total;
    }
    const dailyTotals = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, totals]) => ({ date, ...totals }));

    res.json({ totalIncome, totalExpense, netBalance, categoryBreakdown, dailyTotals });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch analytics';
    res.status(500).json({ error: message });
  }
});

// GET /api/expenses with pagination and sorting
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { owner: req.userId };
    const paymentMethodQuery = req.query.paymentMethod as string | undefined;
    if (paymentMethodQuery) {
      if (!PAYMENT_METHODS.includes(paymentMethodQuery as typeof PAYMENT_METHODS[number])) {
        res.status(400).json({ error: `Invalid paymentMethod filter. Must be one of: ${PAYMENT_METHODS.join(', ')}` });
        return;
      }
      filter.paymentMethod = paymentMethodQuery;
    }

    const allowedSortFields = ['createdAt', 'amount', 'date'];
    const sortField = allowedSortFields.includes(req.query.sort as string)
      ? (req.query.sort as string)
      : 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 1 : -1;
    const sortObj: Record<string, 1 | -1> = { [sortField]: sortOrder };
    if (sortField !== 'createdAt') sortObj.createdAt = -1;

    const [expenses, total] = await Promise.all([
      ExpenseModel.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
      ExpenseModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({
      data: expenses,
      pagination: { page, limit, total, totalPages },
      // Backward compat
      total, page, pages: totalPages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch expenses';
    res.status(500).json({ error: message });
  }
});

// GET /api/expenses/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const expense = await ExpenseModel.findOne({ _id: req.params.id, owner: req.userId }).lean();
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.json(expense);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch expense';
    res.status(500).json({ error: message });
  }
});

// POST /api/expenses
router.post('/', expenseValidation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }
  try {
    const { description, amount, type, category, item, date, notes, participants, isRecurring, recurringFrequency, paymentMethod, currency, originalAmount, exchangeRate, splitBill } = req.body;

    // Check for potential duplicates
    if (req.userId && typeof description === 'string' && typeof amount === 'number') {
      const duplicate = await checkDuplicates(req.userId, description, amount);
      if (duplicate) {
        const minutesAgo = Math.round((Date.now() - new Date(duplicate.createdAt || '').getTime()) / 60000);
        res.status(409).json({ error: `Potential duplicate detected. Similar transaction created ${minutesAgo} minutes ago.` });
        return;
      }
    }

    // Default currency to user's baseCurrency if not provided
    let resolvedCurrency = currency;
    if (!resolvedCurrency && req.userId) {
      try {
        const user = await UserModel.findById(req.userId).select('baseCurrency').lean();
        resolvedCurrency = user?.baseCurrency || 'USD';
      } catch {
        resolvedCurrency = 'USD';
      }
    }

    const expense = new ExpenseModel({
      owner: req.userId,
      description, amount, type, category, item, date, notes,
      participants: Array.isArray(participants) ? participants : [],
      ...(isRecurring !== undefined && { isRecurring }),
      ...(recurringFrequency !== undefined && { recurringFrequency }),
      ...(paymentMethod !== undefined && { paymentMethod }),
      ...(resolvedCurrency !== undefined && { currency: resolvedCurrency }),
      ...(originalAmount !== undefined && { originalAmount }),
      ...(exchangeRate !== undefined && { exchangeRate }),
      ...(splitBill !== undefined && { splitBill }),
    });
    const saved = await expense.save();
    const result = saved.toObject();
    res.status(201).json(result);

    // Check budget alerts asynchronously (don't block response)
    if (req.userId) {
      checkAndQueueBudgetAlerts(req.userId).catch((error) => {
        console.error('Error queuing budget alerts:', error);
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create expense';
    res.status(400).json({ error: message });
  }
});

// PUT /api/expenses/:id
router.put('/:id', expenseValidation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }
  try {
    const expense = await ExpenseModel.findOne({ _id: req.params.id, owner: req.userId });
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    const { description, amount, type, category, item, date, participants, paymentMethod, currency, originalAmount, exchangeRate, splitBill } = req.body;
    expense.description = description;
    expense.amount = amount;
    expense.type = type;
    expense.category = category;
    expense.item = item;
    expense.date = date;
    expense.participants = Array.isArray(participants) ? participants : [];
    if (paymentMethod !== undefined) expense.paymentMethod = paymentMethod;
    if (currency !== undefined) expense.currency = currency;
    if (originalAmount !== undefined) expense.originalAmount = originalAmount;
    if (exchangeRate !== undefined) expense.exchangeRate = exchangeRate;
    expense.splitBill = splitBill !== undefined ? splitBill : false;
    await expense.save();
    res.json(expense.toObject());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update expense';
    res.status(400).json({ error: message });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await ExpenseModel.findOneAndDelete({ _id: req.params.id, owner: req.userId });
    if (!deleted) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete expense';
    res.status(500).json({ error: message });
  }
});

export default router;
