import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import Goal from '../models/Goal';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

const validation = [
  body('name').notEmpty().withMessage('name is required'),
  body('targetAmount').isNumeric().withMessage('targetAmount must be a number'),
];

// GET /api/goals
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const goals = await Goal.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    res.json(goals.map((g) => ({ ...g, id: g._id })));
  } catch {
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

// POST /api/goals
router.post('/', validation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }
  try {
    const { name, targetAmount, deadline, category } = req.body;
    const doc = await Goal.create({
      userId: req.userId,
      name,
      targetAmount: parseFloat(targetAmount),
      currentAmount: 0,
      deadline,
      category,
    });
    const obj = doc.toObject();
    res.status(201).json({ ...obj, id: obj._id });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create goal' });
  }
});

// PUT /api/goals/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await Goal.findOneAndUpdate(
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
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await Goal.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

export default router;
