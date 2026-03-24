import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

type ExpensePayload = Record<string, unknown> & {
  participants?: string[];
  with?: string[] | string;
};

const normalizeExpenseInput = (payload: ExpensePayload): ExpensePayload => {
  const normalized = { ...payload };
  const withValue = normalized.with;
  if ((!Array.isArray(normalized.participants) || normalized.participants.length === 0) && withValue !== undefined) {
    normalized.participants = Array.isArray(withValue) ? withValue : [withValue];
  }
  delete normalized.with;
  return normalized;
};

const toExpenseResponse = (expense: Record<string, unknown> | null) => {
  if (!expense) return expense;
  const participants = Array.isArray(expense.participants) ? expense.participants : [];
  return { ...expense, with: participants };
};

const expenseValidation = [
  body('amount').isNumeric().withMessage('Amount must be a number'),
];

// GET /api/expenses
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const expenses = await ExpenseModel.find({ owner: req.userId }).sort({ date: -1, createdAt: -1 }).lean();
    res.json(expenses.map((expense) => toExpenseResponse(expense)));
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
    res.json(toExpenseResponse(expense));
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
    const payload = { ...normalizeExpenseInput(req.body as ExpensePayload), owner: req.userId };
    const expense = new ExpenseModel(payload);
    const saved = await expense.save();
    res.status(201).json(toExpenseResponse(saved.toObject()));
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
    const normalizedBody = normalizeExpenseInput(req.body as ExpensePayload);
    const { _id, __v, createdAt, updatedAt, owner: _owner, ...fields } = normalizedBody;
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
    res.json(toExpenseResponse(updated));
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
  } catch (err) {
    if (err instanceof mongoose.Error.CastError) {
      res.status(400).json({ error: 'Invalid expense ID' });
      return;
    }
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
