import { processWeeklyDigests } from '../utils/weeklyDigest';

export async function weeklyDigestJob(): Promise<void> {
  const start = Date.now();
  try {
    const count = await processWeeklyDigests();
    const duration = Date.now() - start;
    console.log(`[WeeklyDigestJob] Sent ${count} digests in ${duration}ms`);
  } catch (error) {
    console.error('[WeeklyDigestJob] Error:', error);
  }
}

/**
 * Start weekly digest scheduler
 * Checks every hour; only sends on Sunday after 18:00 HKT (UTC+8)
 */
export function startWeeklyDigestScheduler(): NodeJS.Timer | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('[WeeklyDigestScheduler] Telegram not configured, skipping');
    return null;
  }

  let lastSentWeek = '';

  const intervalId = setInterval(
    () => {
      const now = new Date();
      // HKT = UTC+8
      const hktHour = (now.getUTCHours() + 8) % 24;
      const hktDay = now.getUTCDay();
      // Adjust day if HKT offset crosses midnight
      const adjustedDay = now.getUTCHours() + 8 >= 24 ? (hktDay + 1) % 7 : hktDay;

      // Sunday (0) at or after 18:00 HKT
      if (adjustedDay === 0 && hktHour >= 18) {
        const weekKey = `${now.getFullYear()}-W${getISOWeek(now)}`;
        if (weekKey !== lastSentWeek) {
          lastSentWeek = weekKey;
          weeklyDigestJob().catch((error) => {
            console.error('[WeeklyDigestScheduler] Run failed:', error);
          });
        }
      }
    },
    60 * 60 * 1000 // Check every hour
  );

  console.log('[WeeklyDigestScheduler] Started (checks hourly, sends Sunday 18:00 HKT)');
  return intervalId;
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
