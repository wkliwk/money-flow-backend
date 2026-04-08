/**
 * Weekly summary push notification job
 *
 * Runs Sunday 18:00 UTC. For each user with an Expo push token and
 * weekly summary enabled, sends a "This week you spent $X, earned $Y. Net: +/-$Z" push.
 */

import UserModel from '../models/User';
import ExpenseModel from '../models/Expense';
import { sendExpoPushNotifications, type ExpoPushMessage } from '../utils/pushNotifications';

function getWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  // Start of current week (Monday)
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysFromMonday = (day + 6) % 7;
  const start = new Date(now);
  start.setUTCDate(now.getUTCDate() - daysFromMonday);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

export async function runWeeklySummaryPushJob(): Promise<number> {
  const { start, end } = getWeekBounds();

  const users = await UserModel.find({
    expoPushToken: { $exists: true, $nin: [null, ''] },
    'pushNotificationPrefs.weeklySummary': { $ne: false },
  }).lean();

  if (users.length === 0) return 0;

  const messages: ExpoPushMessage[] = [];

  for (const user of users) {
    if (!user.expoPushToken) continue;

    const currency = user.baseCurrency ?? 'USD';

    const expenses = await ExpenseModel.find({
      owner: user._id.toString(),
      date: { $gte: start, $lte: end },
    })
      .select('type amount')
      .lean();

    let totalExpense = 0;
    let totalIncome = 0;

    for (const exp of expenses) {
      if (exp.type === 'income') {
        totalIncome += exp.amount;
      } else {
        totalExpense += exp.amount;
      }
    }

    const net = totalIncome - totalExpense;
    const netSign = net >= 0 ? '+' : '-';
    const netFormatted = `${netSign}${formatCurrency(Math.abs(net), currency)}`;

    const body =
      totalIncome > 0
        ? `Spent ${formatCurrency(totalExpense, currency)}, earned ${formatCurrency(totalIncome, currency)}. Net: ${netFormatted}`
        : `You spent ${formatCurrency(totalExpense, currency)} this week.`;

    messages.push({
      to: user.expoPushToken,
      title: 'Your weekly summary',
      body,
      data: { screen: 'reports' },
      sound: 'default',
    });

  }

  return messages.length > 0 ? sendExpoPushNotifications(messages) : 0;
}

export function startWeeklySummaryPushScheduler(): NodeJS.Timer {
  let lastSentWeek = '';

  const intervalId = setInterval(
    () => {
      const now = new Date();
      // Sunday = 0, send at 18:00 UTC
      if (now.getUTCDay() === 0 && now.getUTCHours() >= 18) {
        const weekKey = `${now.getUTCFullYear()}-W${getISOWeek(now)}`;
        if (weekKey !== lastSentWeek) {
          lastSentWeek = weekKey;
          runWeeklySummaryPushJob().catch((err) => {
            console.error('[WeeklySummaryPush] Run failed:', err);
          });
        }
      }
    },
    60 * 60 * 1000 // Check every hour
  );

  console.log('[WeeklySummaryPush] Started (checks hourly, sends Sunday 18:00 UTC)');
  return intervalId;
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
