import { processMonthlySummaries } from '../utils/monthlySummary';

export async function monthlySummaryJob(): Promise<void> {
  const start = Date.now();
  try {
    const count = await processMonthlySummaries();
    const duration = Date.now() - start;
    console.log(`[MonthlySummaryJob] Sent ${count} summaries in ${duration}ms`);
  } catch (error) {
    console.error('[MonthlySummaryJob] Error:', error);
  }
}

/**
 * Start monthly summary scheduler.
 * Checks every hour; only sends on the 1st of the month at or after 09:00 HKT (UTC+8).
 * Cron equivalent: 0 9 1 * * (Railway cron schedule)
 */
export function startMonthlySummaryScheduler(): NodeJS.Timer | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('[MonthlySummaryScheduler] Telegram not configured, skipping');
    return null;
  }

  let lastSentMonth = '';

  const intervalId = setInterval(
    () => {
      const now = new Date();
      // HKT = UTC+8
      const hktOffset = now.getUTCHours() + 8;
      const hktHour = hktOffset % 24;
      const crossedMidnight = hktOffset >= 24;

      const utcDate = new Date(now);
      if (crossedMidnight) utcDate.setUTCDate(utcDate.getUTCDate() + 1);
      const hktDay = utcDate.getUTCDate();

      // 1st of month at or after 09:00 HKT
      if (hktDay === 1 && hktHour >= 9) {
        const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        if (monthKey !== lastSentMonth) {
          lastSentMonth = monthKey;
          monthlySummaryJob().catch((error) => {
            console.error('[MonthlySummaryScheduler] Run failed:', error);
          });
        }
      }
    },
    60 * 60 * 1000 // Check every hour
  );

  console.log('[MonthlySummaryScheduler] Started (checks hourly, sends 1st of month 09:00 HKT)');
  return intervalId;
}
