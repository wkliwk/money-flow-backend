import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import RecurringExpense from '../models/RecurringExpense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

const validation = [
  body('label').notEmpty().withMessage('label is required'),
  body('description').notEmpty().withMessage('description is required'),
  body('amount').isNumeric().withMessage('amount must be a number'),
  body('type').optional().isIn(['income', 'expense']),
  body('frequency').optional().isIn(['monthly', 'weekly', 'daily']),
];

// GET /api/recurring
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const items = await RecurringExpense.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    res.json(items.map((i) => ({ ...i, id: i._id })));
  } catch {
    res.status(500).json({ error: 'Failed to fetch recurring expenses' });
  }
});

// POST /api/recurring
router.post('/', validation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }
  try {
    const { label, item, description, amount, type, category, participants, frequency } = req.body;
    const doc = await RecurringExpense.create({
      userId: req.userId,
      label,
      item,
      description,
      amount: parseFloat(amount),
      type: type || 'expense',
      category,
      participants: participants || [],
      frequency: frequency || 'monthly',
    });
    const obj = doc.toObject();
    res.status(201).json({ ...obj, id: obj._id });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create recurring expense' });
  }
});

// PUT /api/recurring/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await RecurringExpense.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: req.body },
      { new: true, lean: true }
    );
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ ...doc, id: doc._id });
  } catch {
    res.status(500).json({ error: 'Failed to update recurring expense' });
  }
});

// DELETE /api/recurring/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await RecurringExpense.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete recurring expense' });
  }
});

export default router;
