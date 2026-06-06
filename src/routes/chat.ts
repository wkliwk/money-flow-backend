import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import Groq from 'groq-sdk';
import ExpenseModel from '../models/Expense';
import UserModel from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(protect);

const FALLBACK_REPLY = "I couldn't analyse your data right now. Try again in a moment.";

function buildFinanceContext(
  expenses: Array<{ category?: string; amount: number; item?: string; description?: string; date?: Date }>,
  budgets: Array<{ category: string; limit: number }>,
  monthExpenses: Array<{ category?: string; amount: number }>,
): string {
  const categoryTotals: Record<string, number> = {};
  const merchantTotals: Record<string, number> = {};

  for (const e of expenses) {
    const cat = e.category || 'Other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + e.amount;

    const merchant = e.item || e.description;
    if (merchant) {
      merchantTotals[merchant] = (merchantTotals[merchant] || 0) + e.amount;
    }
  }

  const topMerchants = Object.entries(merchantTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }));

  const monthCategorySpend: Record<string, number> = {};
  for (const e of monthExpenses) {
    const cat = e.category || 'Other';
    monthCategorySpend[cat] = (monthCategorySpend[cat] || 0) + e.amount;
  }

  const budgetVsActual = budgets.map((b) => ({
    category: b.category,
    limit: b.limit,
    spent: Math.round(monthCategorySpend[b.category] || 0),
  }));

  const categoryBreakdown = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => ({ category: cat, total: Math.round(amt) }));

  return JSON.stringify({
    period: 'last 90 days',
    categoryTotals: categoryBreakdown,
    topMerchants,
    currentMonthBudgets: budgetVsActual,
  });
}

router.post(
  '/money-assistant',
  [
    body('message')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('message is required')
      .isLength({ max: 500 })
      .withMessage('message must be at most 500 characters'),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { message } = req.body as { message: string };

    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    try {
      const [expenses, monthExpenses, user] = await Promise.all([
        ExpenseModel.find(
          { owner: req.userId, type: 'expense', date: { $gte: ninetyDaysAgo } },
          { category: 1, amount: 1, item: 1, description: 1, date: 1 },
        ).lean(),
        ExpenseModel.find(
          { owner: req.userId, type: 'expense', date: { $gte: monthStart } },
          { category: 1, amount: 1 },
        ).lean(),
        UserModel.findById(req.userId, { budgets: 1 }).lean(),
      ]);

      const budgets = user?.budgets ?? [];
      const context = buildFinanceContext(expenses, budgets, monthExpenses);

      const systemPrompt = `You are a personal finance assistant. The user's spending data: ${context}. Answer the user's question concisely in 2-3 sentences using only the data provided.`;

      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.3,
        max_tokens: 256,
      });

      const reply = completion.choices[0]?.message?.content?.trim() || FALLBACK_REPLY;
      res.json({ reply });
    } catch {
      res.json({ reply: FALLBACK_REPLY });
    }
  },
);

export default router;
