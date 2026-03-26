process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { processRecurringJob, startRecurringScheduler } from '../src/jobs/processRecurring';
import RecurringExpenseModel from '../src/models/RecurringExpense';
import ExpenseModel from '../src/models/Expense';
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
  await RecurringExpenseModel.deleteMany({});
  await ExpenseModel.deleteMany({});
  await UserModel.deleteMany({});
});

describe('processRecurringJob', () => {
  it('completes successfully with no recurring expenses', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await processRecurringJob();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RecurringJob] Processed recurring expenses in')
    );
    consoleSpy.mockRestore();
  });

  // Error path tested in processRecurring-error.test.ts via jest.mock
});

describe('startRecurringScheduler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts scheduler and runs initial job', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const intervalId = startRecurringScheduler();

    expect(intervalId).not.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[RecurringScheduler] Started recurring expense processing job (daily)'
    );

    if (intervalId) clearInterval(intervalId as unknown as number);
    consoleSpy.mockRestore();

    // Wait for initial run to complete
    await new Promise((r) => setTimeout(r, 100));
  });

  it('handles initial run failure gracefully', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    jest
      .spyOn(RecurringExpenseModel, 'find')
      .mockRejectedValueOnce(new Error('init fail'));

    const intervalId = startRecurringScheduler();

    // Wait for initial run to fail
    await new Promise((r) => setTimeout(r, 100));

    if (intervalId) clearInterval(intervalId as unknown as number);
    errorSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
