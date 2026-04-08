/**
 * Expo Push Notifications utility
 * Sends push notifications via the Expo Push API (no Firebase/APNs required)
 */

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data: ExpoPushTicket[];
}

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

function isValidExpoPushToken(token: string): boolean {
  return (
    token.startsWith('ExponentPushToken[') ||
    token.startsWith('ExpoPushToken[')
  );
}

/**
 * Send one or more push notifications via the Expo Push API.
 * Returns the number of successfully accepted messages.
 */
export async function sendExpoPushNotifications(
  messages: ExpoPushMessage[]
): Promise<number> {
  const validMessages = messages.filter((m) => isValidExpoPushToken(m.to));
  if (validMessages.length === 0) return 0;

  // Expo accepts up to 100 messages per request
  const chunks: ExpoPushMessage[][] = [];
  for (let i = 0; i < validMessages.length; i += 100) {
    chunks.push(validMessages.slice(i, i + 100));
  }

  let sent = 0;

  for (const chunk of chunks) {
    try {
      const response = await fetch(EXPO_PUSH_API, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        console.error(
          `[PushNotifications] HTTP error ${response.status}: ${await response.text()}`
        );
        continue;
      }

      const result = (await response.json()) as ExpoPushResponse;
      const okCount = result.data.filter((t) => t.status === 'ok').length;
      sent += okCount;

      const errors = result.data.filter((t) => t.status === 'error');
      if (errors.length > 0) {
        console.error(
          `[PushNotifications] ${errors.length} messages failed:`,
          errors.map((e) => e.message).join(', ')
        );
      }
    } catch (err) {
      console.error('[PushNotifications] Failed to send chunk:', err);
    }
  }

  return sent;
}

export type { ExpoPushMessage };
