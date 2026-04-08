import UserModel, { IBudget, IUser } from '../models/User';
import ExpenseModel from '../models/Expense';
import { sendTelegramMessageToChat } from './telegram';

interface CategoryTotal {
  category: string;
  total: number;
}

interface BudgetAlert {
  category: string;
  spent: number;
  limit: number;
  percentUsed: number;
}

export interface MonthlySummaryData {
  month: string;
  totalIncome: number;
  totalExpense: number;
  net: number;
  topCategories: CategoryTotal[];
  budgetAlerts: BudgetAlert[];
  prevMonthExpense: number;
  momChangePercent: number | null;
}

export function getPreviousMonthBounds(now: Date): { start: Date; end: Date; label: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; this is "current" month index
  // Previous month
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const start = new Date(Date.UTC(prevYear, prevMonth, 1));
  const end = new Date(Date.UTC(prevYear, prevMonth + 1, 1));
  const label = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`;
  return { start, end, label };
}

export function getPriorMonthBounds(now: Date): { start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  // Two months back
  const priorMonth = month <= 1 ? month + 10 : month - 2;
  const priorYear = month <= 1 ? year - 1 : year;
  const start = new Date(Date.UTC(priorYear, priorMonth, 1));
  const end = new Date(Date.UTC(priorYear, priorMonth + 1, 1));
  return { start, end };
}

export async function aggregateMonthlySummary(userId: string, now?: Date): Promise<MonthlySummaryData> {
  const currentDate = now ?? new Date();
  const { start, end, label } = getPreviousMonthBounds(currentDate);
  const prior = getPriorMonthBounds(currentDate);

  const matchStage = {
    $match: {
      owner: userId,
      date: { $gte: start, $lt: end },
    },
  };

  const [summaryResult, categoryResult, priorResult] = await Promise.all([
    ExpenseModel.aggregate([
      matchStage,
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
        },
      },
    ]),
    ExpenseModel.aggregate([
      matchStage,
      { $match: { type: 'expense' } },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 5 },
    ]),
    ExpenseModel.aggregate([
      {
        $match: {
          owner: userId,
          type: 'expense',
          date: { $gte: prior.start, $lt: prior.end },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const totalIncome = summaryResult.find((r: { _id: string }) => r._id === 'income')?.total ?? 0;
  const totalExpense = summaryResult.find((r: { _id: string }) => r._id === 'expense')?.total ?? 0;
  const net = totalIncome - totalExpense;

  const topCategories: CategoryTotal[] = categoryResult.map(
    (row: { _id: string | null; total: number }) => ({
      category: row._id ?? 'Uncategorised',
      total: row.total,
    })
  );

  const prevMonthExpense: number = priorResult[0]?.total ?? 0;
  let momChangePercent: number | null = null;
  if (prevMonthExpense > 0) {
    momChangePercent = Math.round(((totalExpense - prevMonthExpense) / prevMonthExpense) * 100);
  }

  return { month: label, totalIncome, totalExpense, net, topCategories, budgetAlerts: [], prevMonthExpense, momChangePercent };
}

export async function buildBudgetAlerts(userId: string, totalsByCategory: CategoryTotal[], budgets: IBudget[]): Promise<BudgetAlert[]> {
  const alerts: BudgetAlert[] = [];
  const budgetMap = new Map<string, number>();
  for (const b of budgets) budgetMap.set(b.category, b.limit);

  for (const cat of totalsByCategory) {
    const limit = budgetMap.get(cat.category);
    if (limit && limit > 0 && cat.total > limit) {
      const percentUsed = Math.round((cat.total / limit) * 10000) / 100;
      alerts.push({ category: cat.category, spent: cat.total, limit, percentUsed });
    }
  }
  return alerts;
}

export function formatMonthlySummaryMessage(data: MonthlySummaryData): string {
  const { month, totalIncome, totalExpense, net, topCategories, budgetAlerts, momChangePercent } = data;

  let msg = `<b>Monthly Summary — ${month}</b>\n\n`;
  msg += `<b>Income:</b> $${totalIncome.toFixed(2)}\n`;
  msg += `<b>Expenses:</b> $${totalExpense.toFixed(2)}\n`;
  msg += `<b>Net:</b> $${net.toFixed(2)}\n`;

  if (momChangePercent !== null) {
    const arrow = momChangePercent > 0 ? '↑' : momChangePercent < 0 ? '↓' : '→';
    msg += `<b>vs Prior Month:</b> ${arrow} ${Math.abs(momChangePercent)}%\n`;
  } else {
    msg += `<b>vs Prior Month:</b> No data\n`;
  }

  if (topCategories.length > 0) {
    msg += `\n<b>Top Categories:</b>\n`;
    topCategories.forEach((cat, i) => {
      msg += `  ${i + 1}. ${cat.category} — $${cat.total.toFixed(2)}\n`;
    });
  }

  if (budgetAlerts.length > 0) {
    msg += `\n<b>Over Budget:</b>\n`;
    for (const alert of budgetAlerts) {
      msg += `  ${alert.category}: $${alert.spent.toFixed(2)} / $${alert.limit.toFixed(2)} (${alert.percentUsed}%)\n`;
    }
  }

  return msg;
}

export async function sendMonthlySummaryForUser(userId: string, now?: Date): Promise<boolean> {
  const data = await aggregateMonthlySummary(userId, now);

  const user = await UserModel.findById(userId).lean();
  if (!user?.telegramChatId) return false;

  const alerts = await buildBudgetAlerts(userId, data.topCategories, (user as IUser).budgets ?? []);
  data.budgetAlerts = alerts;

  const message = formatMonthlySummaryMessage(data);
  return sendTelegramMessageToChat(user.telegramChatId, message);
}

export async function processMonthlySummaries(): Promise<number> {
  const users = await UserModel.find({
    telegramChatId: { $exists: true, $ne: '' },
  }).lean();

  let sentCount = 0;
  for (const user of users) {
    const userId = (user as IUser)._id.toString();
    try {
      const sent = await sendMonthlySummaryForUser(userId);
      if (sent) sentCount++;
    } catch (error) {
      console.error(`[MonthlySummary] Failed for user ${userId}:`, error);
    }
  }

  return sentCount;
}
