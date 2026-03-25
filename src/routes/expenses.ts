import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

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

const expenseValidation = [
  body('amount').isNumeric().withMessage('Amount must be a number'),
  participantsValidation,
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
    const { description, amount, type, category, date, notes, participants, isRecurring, recurringFrequency } = req.body;
    const expense = new ExpenseModel({
      owner: req.userId,
      description, amount, type, category, date, notes,
      participants: Array.isArray(participants) ? participants : [],
      ...(isRecurring !== undefined && { isRecurring }),
      ...(recurringFrequency !== undefined && { recurringFrequency }),
    });
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
    const { description, amount, type, category, date, notes, participants, isRecurring, recurringFrequency } = req.body;
    const updateData: Record<string, unknown> = { description, amount, type, category, date, notes };
    if (Array.isArray(participants)) updateData.participants = participants; else updateData.participants = [];
    if (isRecurring !== undefined) updateData.isRecurring = isRecurring;
    if (recurringFrequency !== undefined) updateData.recurringFrequency = recurringFrequency;
    const result = await ExpenseModel.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      { $set: updateData },
      { new: false, runValidators: true, strict: true }
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
