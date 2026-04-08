/**
 * Unusual spending push notification job
 *
 * Runs daily. For each user with an Expo push token and unusual spending enabled,
 * checks recent transactions (last 24 hours) against the 90-day category average.
 * Fires if a single transaction exceeds 2x the category average.
 */

import UserModel from '../models/User';
import ExpenseModel from '../models/Expense';
import { sendExpoPushNotifications, type ExpoPushMessage } from '../utils/pushNotifications';

const UNUSUAL_SENT_KEY_PREFIX = 'unusual_';

function get90DayBounds(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  return { start, end };
}

function getLastCheckBounds(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  start.setHours(start.getHours() - 25); // 25h window to avoid gaps
  return { start, end };
}

export async function runUnusualSpendingPushJob(): Promise<number> {
  const { start: ninetyStart, end: ninetyEnd } = get90DayBounds();
  const { start: recentStart, end: recentEnd } = getLastCheckBounds();

  const users = await UserModel.find({
    expoPushToken: { $exists: true, $nin: [null, ''] },
    'pushNotificationPrefs.unusualSpending': { $ne: false },
  }).lean();

  if (users.length === 0) return 0;

  const messages: ExpoPushMessage[] = [];

  for (const user of users) {
    if (!user.expoPushToken) continue;

    // Get 90-day expense history grouped by category for average calculation
    const historicalExpenses = await ExpenseModel.find({
      owner: user._id.toString(),
      type: { $nin: ['income'] },
      date: { $gte: ninetyStart, $lte: ninetyEnd },
    })
      .select('category amount date')
      .lean();

    // Build category averages (per-transaction average)
    const categoryAmounts: Record<string, number[]> = {};
    for (const exp of historicalExpenses) {
      const cat = exp.category ?? 'Uncategorized';
      categoryAmounts[cat] = categoryAmounts[cat] ?? [];
      categoryAmounts[cat].push(exp.amount);
    }

    const categoryAvg: Record<string, number> = {};
    for (const [cat, amounts] of Object.entries(categoryAmounts)) {
      categoryAvg[cat] = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    }

    // Check recent transactions (last 25h) for anomalies
    const recentExpenses = await ExpenseModel.find({
      owner: user._id.toString(),
      type: { $nin: ['income'] },
      date: { $gte: recentStart, $lte: recentEnd },
    })
      .select('category amount description _id')
      .lean();

    const sentKeys: string[] = user.budgetAlertsSentThisMonth ?? [];

    for (const exp of recentExpenses) {
      const cat = exp.category ?? 'Uncategorized';
      const avg = categoryAvg[cat];

      if (!avg || avg <= 0) continue;

      const ratio = exp.amount / avg;
      if (ratio < 2) continue;

      // Deduplicate by expense ID — don't notify twice for same transaction
      const key = `${UNUSUAL_SENT_KEY_PREFIX}${exp._id.toString()}`;
      if (sentKeys.includes(key)) continue;

      const multiplier = ratio.toFixed(1);
      const label = exp.description ?? cat;

      messages.push({
        to: user.expoPushToken,
        title: `Unusual spend: ${cat}`,
        body: `$${exp.amount.toFixed(2)} on ${label} — ${multiplier}x your usual ${cat} spend.`,
        data: { screen: 'transactions' },
        sound: 'default',
      });

      // Mark this expense as notified
      await UserModel.findByIdAndUpdate(user._id, {
        $addToSet: { budgetAlertsSentThisMonth: key },
      });
    }
  }

  return messages.length > 0 ? sendExpoPushNotifications(messages) : 0;
}

export function startUnusualSpendingPushScheduler(): NodeJS.Timer {
  const intervalId = setInterval(
    () => {
      runUnusualSpendingPushJob().catch((err) => {
        console.error('[UnusualSpendingPush] Scheduled run failed:', err);
      });
    },
    24 * 60 * 60 * 1000 // Check once daily
  );

  console.log('[UnusualSpendingPush] Started (runs daily)');
  return intervalId;
}
