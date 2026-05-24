process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import UserModel from '../src/models/User';
import ExpenseModel from '../src/models/Expense';
import { runBudgetAlertPushJob, startBudgetAlertPushScheduler } from '../src/jobs/budgetAlertPush';

let mongod: MongoMemoryServer;
const PUSH_TOKEN = 'ExponentPushToken[budget-test-123]';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
  jest.restoreAllMocks();
});

function mockFetchOk(okCount: number) {
  const tickets = Array(okCount).fill({ status: 'ok' });
  return jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: tickets }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

describe('runBudgetAlertPushJob', () => {
  it('returns 0 when no users have budgets configured', async () => {
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(0);
  });

  it('skips users with budgetAlerts pref disabled', async () => {
    await UserModel.create({
      email: 'a@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      pushNotificationPrefs: { budgetAlerts: false, weeklySummary: true, unusualSpending: true },
      budgets: [{ category: 'Food', limit: 100 }],
    });
    const fetchSpy = mockFetchOk(0);
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips budget items with zero or negative limit', async () => {
    const user = await UserModel.create({
      email: 'b@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      budgets: [{ category: 'Food', limit: 0 }, { category: 'Drink', limit: -5 }],
    });
    await ExpenseModel.create([
      { owner: user._id.toString(), type: 'expense', amount: 50, category: 'Food', date: new Date() },
    ]);
    const fetchSpy = mockFetchOk(0);
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a 75% threshold alert when spend crosses 75% but not 100%', async () => {
    const user = await UserModel.create({
      email: 'c@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      budgets: [{ category: 'Food', limit: 100 }],
    });
    await ExpenseModel.create([
      { owner: user._id.toString(), type: 'expense', amount: 80, category: 'Food', date: new Date() },
    ]);

    const fetchSpy = mockFetchOk(1);
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(1);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body[0].title).toMatch(/Food budget at 80%/);
    expect(body[0].body).toMatch(/20\.00 remaining/);

    const refreshed = await UserModel.findById(user._id).lean();
    expect(refreshed!.budgetAlertsSentThisMonth.some((k: string) => k.startsWith('Food_75_'))).toBe(true);
  });

  it('sends a 100% threshold alert when spend exceeds limit (and does not also send 75%)', async () => {
    const user = await UserModel.create({
      email: 'd@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      budgets: [{ category: 'Food', limit: 100 }],
    });
    await ExpenseModel.create([
      { owner: user._id.toString(), type: 'expense', amount: 120, category: 'Food', date: new Date() },
    ]);

    const fetchSpy = mockFetchOk(1);
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(1);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveLength(1);
    expect(body[0].title).toMatch(/Budget exceeded: Food/);

    const refreshed = await UserModel.findById(user._id).lean();
    expect(refreshed!.budgetAlertsSentThisMonth.some((k: string) => k.startsWith('Food_100_'))).toBe(true);
    expect(refreshed!.budgetAlertsSentThisMonth.some((k: string) => k.startsWith('Food_75_'))).toBe(false);
  });

  it('does not re-fire an alert that was already sent this month', async () => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const user = await UserModel.create({
      email: 'e@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      budgets: [{ category: 'Food', limit: 100 }],
      budgetAlertsSentThisMonth: [`Food_75_${monthKey}`],
    });
    await ExpenseModel.create([
      { owner: user._id.toString(), type: 'expense', amount: 80, category: 'Food', date: new Date() },
    ]);
    const fetchSpy = mockFetchOk(0);
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores income transactions when calculating budget spend', async () => {
    const user = await UserModel.create({
      email: 'f@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      budgets: [{ category: 'Food', limit: 100 }],
    });
    await ExpenseModel.create([
      { owner: user._id.toString(), type: 'expense', amount: 40, category: 'Food', date: new Date() },
      { owner: user._id.toString(), type: 'income', amount: 500, category: 'Food', date: new Date() },
    ]);
    const fetchSpy = mockFetchOk(0);
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends alerts for multiple users in one run', async () => {
    const u1 = await UserModel.create({
      email: 'g1@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      budgets: [{ category: 'Food', limit: 100 }],
    });
    const u2 = await UserModel.create({
      email: 'g2@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      budgets: [{ category: 'Transport', limit: 50 }],
    });
    await ExpenseModel.create([
      { owner: u1._id.toString(), type: 'expense', amount: 110, category: 'Food', date: new Date() },
      { owner: u2._id.toString(), type: 'expense', amount: 60, category: 'Transport', date: new Date() },
    ]);

    const fetchSpy = mockFetchOk(2);
    const sent = await runBudgetAlertPushJob();
    expect(sent).toBe(2);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveLength(2);
  });
});

describe('startBudgetAlertPushScheduler', () => {
  it('returns a Timer object and triggers initial run', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const timer = startBudgetAlertPushScheduler();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(timer).toBeDefined();
    clearInterval(timer as unknown as NodeJS.Timeout);
  });
});
