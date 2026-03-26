process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { weeklyDigestJob, startWeeklyDigestScheduler } from '../src/jobs/weeklyDigest';
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
});
