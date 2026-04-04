import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

const expenseValidation = [
  body('owner').notEmpty().withMessage('Owner is required'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
];

// GET /api/expenses — with pagination, sorting, and filters
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { owner: req.userId };

    // Text search: case-insensitive substring match across description, category, item, participants
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { description: regex },
        { category: regex },
        { item: regex },
        { participants: regex },
      ];
    }

    // Category filter (exact match)
    const categoryQuery = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    if (categoryQuery) {
      filter.category = categoryQuery;
    }

    // Amount range filter
    const minAmount = parseFloat(req.query.minAmount as string);
    const maxAmount = parseFloat(req.query.maxAmount as string);
    if (!isNaN(minAmount) || !isNaN(maxAmount)) {
      const amountFilter: Record<string, number> = {};
      if (!isNaN(minAmount)) amountFilter.$gte = minAmount;
      if (!isNaN(maxAmount)) amountFilter.$lte = maxAmount;
      filter.amount = amountFilter;
    }

    // Sorting
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
      total, page, pages: totalPages,
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch expenses' });
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
  } catch {
    res.status(500).json({ error: 'Failed to fetch expense' });
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
    // Ensure participants is always an array (empty if not provided)
    const { participants = [] } = req.body;
    const expense = new ExpenseModel({ ...req.body, participants });
    const saved = await expense.save();
    res.status(201).json(saved.toObject());
  } catch {
    res.status(400).json({ error: 'Failed to create expense' });
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
    // Explicitly $set to ensure array fields (like participants) are saved correctly
    const { _id, __v, createdAt, updatedAt, ...fields } = req.body;
    const result = await ExpenseModel.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      { $set: fields },
      { runValidators: false, strict: false }
    );
    if (!result) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    // Re-fetch with lean() to get the actual stored document including all array fields
    const updated = await ExpenseModel.findOne({ _id: req.params.id, owner: req.userId }).lean();
    res.json(updated);
  } catch {
    res.status(400).json({ error: 'Failed to update expense' });
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
  } catch {
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
