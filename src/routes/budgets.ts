import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import UserModel from '../models/User';
import ExpenseModel from '../models/Expense';
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

// GET /api/budgets/summary - returns current spend vs limits
router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const user = await UserModel.findById(req.userId).lean();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const budgets = user.budgets || [];
    if (budgets.length === 0) {
      res.json({ summary: [] });
      return;
    }

    // Get current month start and end
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Get expenses for current month grouped by category
    const expenses = await ExpenseModel.find(
      {
        userId: req.userId,
        type: 'expense',
        date: { $gte: monthStart, $lte: monthEnd },
      },
      { category: 1, amount: 1 }
    ).lean();

    const categorySpend: { [key: string]: number } = {};
    expenses.forEach((exp) => {
      const cat = exp.category || 'Uncategorized';
      categorySpend[cat] = (categorySpend[cat] || 0) + exp.amount;
    });

    const summary = budgets.map((b) => {
      const spend = categorySpend[b.category] || 0;
      const threshold = b.alert_threshold || 0.9;
      const remaining = Math.max(0, b.limit - spend);
      const exceeds = spend > b.limit;
      const percentUsed = b.limit > 0 ? (spend / b.limit) * 100 : 0;

      return {
        category: b.category,
        limit: b.limit,
        spend,
        remaining,
        percentUsed: Math.round(percentUsed),
        exceeds,
        alertTriggered: exceeds && b.enable_alerts,
        thresholdPercentage: threshold * 100,
      };
    });

    res.json({ summary });
  } catch {
    res.status(500).json({ error: 'Failed to fetch budget summary' });
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
      const budgets = (
        req.body.budgets as {
          category: string;
          limit: number;
          alert_threshold?: number;
          enable_alerts?: boolean;
        }[]
      ).filter((b) => b.limit > 0);

      await UserModel.findByIdAndUpdate(req.userId, { $set: { budgets } });
      res.json({ budgets });
    } catch {
      res.status(500).json({ error: 'Failed to update budgets' });
    }
  }
);

export default router;
