import UserModel, { IUser } from '../models/User';
import ExpenseModel from '../models/Expense';
import { sendTelegramMessageToChat } from './telegram';

interface CategoryTotal {
  category: string;
  total: number;
}

interface WeeklyDigestData {
  totalSpent: number;
  lastWeekTotal: number;
  changePercent: number | null;
  transactionCount: number;
  topCategories: CategoryTotal[];
}

function getWeekBoundaries(now: Date): { thisWeekStart: Date; thisWeekEnd: Date; lastWeekStart: Date; lastWeekEnd: Date } {
  const day = now.getDay(); // 0 = Sunday
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - day);
  thisWeekStart.setHours(0, 0, 0, 0);

  const thisWeekEnd = new Date(now);
  thisWeekEnd.setHours(23, 59, 59, 999);

  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setMilliseconds(-1);

  return { thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd };
}

async function aggregateWeeklyData(userId: string, now: Date): Promise<WeeklyDigestData> {
  const { thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd } = getWeekBoundaries(now);

  const [thisWeekResult, lastWeekResult, categoryResult] = await Promise.all([
    ExpenseModel.aggregate([
      {
        $match: {
          owner: userId,
          type: 'expense',
          date: { $gte: thisWeekStart, $lte: thisWeekEnd },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]),
    ExpenseModel.aggregate([
      {
        $match: {
          owner: userId,
          type: 'expense',
          date: { $gte: lastWeekStart, $lte: lastWeekEnd },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]),
    ExpenseModel.aggregate([
      {
        $match: {
          owner: userId,
          type: 'expense',
          date: { $gte: thisWeekStart, $lte: thisWeekEnd },
        },
      },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 3 },
    ]),
  ]);

  const totalSpent = thisWeekResult[0]?.total ?? 0;
  const transactionCount = thisWeekResult[0]?.count ?? 0;
  const lastWeekTotal = lastWeekResult[0]?.total ?? 0;

  let changePercent: number | null = null;
  if (lastWeekTotal > 0) {
    changePercent = Math.round(((totalSpent - lastWeekTotal) / lastWeekTotal) * 100);
  }

  const topCategories: CategoryTotal[] = categoryResult.map(
    (row: { _id: string | null; total: number }) => ({
      category: row._id || 'Uncategorized',
      total: row.total,
    })
  );

  return { totalSpent, lastWeekTotal, changePercent, transactionCount, topCategories };
}

function formatDigestMessage(data: WeeklyDigestData): string {
  const { totalSpent, changePercent, transactionCount, topCategories } = data;

  let msg = `<b>Weekly Spending Digest</b>\n\n`;
  msg += `<b>Total Spent:</b> $${totalSpent.toFixed(2)}\n`;
  msg += `<b>Transactions:</b> ${transactionCount}\n`;

  if (changePercent !== null) {
    const arrow = changePercent > 0 ? '↑' : changePercent < 0 ? '↓' : '→';
    msg += `<b>vs Last Week:</b> ${arrow} ${Math.abs(changePercent)}%\n`;
  } else {
    msg += `<b>vs Last Week:</b> No data\n`;
  }

  if (topCategories.length > 0) {
    msg += `\n<b>Top Categories:</b>\n`;
    topCategories.forEach((cat, i) => {
      msg += `  ${i + 1}. ${cat.category} — $${cat.total.toFixed(2)}\n`;
    });
  }

  return msg;
}

export async function sendWeeklyDigestForUser(userId: string, now?: Date): Promise<boolean> {
  const currentDate = now ?? new Date();
  const data = await aggregateWeeklyData(userId, currentDate);
  const message = formatDigestMessage(data);

  const user = await UserModel.findById(userId).lean();
  if (!user?.telegramChatId) return false;

  return sendTelegramMessageToChat(user.telegramChatId, message);
}

export async function processWeeklyDigests(): Promise<number> {
  const users = await UserModel.find({
    weeklyDigestEnabled: true,
    telegramChatId: { $exists: true, $ne: '' },
  }).lean();

  let sentCount = 0;
  for (const user of users) {
    try {
      const sent = await sendWeeklyDigestForUser((user as IUser)._id.toString());
      if (sent) sentCount++;
    } catch (error) {
      console.error(`[WeeklyDigest] Failed for user ${(user as IUser)._id}:`, error);
    }
  }

  return sentCount;
}

export { aggregateWeeklyData, formatDigestMessage, getWeekBoundaries };
export type { WeeklyDigestData, CategoryTotal };
