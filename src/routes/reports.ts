import { Router, Response } from 'express';
import ExpenseModel from '../models/Expense';
import UserModel from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';
import { sendWeeklyDigestForUser, aggregateWeeklyData, formatDigestMessage } from '../utils/weeklyDigest';
import { getExchangeRates, convertCurrency } from '../utils/exchangeRates';

const router = Router();

router.use(protect);

function monthLabel(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function subtractMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get('/monthly', async (req: AuthRequest, res: Response) => {
  try {
    const months = Math.min(parseInt(req.query.months as string) || 6, 24);
    const now = new Date();
    const startDate = subtractMonths(now, months - 1);

    const [userResult, ratesResult] = await Promise.allSettled([
      UserModel.findById(req.userId).select('baseCurrency').lean(),
      getExchangeRates('USD'),
    ]);
    const user = userResult.status === 'fulfilled' ? userResult.value : null;
    const ratesData = ratesResult.status === 'fulfilled' ? ratesResult.value : { rates: { USD: 1 } as Record<string, number> };
    const baseCurrency = user?.baseCurrency || 'USD';

    const rawExpenses = await ExpenseModel.find({
      owner: req.userId,
      date: { $gte: startDate },
    }).select('type amount currency date').lean();

    const monthMap: Record<string, { income: number; expenses: number; transactionCount: number }> = {};
    for (const expense of rawExpenses) {
      const expDate = expense.date instanceof Date ? expense.date : new Date((expense.date ?? new Date()) as Date);
      const label = monthLabel(expDate);
      if (!monthMap[label]) monthMap[label] = { income: 0, expenses: 0, transactionCount: 0 };
      const expCurrency = expense.currency || baseCurrency;
      const converted = convertCurrency(expense.amount, expCurrency, baseCurrency, ratesData.rates);
      if (expense.type === 'income') monthMap[label].income += converted;
      else if (expense.type === 'expense') monthMap[label].expenses += converted;
      monthMap[label].transactionCount++;
    }

    for (const entry of Object.values(monthMap)) {
      entry.income = Math.round(entry.income * 100) / 100;
      entry.expenses = Math.round(entry.expenses * 100) / 100;
    }

    const data = Array.from({ length: months }, (_, i) => {
      const d = subtractMonths(now, months - 1 - i);
      const label = monthLabel(d);
      const entry = monthMap[label] || { income: 0, expenses: 0, transactionCount: 0 };
      return {
        month: label,
        income: entry.income,
        expenses: entry.expenses,
        net: Math.round((entry.income - entry.expenses) * 100) / 100,
        transactionCount: entry.transactionCount,
      };
    });

    res.json({ data, baseCurrency });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch monthly report';
    res.status(500).json({ error: message });
  }
});

router.get('/budget-summary', async (req: AuthRequest, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    let year: number;
    let month: number;

    if (monthParam) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
        res.status(400).json({ error: 'month must be in YYYY-MM format' });
        return;
      }
      [year, month] = monthParam.split('-').map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const [userResult2, ratesResult2] = await Promise.allSettled([
      UserModel.findById(req.userId).lean(),
      getExchangeRates('USD'),
    ]);
    const user = userResult2.status === 'fulfilled' ? userResult2.value : null;
    const ratesData2 = ratesResult2.status === 'fulfilled' ? ratesResult2.value : { rates: { USD: 1 } as Record<string, number> };
    const budgets = user?.budgets || [];
    const baseCurrency = user?.baseCurrency || 'USD';

    const expenses = await ExpenseModel.find({
      owner: req.userId,
      type: 'expense',
      date: { $gte: startDate, $lt: endDate },
    }).select('category amount currency').lean();

    const spendingMap = new Map<string, number>();
    for (const expense of expenses) {
      const expCurrency = expense.currency || baseCurrency;
      const converted = convertCurrency(expense.amount, expCurrency, baseCurrency, ratesData2.rates);
      const cat = expense.category || 'Uncategorised';
      spendingMap.set(cat, (spendingMap.get(cat) ?? 0) + converted);
    }

    const categories = new Set<string>();
    for (const b of budgets) categories.add(b.category);
    for (const [cat] of spendingMap) categories.add(cat);

    const budgetMap = new Map<string, number>();
    for (const b of budgets) budgetMap.set(b.category, b.limit);

    const data = Array.from(categories).map((category) => {
      const budgetLimit = budgetMap.get(category) ?? 0;
      const spent = spendingMap.get(category) ?? 0;
      const remaining = budgetLimit - spent;
      const percentUsed = budgetLimit > 0 ? Math.round((spent / budgetLimit) * 10000) / 100 : 0;
      const overBudget = budgetLimit > 0 && spent > budgetLimit;
      return { category, budgetLimit, spent, remaining, percentUsed, overBudget };
    });

    data.sort((a, b) => b.percentUsed - a.percentUsed);

    const totalBudgeted = data.reduce((sum, d) => sum + d.budgetLimit, 0);
    const totalSpent = data.reduce((sum, d) => sum + d.spent, 0);
    const totalRemaining = totalBudgeted - totalSpent;

    res.json({ data, totalBudgeted, totalSpent, totalRemaining, baseCurrency });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch budget summary';
    res.status(500).json({ error: message });
  }
});

router.post('/weekly-digest', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId as string;
    const data = await aggregateWeeklyData(userId, new Date());
    const message = formatDigestMessage(data);
    const sent = await sendWeeklyDigestForUser(userId);
    res.json({ sent, digest: data, message });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate weekly digest';
    res.status(500).json({ error: message });
  }
});

export default router;
