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

// PUT /api/budgets
router.put(
  '/',
  [
    body('budgets').isArray().withMessage('budgets must be an array'),
    body('budgets.*.category').notEmpty().withMessage('category is required'),
    body('budgets.*.limit').isNumeric().withMessage('limit must be a number'),
    body('budgets.*.alert_threshold').optional().isNumeric().withMessage('alert_threshold must be a number'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const budgets = (req.body.budgets as { category: string; limit: number; alert_threshold?: number }[])
        .filter((b) => b.limit > 0)
        .map((b) => ({
          category: b.category,
          limit: b.limit,
          ...(b.alert_threshold && { alert_threshold: b.alert_threshold }),
        }));
      await UserModel.findByIdAndUpdate(req.userId, { $set: { budgets } });
      res.json({ budgets });
    } catch {
      res.status(500).json({ error: 'Failed to update budgets' });
    }
  }
);

// GET /api/budgets/:category/alerts
// Returns monthly alerts for a budget category
router.get(
  '/:category/alerts',
  async (req: AuthRequest, res: Response) => {
    try {
      const { category } = req.params;
      const user = await UserModel.findById(req.userId).lean();

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const budget = user.budgets?.find((b) => b.category === category);
      if (!budget) {
        res.status(404).json({ error: 'Budget not found' });
        return;
      }

      if (!budget.alert_threshold) {
        res.json({ budget_category: category, alert_threshold: null, alerts: [] });
        return;
      }

      // Get current month's expenses for this category
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const expenses = await ExpenseModel.find({
        owner: req.userId,
        category,
        date: { $gte: monthStart, $lt: monthEnd },
      });

      const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount, 0);
      const exceeded = totalSpent > budget.alert_threshold;

      res.json({
        budget_category: category,
        alert_threshold: budget.alert_threshold,
        total_spent: totalSpent,
        exceeded,
        remaining: Math.max(0, budget.alert_threshold - totalSpent),
        month: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch budget alerts' });
    }
  }
);

export default router;
