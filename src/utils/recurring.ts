import RecurringExpenseModel, { RecurringFrequency, IRecurringExpense } from '../models/RecurringExpense';
import ExpenseModel from '../models/Expense';

export interface ProcessingResult {
  processed: number;
  expensesCreated: number;
  errors: number;
  details: Array<{
    recurringId: string;
    name: string;
    expensesCreated: number;
    error?: string;
  }>;
}

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
      const lastDayOfNextMonth = new Date(year, month + 2, 0).getDate();
      // Set date to 1 first to avoid overflow when setting month
      next.setDate(1);
      next.setMonth(month + 1);
      next.setDate(Math.min(originalDay, lastDayOfNextMonth));
      break;
    }
    case 'QUARTERLY': {
      const year = next.getFullYear();
      const month = next.getMonth();
      const lastDayOfTargetMonth = new Date(year, month + 4, 0).getDate();
      // Set date to 1 first to avoid overflow when setting month
      next.setDate(1);
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
 * Normalize a date to midnight UTC for consistent comparison
 */
function toMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Process a single recurring expense, creating all missed expenses up to today.
 * Uses processedUntil to guarantee idempotency -- if the job runs twice,
 * no duplicate expenses are created.
 */
async function processSingleRecurring(
  recurring: IRecurringExpense
): Promise<{ expensesCreated: number }> {
  const now = new Date();
  const today = toMidnight(now);
  let expensesCreated = 0;

  // Determine the starting point for generating expenses.
  // If processedUntil exists, we start from there (already processed up to that date).
  // Otherwise, start from start_date (first occurrence).
  let cursor: Date;
  if (recurring.processedUntil) {
    // processedUntil marks the last date we created an expense for,
    // so advance to the next occurrence from there
    cursor = calculateNextOccurrence(new Date(recurring.processedUntil), recurring.frequency);
  } else {
    // Never processed: first expense should be on start_date
    cursor = toMidnight(new Date(recurring.start_date));
  }

  // Cap at end_date if set
  const endDate = recurring.end_date ? toMidnight(new Date(recurring.end_date)) : null;

  // Generate all missed expenses up to today
  // Safety: cap at 365 iterations to prevent runaway loops
  let iterations = 0;
  const MAX_ITERATIONS = 365;

  while (toMidnight(cursor) <= today && iterations < MAX_ITERATIONS) {
    // Stop if past end_date
    if (endDate && toMidnight(cursor) > endDate) {
      break;
    }

    // Create the expense entry
    await ExpenseModel.create({
      owner: recurring.userId,
      description: recurring.description
        ? `${recurring.name} - ${recurring.description}`
        : recurring.name,
      amount: recurring.amount,
      category: recurring.category || undefined,
      type: 'expense',
      date: new Date(cursor),
    });

    expensesCreated++;

    // Update processedUntil atomically to ensure idempotency
    await RecurringExpenseModel.updateOne(
      { _id: recurring._id },
      {
        $set: {
          processedUntil: new Date(cursor),
          lastProcessedDate: now,
          nextDueDate: calculateNextOccurrence(new Date(cursor), recurring.frequency),
        },
      }
    );

    // Advance cursor
    cursor = calculateNextOccurrence(new Date(cursor), recurring.frequency);
    iterations++;
  }

  return { expensesCreated };
}

/**
 * Process all due recurring expenses.
 * Idempotent: uses processedUntil to track what's been generated.
 * Back-creates missed expenses if the server was down.
 */
export async function processRecurringExpenses(): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    processed: 0,
    expensesCreated: 0,
    errors: 0,
    details: [],
  };

  const today = toMidnight(new Date());

  // Find all active recurring expenses that are due.
  // A recurring expense is due if:
  // 1. It has nextDueDate <= today, OR
  // 2. It has no processedUntil and start_date <= today (legacy/new records)
  const recurringExpenses = await RecurringExpenseModel.find({
    active: { $ne: false },
    start_date: { $lte: today },
    $and: [
      {
        $or: [
          { end_date: { $exists: false } },
          { end_date: null },
          { end_date: { $gte: today } },
        ],
      },
      {
        $or: [
          { nextDueDate: { $lte: today } },
          { nextDueDate: { $exists: false } },
          { processedUntil: { $exists: false }, start_date: { $lte: today } },
        ],
      },
    ],
  });

  for (const recurring of recurringExpenses) {
    try {
      const { expensesCreated } = await processSingleRecurring(recurring);
      result.processed++;
      result.expensesCreated += expensesCreated;
      result.details.push({
        recurringId: String(recurring._id),
        name: recurring.name,
        expensesCreated,
      });

      if (expensesCreated > 0) {
        console.log(
          `[RecurringProcessor] Created ${expensesCreated} expense(s) for "${recurring.name}" (${recurring._id})`
        );
      }
    } catch (error) {
      result.errors++;
      const message = error instanceof Error ? error.message : String(error);
      result.details.push({
        recurringId: String(recurring._id),
        name: recurring.name,
        expensesCreated: 0,
        error: message,
      });
      console.error(
        `[RecurringProcessor] Error processing "${recurring.name}" (${recurring._id}):`,
        error
      );
    }
  }

  return result;
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
