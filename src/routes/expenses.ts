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

// GET /api/expenses
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const expenses = await ExpenseModel.find({ owner: req.userId }).sort({ date: -1, createdAt: -1 }).lean();
    res.json(expenses);
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
    const expense = new ExpenseModel(req.body);
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
