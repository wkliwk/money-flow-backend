process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { processAlertsJob, startAlertScheduler } from '../src/jobs/processAlerts';
import AlertModel from '../src/models/Alert';
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
  await AlertModel.deleteMany({});
  await UserModel.deleteMany({});
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

describe('processAlertsJob', () => {
  it('completes successfully with no pending alerts', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await processAlertsJob();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AlertJob] Processed pending alerts in')
    );
    consoleSpy.mockRestore();
  });

  // Error path tested in processAlerts-error.test.ts via jest.mock
});

describe('startAlertScheduler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when Telegram is not configured', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const result = startAlertScheduler();

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[AlertScheduler] Telegram not configured, skipping alert job'
    );
    consoleSpy.mockRestore();
  });

  it('starts scheduler when Telegram is configured', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat-id';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const intervalId = startAlertScheduler();

    expect(intervalId).not.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[AlertScheduler] Started alert processing job (every 30 minutes)'
    );

    // Clean up interval to prevent leaks
    if (intervalId) clearInterval(intervalId as unknown as number);
    consoleSpy.mockRestore();

    // Wait for initial run to complete
    await new Promise((r) => setTimeout(r, 100));
  });

  it('handles initial run failure gracefully', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat-id';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Mock AlertModel.find to throw
    jest.spyOn(AlertModel, 'find').mockRejectedValueOnce(new Error('init fail'));

    const intervalId = startAlertScheduler();

    // Wait for initial run to fail
    await new Promise((r) => setTimeout(r, 100));

    if (intervalId) clearInterval(intervalId as unknown as number);
    errorSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
