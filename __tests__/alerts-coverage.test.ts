process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import UserModel from '../src/models/User';
import ExpenseModel from '../src/models/Expense';
import AlertModel from '../src/models/Alert';
import {
  checkAndQueueBudgetAlerts,
  sendTelegramMessage,
  processPendingAlerts,
} from '../src/utils/alerts';

let mongoServer: MongoMemoryServer;
let testUserId: string;

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
  await ExpenseModel.deleteMany({});
  await AlertModel.deleteMany({});

  const userId = new mongoose.Types.ObjectId();
  testUserId = userId.toString();
  await UserModel.create({
    _id: userId,
    email: `alerts-cov-${Date.now()}@example.com`,
    password: 'hashed_password',
    budgets: [],
  });
}, 15000);

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  jest.restoreAllMocks();
});

describe('sendTelegramMessage', () => {
  it('returns false when TELEGRAM_BOT_TOKEN is not set', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await sendTelegramMessage('test');
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });

  it('returns false when TELEGRAM_CHAT_ID is not set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    delete process.env.TELEGRAM_CHAT_ID;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await sendTelegramMessage('test');
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });

  it('returns true on successful Telegram API call', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';

    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const result = await sendTelegramMessage('Hello');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/botfake-token/sendMessage',
      expect.objectContaining({ method: 'POST' })
    );
    mockFetch.mockRestore();
  });

  it('returns false on Telegram API error response', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response);

    const result = await sendTelegramMessage('Hello');
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'Telegram API error:',
      403,
      'Forbidden'
    );
    errorSpy.mockRestore();
  });

  it('returns false on fetch exception', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const result = await sendTelegramMessage('Hello');
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error sending Telegram message:',
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

describe('processPendingAlerts', () => {
  it('marks alerts as sent when Telegram succeeds', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await AlertModel.create({
      userId: testUserId,
      category: 'Food',
      amount: 100,
      limit: 100,
      percentUsed: 100,
      message: 'Test alert',
      sent: false,
    });

    await processPendingAlerts();

    const alert = await AlertModel.findOne({ category: 'Food' });
    expect(alert?.sent).toBe(true);
    expect(alert?.sentAt).toBeDefined();
  });

  it('does not mark alert as sent when Telegram fails', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await AlertModel.create({
      userId: testUserId,
      category: 'Food',
      amount: 100,
      limit: 100,
      percentUsed: 100,
      message: 'Test alert',
      sent: false,
    });

    await processPendingAlerts();

    const alert = await AlertModel.findOne({ category: 'Food' });
    expect(alert?.sent).toBe(false);
    errorSpy.mockRestore();
  });

  it('processes multiple pending alerts', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID = 'fake-chat';

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await AlertModel.create([
      {
        userId: testUserId,
        category: 'Food',
        amount: 100,
        limit: 100,
        percentUsed: 100,
        message: 'Alert 1',
        sent: false,
      },
      {
        userId: testUserId,
        category: 'Transport',
        amount: 200,
        limit: 200,
        percentUsed: 100,
        message: 'Alert 2',
        sent: false,
      },
    ]);

    await processPendingAlerts();

    const alerts = await AlertModel.find({ sent: true });
    expect(alerts).toHaveLength(2);
  });

  it('handles DB error gracefully', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(AlertModel, 'find').mockRejectedValueOnce(new Error('DB fail'));

    await processPendingAlerts();

    expect(errorSpy).toHaveBeenCalledWith(
      'Error processing pending alerts:',
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

describe('checkAndQueueBudgetAlerts - edge cases', () => {
  it('returns early for nonexistent user', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await checkAndQueueBudgetAlerts(fakeId);
    const alerts = await AlertModel.find({});
    expect(alerts).toHaveLength(0);
  });

  it('returns early for user with no budgets', async () => {
    await checkAndQueueBudgetAlerts(testUserId);
    const alerts = await AlertModel.find({});
    expect(alerts).toHaveLength(0);
  });

  it('uses default threshold of 0.9 when not specified', async () => {
    await UserModel.findByIdAndUpdate(testUserId, {
      $set: {
        budgets: [
          {
            category: 'Food',
            limit: 100,
            enable_alerts: true,
            // no alert_threshold set - should default to 0.9
          },
        ],
      },
    });

    const dateStr = new Date().toISOString().split('T')[0];
    await ExpenseModel.create({
      owner: testUserId,
      description: 'Big meal',
      amount: 91, // 91% - exceeds default 90% threshold
      category: 'Food',
      type: 'expense',
      date: dateStr,
    });

    await checkAndQueueBudgetAlerts(testUserId);

    const alerts = await AlertModel.find({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain('Budget Alert: Food');
  });

  it('handles zero-limit budget gracefully', async () => {
    await UserModel.findByIdAndUpdate(testUserId, {
      $set: {
        budgets: [
          {
            category: 'Test',
            limit: 0,
            enable_alerts: true,
          },
        ],
      },
    });

    await checkAndQueueBudgetAlerts(testUserId);

    const alerts = await AlertModel.find({});
    expect(alerts).toHaveLength(0);
  });

  it('handles category with no expenses', async () => {
    await UserModel.findByIdAndUpdate(testUserId, {
      $set: {
        budgets: [
          {
            category: 'Travel',
            limit: 500,
            alert_threshold: 0.5,
            enable_alerts: true,
          },
        ],
      },
    });

    await checkAndQueueBudgetAlerts(testUserId);

    const alerts = await AlertModel.find({});
    expect(alerts).toHaveLength(0);
  });

  it('handles DB error gracefully in checkAndQueueBudgetAlerts', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(UserModel, 'findById').mockImplementation(() => {
      throw new Error('DB fail');
    });

    await checkAndQueueBudgetAlerts(testUserId);

    expect(errorSpy).toHaveBeenCalledWith(
      'Error checking budget alerts:',
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});
