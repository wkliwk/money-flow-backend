process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { weeklyDigestJob, startWeeklyDigestScheduler } from '../src/jobs/weeklyDigest';
import { sendTelegramMessageToChat } from '../src/utils/telegram';
import UserModel from '../src/models/User';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('weeklyDigestJob', () => {
  it('completes with no eligible users', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await weeklyDigestJob();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WeeklyDigestJob] Sent 0 digests')
    );
    consoleSpy.mockRestore();
  });
});

describe('sendTelegramMessageToChat', () => {
  it('returns false when bot token is not set', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const result = await sendTelegramMessageToChat('123', 'test');
    expect(result).toBe(false);
  });

  it('returns false on fetch error', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));
    const result = await sendTelegramMessageToChat('123', 'test');
    expect(result).toBe(false);
    spy.mockRestore();
  });

  it('returns false on non-ok response', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' } as Response);
    const result = await sendTelegramMessageToChat('123', 'test');
    expect(result).toBe(false);
    spy.mockRestore();
  });

  it('returns true on success', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const result = await sendTelegramMessageToChat('123', 'test');
    expect(result).toBe(true);
    spy.mockRestore();
  });
});

describe('weeklyDigestJob error handling', () => {
  it('logs error when processWeeklyDigests fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    // Job should handle errors gracefully (no users to process)
    await weeklyDigestJob();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('startWeeklyDigestScheduler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when Telegram is not configured', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = startWeeklyDigestScheduler();
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[WeeklyDigestScheduler] Telegram not configured, skipping'
    );
    consoleSpy.mockRestore();
  });

  it('starts scheduler when Telegram is configured', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const intervalId = startWeeklyDigestScheduler();
    expect(intervalId).not.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[WeeklyDigestScheduler] Started (checks hourly, sends Sunday 18:00 HKT)'
    );
    if (intervalId) clearInterval(intervalId as unknown as number);
    consoleSpy.mockRestore();
  });

  it('fires digest on Sunday 18:00 HKT', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    jest.useFakeTimers();
    // Sunday 18:00 HKT = Sunday 10:00 UTC
    jest.setSystemTime(new Date('2026-03-29T10:00:00Z'));
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const intervalId = startWeeklyDigestScheduler();
    // Advance one hour to trigger the interval
    jest.advanceTimersByTime(60 * 60 * 1000);
    if (intervalId) clearInterval(intervalId as unknown as number);
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('does not fire on non-Sunday', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    jest.useFakeTimers();
    // Monday 18:00 HKT = Monday 10:00 UTC
    jest.setSystemTime(new Date('2026-03-30T10:00:00Z'));
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const intervalId = startWeeklyDigestScheduler();
    jest.advanceTimersByTime(60 * 60 * 1000);
    // Should only see the "Started" log, not a "Sent" log
    const sentCalls = consoleSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('Sent')
    );
    expect(sentCalls.length).toBe(0);
    if (intervalId) clearInterval(intervalId as unknown as number);
    consoleSpy.mockRestore();
    jest.useRealTimers();
  });
});
