import { Router, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import ExpenseModel from '../models/Expense';
import { WeeklyPulseModel, IWeeklyPulseStats } from '../models/WeeklyPulse';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(protect);

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

async function computeWeeklyStats(userId: string, weekStart: string): Promise<IWeeklyPulseStats | null> {
  const weekEnd = addDays(weekStart, 7);
  const fourWeeksAgo = addDays(weekStart, -28);

  const [weekExpenses, prevExpenses] = await Promise.all([
    ExpenseModel.find({
      owner: userId,
      type: 'expense',
      date: { $gte: new Date(weekStart), $lt: weekEnd },
    }).lean(),
    ExpenseModel.find({
      owner: userId,
      type: 'expense',
      date: { $gte: fourWeeksAgo, $lt: new Date(weekStart) },
    }).lean(),
  ]);

  if (weekExpenses.length < 3) return null;

  const totalSpend = weekExpenses.reduce((s, e) => s + e.amount, 0);

  const prevTotal = prevExpenses.reduce((s, e) => s + e.amount, 0);
  const fourWeekAverage = prevTotal > 0 ? prevTotal / 4 : totalSpend;
  const deltaPercent = fourWeekAverage > 0 ? Math.round(((totalSpend - fourWeekAverage) / fourWeekAverage) * 100) : 0;

  const categoryTotals: Record<string, number> = {};
  for (const e of weekExpenses) {
    const cat = e.category || 'Other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + e.amount;
  }
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other';

  const dayTotals: Record<string, number> = {};
  for (const e of weekExpenses) {
    const day = new Date(e.date ?? e.createdAt ?? new Date()).toISOString().split('T')[0];
    dayTotals[day] = (dayTotals[day] || 0) + e.amount;
  }
  const highestSpendDay = Object.entries(dayTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? weekStart;

  const largest = weekExpenses.sort((a, b) => b.amount - a.amount)[0];
  const largestTransaction = largest
    ? {
        description: (largest.item || largest.description || 'a purchase') as string,
        amount: largest.amount,
        category: (largest.category || 'Other') as string,
      }
    : null;

  return {
    totalSpend,
    fourWeekAverage,
    deltaPercent,
    topCategory,
    highestSpendDay,
    largestTransaction,
    transactionCount: weekExpenses.length,
  };
}

async function generateNarrative(stats: IWeeklyPulseStats, weekStart: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey });

  const dayName = new Date(stats.highestSpendDay).toLocaleDateString('en-US', { weekday: 'long' });
  const direction = stats.deltaPercent >= 0 ? 'more' : 'less';
  const absDelta = Math.abs(stats.deltaPercent);

  const prompt = `You are a personal finance assistant writing a weekly spending summary.

Weekly stats (week of ${weekStart}):
- Total spend: ${stats.totalSpend.toFixed(0)} (your currency)
- 4-week average: ${stats.fourWeekAverage.toFixed(0)} — ${absDelta}% ${direction} than usual
- Top category: ${stats.topCategory} (${(stats.totalSpend > 0 ? (Object.fromEntries([[stats.topCategory, stats.totalSpend]]))[stats.topCategory] : 0).toFixed(0)})
- Highest spending day: ${dayName}
- Biggest purchase: ${stats.largestTransaction ? `${stats.largestTransaction.description} (${stats.largestTransaction.amount.toFixed(0)})` : 'n/a'}
- Transactions this week: ${stats.transactionCount}

Write a friendly, warm, non-judgmental 3-5 sentence narrative about this spending week. Be specific with the data. Write in second person ("You spent..."). Do not include currency symbols — just use the numbers. Do not give unsolicited advice.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  return block.type === 'text' ? block.text.trim() : '';
}

// GET /api/insights/weekly-pulse — return most recent pulse
router.get('/weekly-pulse', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pulse = await WeeklyPulseModel.findOne({ userId: req.userId }).sort({ weekStart: -1 }).lean();
    if (!pulse) {
      res.json({ pulse: null });
      return;
    }
    res.json({ pulse });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pulse' });
  }
});

// GET /api/insights/previous-pulse — return pulse for previous week
router.get('/previous-pulse', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentWeekStart = getWeekStart(new Date());
    const pulse = await WeeklyPulseModel.findOne({
      userId: req.userId,
      weekStart: { $lt: currentWeekStart },
    })
      .sort({ weekStart: -1 })
      .lean();
    if (!pulse) {
      res.json({ pulse: null });
      return;
    }
    res.json({ pulse });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch previous pulse' });
  }
});

// POST /api/insights/weekly-pulse/generate — compute stats + call Claude + store
router.post('/weekly-pulse/generate', async (req: AuthRequest, res: Response): Promise<void> => {
  const weekStart = getWeekStart(new Date());
  const force = req.query.force === 'true';

  try {
    if (!force) {
      const existing = await WeeklyPulseModel.findOne({ userId: req.userId, weekStart }).lean();
      if (existing) {
        res.json({ pulse: existing, generated: false });
        return;
      }
    }

    const stats = await computeWeeklyStats(req.userId!, weekStart);
    if (!stats) {
      res.json({ pulse: null, generated: false, reason: 'insufficient_data' });
      return;
    }

    const narrative = await generateNarrative(stats, weekStart);

    const pulse = await WeeklyPulseModel.findOneAndUpdate(
      { userId: req.userId, weekStart },
      { userId: req.userId, weekStart, narrative, stats },
      { upsert: true, new: true }
    ).lean();

    res.json({ pulse, generated: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate pulse' });
  }
});

export default router;
