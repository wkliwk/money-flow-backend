import { processPendingAlerts } from '../utils/alerts';

/**
 * Background job to process pending alert queue
 * Should be called every 30 minutes
 */
export async function processAlertsJob(): Promise<void> {
  const start = Date.now();
  try {
    await processPendingAlerts();
    const duration = Date.now() - start;
    console.log(`[AlertJob] Processed pending alerts in ${duration}ms`);
  } catch (error) {
    console.error('[AlertJob] Error processing alerts:', error);
  }
}

/**
 * Start the background job scheduler
 */
export function startAlertScheduler(): NodeJS.Timer | null {
  // Only start if Telegram is configured
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('[AlertScheduler] Telegram not configured, skipping alert job');
    return null;
  }

  // Run immediately on startup, then every 30 minutes (1800000 ms)
  processAlertsJob().catch((error) => {
    console.error('[AlertJob] Initial run failed:', error);
  });

  const intervalId = setInterval(
    () => {
      processAlertsJob().catch((error) => {
        console.error('[AlertJob] Scheduled run failed:', error);
      });
    },
    30 * 60 * 1000
  );

  console.log('[AlertScheduler] Started alert processing job (every 30 minutes)');
  return intervalId;
}
