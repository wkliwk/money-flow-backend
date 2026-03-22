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
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const expenses = await ExpenseModel.find().sort({ createdAt: -1 });
    res.json(expenses);
  } catch {
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// GET /api/expenses/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const expense = await ExpenseModel.findById(req.params.id);
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
    res.status(201).json(saved);
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
    const updated = await ExpenseModel.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.json(updated);
  } catch {
    res.status(400).json({ error: 'Failed to update expense' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await ExpenseModel.findByIdAndDelete(req.params.id);
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
