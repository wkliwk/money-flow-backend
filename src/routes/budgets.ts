import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import UserModel from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

// GET /api/budgets
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await UserModel.findById(req.userId).lean();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ budgets: user.budgets || [] });
  } catch {
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

// PUT /api/budgets
router.put(
  '/',
  [
    body('budgets').isArray().withMessage('budgets must be an array'),
    body('budgets.*.category').notEmpty().withMessage('category is required'),
    body('budgets.*.limit').isNumeric().withMessage('limit must be a number'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const budgets = (req.body.budgets as { category: string; limit: number }[]).filter(
        (b) => b.limit > 0
      );
      await UserModel.findByIdAndUpdate(req.userId, { $set: { budgets } });
      res.json({ budgets });
    } catch {
      res.status(500).json({ error: 'Failed to update budgets' });
    }
  }
);

export default router;
