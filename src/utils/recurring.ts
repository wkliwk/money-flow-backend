import RecurringExpenseModel, { RecurringFrequency, IRecurringExpense } from '../models/RecurringExpense';
import ExpenseModel from '../models/Expense';

/**
 * Calculate the next occurrence date for a recurring expense based on frequency
 */
export function calculateNextOccurrence(date: Date, frequency: RecurringFrequency): Date {
  const next = new Date(date);
  const originalDay = next.getDate();

  switch (frequency) {
    case 'DAILY':
      next.setDate(next.getDate() + 1);
      break;
    case 'WEEKLY':
      next.setDate(next.getDate() + 7);
      break;
    case 'MONTHLY': {
      const year = next.getFullYear();
      const month = next.getMonth();
      // Add one month and keep the same day, but cap at the last day of month
      const lastDayOfNextMonth = new Date(year, month + 2, 0).getDate();
      next.setMonth(month + 1);
      next.setDate(Math.min(originalDay, lastDayOfNextMonth));
      break;
    }
    case 'QUARTERLY': {
      const year = next.getFullYear();
      const month = next.getMonth();
      // Add 3 months and keep the same day, but cap at the last day of month
      const lastDayOfTargetMonth = new Date(year, month + 4, 0).getDate();
      next.setMonth(month + 3);
      next.setDate(Math.min(originalDay, lastDayOfTargetMonth));
      break;
    }
    case 'YEARLY':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }

  return next;
}

/**
 * Check if a recurring expense should generate a transaction today
 */
function shouldGenerateTransaction(
  recurring: IRecurringExpense,
  lastGenerated?: Date
): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(recurring.start_date);
  startDate.setHours(0, 0, 0, 0);

  // Not started yet
  if (startDate > today) {
    return false;
  }

  // Already expired
  if (recurring.end_date) {
    const endDate = new Date(recurring.end_date);
    endDate.setHours(0, 0, 0, 0);
    if (endDate < today) {
      return false;
    }
  }

  // If no last generated, check if start date is today or past
  if (!lastGenerated) {
    return startDate <= today;
  }

  // Check if next occurrence is today or past
  const lastGenDate = new Date(lastGenerated);
  lastGenDate.setHours(0, 0, 0, 0);
  const nextOccurrence = calculateNextOccurrence(lastGenDate, recurring.frequency);
  nextOccurrence.setHours(0, 0, 0, 0);

  return nextOccurrence <= today;
}

/**
 * Process all recurring expenses and generate transactions for today
 * Called daily by the cron job
 */
export async function processRecurringExpenses(): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recurringExpenses = await RecurringExpenseModel.find({
      start_date: { $lte: today },
      $or: [{ end_date: { $exists: false } }, { end_date: { $gte: today } }],
    });

    for (const recurring of recurringExpenses) {
      try {
        // Find the most recent generated expense for this recurring item
        const lastGenerated = await ExpenseModel.findOne(
          {
            owner: recurring.userId,
            description: recurring.name,
            category: recurring.category,
            amount: recurring.amount,
            type: 'expense',
          },
          { createdAt: 1 },
          { sort: { createdAt: -1 } }
        ).lean();

        // Check if we should generate a new transaction
        if (shouldGenerateTransaction(recurring, lastGenerated?.createdAt as Date)) {
          // Create the expense
          await ExpenseModel.create({
            owner: recurring.userId,
            description: recurring.name,
            amount: recurring.amount,
            category: recurring.category,
            type: 'expense',
            date: today,
            notes: `Auto-generated from recurring: ${recurring.name}`,
          });
        }
      } catch (error) {
        console.error(`Error processing recurring expense ${recurring._id}:`, error);
      }
    }
  } catch (error) {
    console.error('Error processing recurring expenses:', error);
  }
}

/**
 * Validate recurring expense data
 */
export function validateRecurringData(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('name is required and must be a non-empty string');
  }

  if (!data.amount || typeof data.amount !== 'number' || data.amount <= 0) {
    errors.push('amount is required and must be a positive number');
  }

  if (!data.start_date) {
    errors.push('start_date is required');
  } else {
    const startDate = new Date(data.start_date);
    if (isNaN(startDate.getTime())) {
      errors.push('start_date must be a valid date');
    }
  }

  if (data.end_date) {
    const endDate = new Date(data.end_date);
    if (isNaN(endDate.getTime())) {
      errors.push('end_date must be a valid date');
    } else if (data.start_date) {
      const startDate = new Date(data.start_date);
      if (endDate < startDate) {
        errors.push('end_date must be after start_date');
      }
    }
  }

  if (!data.frequency || !['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].includes(data.frequency)) {
    errors.push(
      'frequency is required and must be one of: DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY'
    );
  }

  return { valid: errors.length === 0, errors };
}
