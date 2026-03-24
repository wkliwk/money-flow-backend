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

// GET /api/expenses with pagination
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const [expenses, total] = await Promise.all([
      ExpenseModel.find({ owner: req.userId })
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ExpenseModel.countDocuments({ owner: req.userId }),
    ]);

    const pages = Math.ceil(total / limit);
    res.json({ data: expenses, total, page, pages });
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
    const expenseData = req.body;
    // Explicitly set participants if not provided
    if (!expenseData.participants || !Array.isArray(expenseData.participants)) {
      expenseData.participants = [];
    }
    const expense = new ExpenseModel(expenseData);
    const saved = await expense.save();
    const result = saved.toObject();
    res.status(201).json(result);
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
    // Extract fields excluding system fields
    const { _id, __v, createdAt, updatedAt, ...updateData } = req.body;
    // Ensure participants is always an array (empty if not provided)
    if (!updateData.participants || !Array.isArray(updateData.participants)) {
      updateData.participants = [];
    }
    const result = await ExpenseModel.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      { $set: updateData },
      { runValidators: false, strict: false }
    );
    if (!result) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    // Re-fetch to get the actual stored document including all fields
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
