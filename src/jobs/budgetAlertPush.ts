/**
 * Budget threshold push notification job
 *
 * Runs daily. For each user with an Expo push token and budget alerts enabled:
 * - Calculates monthly spend per category
 * - Fires at 75% threshold (first time this month)
 * - Fires at 100% threshold (first time this month)
 * - Deduplicates using budgetAlertsSentThisMonth field on User
 */

import UserModel from '../models/User';
import ExpenseModel from '../models/Expense';
import { sendExpoPushNotifications, type ExpoPushMessage } from '../utils/pushNotifications';

function getCurrentMonthBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function getMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function alertKey(category: string, threshold: number, monthKey: string): string {
  return `${category}_${threshold}_${monthKey}`;
}

export async function runBudgetAlertPushJob(): Promise<number> {
  const { start, end } = getCurrentMonthBounds();
  const monthKey = getMonthKey();

  // Find users with a push token and budget alerts enabled
  const users = await UserModel.find({
    expoPushToken: { $exists: true, $nin: [null, ''] },
    'pushNotificationPrefs.budgetAlerts': { $ne: false },
    budgets: { $exists: true, $not: { $size: 0 } },
  }).lean();

  if (users.length === 0) return 0;

  const messages: ExpoPushMessage[] = [];
  // Track which users need their budgetAlertsSentThisMonth updated
  const updates: Array<{ userId: string; keys: string[] }> = [];

  for (const user of users) {
    if (!user.expoPushToken) continue;

    // Get current month spend per category
    const expenses = await ExpenseModel.find({
      owner: user._id.toString(),
      type: { $nin: ['income'] },
      date: { $gte: start, $lte: end },
    })
      .select('category amount')
      .lean();

    const spendByCategory: Record<string, number> = {};
    for (const exp of expenses) {
      const cat = exp.category ?? 'Uncategorized';
      spendByCategory[cat] = (spendByCategory[cat] ?? 0) + exp.amount;
    }

    const sentKeys = user.budgetAlertsSentThisMonth ?? [];
    const newKeys: string[] = [];

    for (const budget of user.budgets ?? []) {
      if (!budget.limit || budget.limit <= 0) continue;

      const spent = spendByCategory[budget.category] ?? 0;
      const pct = (spent / budget.limit) * 100;

      // Check 100% threshold
      const key100 = alertKey(budget.category, 100, monthKey);
      if (pct >= 100 && !sentKeys.includes(key100)) {
        messages.push({
          to: user.expoPushToken,
          title: `Budget exceeded: ${budget.category}`,
          body: `You have spent $${spent.toFixed(2)} of your $${budget.limit.toFixed(2)} ${budget.category} budget this month.`,
          data: { screen: 'budgets', category: budget.category },
          sound: 'default',
        });
        newKeys.push(key100);
        continue; // Don't also send 75% if 100% fires
      }

      // Check 75% threshold
      const key75 = alertKey(budget.category, 75, monthKey);
      if (pct >= 75 && !sentKeys.includes(key75)) {
        const remaining = (budget.limit - spent).toFixed(2);
        messages.push({
          to: user.expoPushToken,
          title: `${budget.category} budget at ${Math.round(pct)}%`,
          body: `$${remaining} remaining in your ${budget.category} budget this month.`,
          data: { screen: 'budgets', category: budget.category },
          sound: 'default',
        });
        newKeys.push(key75);
      }
    }

    if (newKeys.length > 0) {
      updates.push({ userId: user._id.toString(), keys: newKeys });
    }
  }

  // Send all messages
  const sent = messages.length > 0 ? await sendExpoPushNotifications(messages) : 0;

  // Persist sent keys so we don't re-send (only mark as sent if push succeeded)
  // We mark optimistically — Expo may queue even if not immediately delivered
  for (const { userId, keys } of updates) {
    await UserModel.findByIdAndUpdate(userId, {
      $addToSet: { budgetAlertsSentThisMonth: { $each: keys } },
    });
  }

  return sent;
}

export function startBudgetAlertPushScheduler(): NodeJS.Timer {
  // Run once at startup then every 6 hours
  void runBudgetAlertPushJob().catch((err) => {
    console.error('[BudgetAlertPush] Initial run failed:', err);
  });

  const intervalId = setInterval(
    () => {
      runBudgetAlertPushJob().catch((err) => {
        console.error('[BudgetAlertPush] Scheduled run failed:', err);
      });
    },
    6 * 60 * 60 * 1000
  );

  console.log('[BudgetAlertPush] Started (runs every 6 hours)');
  return intervalId;
}
