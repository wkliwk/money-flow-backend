import { sendExpoPushNotifications } from '../src/utils/pushNotifications';

afterEach(() => {
  jest.restoreAllMocks();
});

const VALID_TOKEN = 'ExponentPushToken[abc]';
const VALID_TOKEN_2 = 'ExpoPushToken[def]';

describe('sendExpoPushNotifications', () => {
  it('returns 0 immediately when no messages are provided', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const sent = await sendExpoPushNotifications([]);
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filters out invalid tokens and returns 0 when no valid messages remain', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const sent = await sendExpoPushNotifications([
      { to: 'not-an-expo-token', title: 't', body: 'b' },
      { to: 'bare-string', title: 't', body: 'b' },
    ]);
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts both ExponentPushToken[...] and ExpoPushToken[...] prefixes', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'ok' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const sent = await sendExpoPushNotifications([
      { to: VALID_TOKEN, title: 't', body: 'b' },
      { to: VALID_TOKEN_2, title: 't', body: 'b' },
    ]);
    expect(sent).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 0 sent when Expo responds non-2xx (and logs the error)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('upstream rejected', { status: 500 })
    );

    const sent = await sendExpoPushNotifications([{ to: VALID_TOKEN, title: 't', body: 'b' }]);
    expect(sent).toBe(0);
    expect(errSpy).toHaveBeenCalled();
  });

  it('counts only ok tickets even when some come back as error', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { status: 'ok' },
            { status: 'error', message: 'DeviceNotRegistered' },
            { status: 'ok' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const sent = await sendExpoPushNotifications([
      { to: VALID_TOKEN, title: 't', body: 'b' },
      { to: VALID_TOKEN, title: 't', body: 'b' },
      { to: VALID_TOKEN, title: 't', body: 'b' },
    ]);
    expect(sent).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/1 messages failed/),
      expect.any(String)
    );
  });

  it('catches network errors and continues with remaining chunks', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection reset'));

    const sent = await sendExpoPushNotifications([{ to: VALID_TOKEN, title: 't', body: 'b' }]);
    expect(sent).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      '[PushNotifications] Failed to send chunk:',
      expect.any(Error)
    );
  });

  it('chunks messages in groups of 100', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      const tickets = body.map(() => ({ status: 'ok' }));
      return new Response(JSON.stringify({ data: tickets }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const messages = Array.from({ length: 250 }, () => ({
      to: VALID_TOKEN,
      title: 't',
      body: 'b',
    }));

    const sent = await sendExpoPushNotifications(messages);
    expect(sent).toBe(250);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 100 + 100 + 50
  });
});
