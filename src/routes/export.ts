import { Router, Response } from 'express';
import ExpenseModel from '../models/Expense';
import RecurringExpense from '../models/RecurringExpense';
import Template from '../models/Template';
import Goal from '../models/Goal';
import UserModel from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

router.get('/json', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId || '';

    const [expenses, recurringExpenses, templates, goals, user] = await Promise.all([
      ExpenseModel.find({ owner: userId }).sort({ date: -1 }).lean(),
      RecurringExpense.find({ userId }).sort({ createdAt: -1 }).lean(),
      Template.find({ userId }).sort({ createdAt: -1 }).lean(),
      Goal.find({ userId }).sort({ createdAt: -1 }).lean(),
      UserModel.findById(userId).lean(),
    ]);

    const strip = (docs: Record<string, unknown>[]): Record<string, unknown>[] =>
      docs.map(({ __v, ...rest }) => rest);

    const preferences: Record<string, unknown> = {};
    if (user) {
      preferences.email = user.email;
      preferences.createdAt = user.createdAt;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      expenses: strip(expenses as unknown as Record<string, unknown>[]),
      recurringExpenses: strip(recurringExpenses as unknown as Record<string, unknown>[]),
      templates: strip(templates as unknown as Record<string, unknown>[]),
      goals: strip(goals as unknown as Record<string, unknown>[]),
      budgets: user?.budgets || [],
      preferences,
    };

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = 'money-flow-export-' + dateStr + '.json';

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(JSON.stringify(exportData, null, 2));
  } catch {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

export default router;
