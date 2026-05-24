import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import GoalModel from '../models/Goal';

const router = Router();

router.use(protect);

// GET /api/goals
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const goals = await GoalModel.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ goals });
  } catch (err) {
    console.error('goals.ts:1 failed:', err);
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

// POST /api/goals
router.post(
  '/',
  [
    body('name').notEmpty().withMessage('name is required'),
    body('targetAmount')
      .isNumeric()
      .withMessage('targetAmount must be a number'),
    body('currentAmount')
      .optional()
      .isNumeric()
      .withMessage('currentAmount must be a number'),
    body('deadline')
      .optional()
      .isISO8601()
      .withMessage('deadline must be a valid ISO date'),
    body('category')
      .optional()
      .isString()
      .withMessage('category must be a string'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const { name, targetAmount, currentAmount, deadline, category } =
        req.body as {
          name: string;
          targetAmount: number;
          currentAmount?: number;
          deadline?: string;
          category?: string;
        };
      const goal = await GoalModel.create({
        userId: req.userId,
        name,
        targetAmount,
        currentAmount: currentAmount ?? 0,
        deadline: deadline ? new Date(deadline) : undefined,
        category,
      });
      res.status(201).json({ goal });
    } catch (err) {
      console.error('goals.ts:2 failed:', err);
      res.status(500).json({ error: 'Failed to create goal' });
    }
  }
);

// PUT /api/goals/:id
router.put(
  '/:id',
  [
    body('name').optional().notEmpty().withMessage('name cannot be empty'),
    body('targetAmount')
      .optional()
      .isNumeric()
      .withMessage('targetAmount must be a number'),
    body('currentAmount')
      .optional()
      .isNumeric()
      .withMessage('currentAmount must be a number'),
    body('deadline')
      .optional()
      .isISO8601()
      .withMessage('deadline must be a valid ISO date'),
    body('category')
      .optional()
      .isString()
      .withMessage('category must be a string'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const goal = await GoalModel.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $set: req.body },
        { new: true }
      );
      if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
      }
      res.json({ goal });
    } catch (err) {
      console.error('goals.ts:3 failed:', err);
      res.status(500).json({ error: 'Failed to update goal' });
    }
  }
);

// DELETE /api/goals/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const goal = await GoalModel.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('goals.ts:4 failed:', err);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

export default router;
