import { processRecurringExpenses } from '../utils/recurring';

/**
 * Background job to process recurring expenses and generate transactions
 * Should be called daily
 */
export async function processRecurringJob(): Promise<void> {
  const start = Date.now();
  try {
    await processRecurringExpenses();
    const duration = Date.now() - start;
    console.log(`[RecurringJob] Processed recurring expenses in ${duration}ms`);
  } catch (error) {
    console.error('[RecurringJob] Error processing recurring expenses:', error);
  }
}

/**
 * Start the background job scheduler for recurring expenses
 * Runs daily at midnight
 */
export function startRecurringScheduler(): NodeJS.Timer | null {
  // Run immediately on startup
  processRecurringJob().catch((error) => {
    console.error('[RecurringScheduler] Initial run failed:', error);
  });

  // Schedule to run daily at midnight (24 hours = 86400000 ms)
  const intervalId = setInterval(
    () => {
      processRecurringJob().catch((error) => {
        console.error('[RecurringScheduler] Scheduled run failed:', error);
      });
    },
    24 * 60 * 60 * 1000
  );

  console.log('[RecurringScheduler] Started recurring expense processing job (daily)');
  return intervalId;
}
