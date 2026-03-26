import UserModel from '../models/User';
import ExpenseModel from '../models/Expense';
import AlertModel from '../models/Alert';

/**
 * Check if an expense causes any budget threshold to be exceeded
 * and queue alert notifications for Telegram
 */
export async function checkAndQueueBudgetAlerts(userId: string): Promise<void> {
  try {
    const user = await UserModel.findById(userId).lean();
    if (!user || !user.budgets || user.budgets.length === 0) return;

    // Get current month boundaries
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Get all expenses for current month
    const expenses = await ExpenseModel.find(
      {
        owner: userId,
        type: 'expense',
        date: { $gte: monthStart, $lte: monthEnd },
      },
      { category: 1, amount: 1 }
    ).lean();

    // Calculate spend by category
    const categorySpend: { [key: string]: number } = {};
    expenses.forEach((exp) => {
      const cat = exp.category || 'Uncategorized';
      categorySpend[cat] = (categorySpend[cat] || 0) + exp.amount;
    });

    // Check each budget for alerts
    for (const budget of user.budgets) {
      if (!budget.enable_alerts) continue;

      const spend = categorySpend[budget.category] || 0;
      const threshold = budget.alert_threshold || 0.9;
      const percentUsed = budget.limit > 0 ? (spend / budget.limit) * 100 : 0;

      // Queue alert if threshold exceeded
      if (percentUsed >= threshold * 100) {
        // Check if we already have an unsent alert for this category this month
        const existingAlert = await AlertModel.findOne({
          userId,
          category: budget.category,
          sent: false,
          createdAt: { $gte: monthStart },
        });

        if (!existingAlert) {
          const remaining = Math.max(0, budget.limit - spend);
          const message = formatAlertMessage(
            budget.category,
            spend,
            budget.limit,
            remaining,
            Math.round(percentUsed)
          );

          await AlertModel.create({
            userId,
            category: budget.category,
            amount: spend,
            limit: budget.limit,
            percentUsed: Math.round(percentUsed),
            message,
            sent: false,
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking budget alerts:', error);
  }
}

/**
 * Format alert message for Telegram
 */
function formatAlertMessage(
  category: string,
  spend: number,
  limit: number,
  remaining: number,
  percentUsed: number
): string {
  return (
    `🚨 Budget Alert: ${category}\n\n` +
    `Spent: $${spend.toFixed(2)}\n` +
    `Limit: $${limit.toFixed(2)}\n` +
    `Remaining: $${remaining.toFixed(2)}\n` +
    `Usage: ${percentUsed}%`
  );
}

/**
 * Send Telegram message
 */
export async function sendTelegramMessage(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('Telegram env vars not configured, skipping notification');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      console.error('Telegram API error:', response.status, response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    return false;
  }
}

/**
 * Process pending alert queue and send via Telegram
 */
export async function processPendingAlerts(): Promise<void> {
  try {
    const unsent = await AlertModel.find({ sent: false });

    for (const alert of unsent) {
      const sent = await sendTelegramMessage(alert.message);
      if (sent) {
        await AlertModel.updateOne(
          { _id: alert._id },
          { $set: { sent: true, sentAt: new Date() } }
        );
      }
    }
  } catch (error) {
    console.error('Error processing pending alerts:', error);
  }
}
