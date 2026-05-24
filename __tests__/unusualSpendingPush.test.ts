process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import UserModel from '../src/models/User';
import ExpenseModel from '../src/models/Expense';
import { runUnusualSpendingPushJob, startUnusualSpendingPushScheduler } from '../src/jobs/unusualSpendingPush';

let mongod: MongoMemoryServer;

const PUSH_TOKEN = 'ExponentPushToken[unusual-test-abc]';

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

describe('runUnusualSpendingPushJob', () => {
  it('returns 0 when there are no eligible users', async () => {
    const sent = await runUnusualSpendingPushJob();
    expect(sent).toBe(0);
  });

  it('skips users without a push token', async () => {
    await UserModel.create({ email: 'a@test.com', password: 'pwhashed' });
    const sent = await runUnusualSpendingPushJob();
    expect(sent).toBe(0);
  });

  it('skips users with unusualSpending pref set to false', async () => {
    await UserModel.create({
      email: 'b@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
      pushNotificationPrefs: { budgetAlerts: true, weeklySummary: true, unusualSpending: false },
    });
    const fetchSpy = mockFetchOk(0);
    const sent = await runUnusualSpendingPushJob();
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not send when historical expenses are empty', async () => {
    const user = await UserModel.create({
      email: 'c@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
    });
    await ExpenseModel.create({
      owner: user._id.toString(),
      type: 'expense',
      amount: 100,
      category: 'Food',
      date: new Date(),
    });
    const fetchSpy = mockFetchOk(0);
    const sent = await runUnusualSpendingPushJob();
    // 1 historical = avg = 100, recent 100, ratio=1, no notify
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a notification when a recent transaction is 2x+ the 90-day category average', async () => {
    const user = await UserModel.create({
      email: 'd@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
    });
    const now = new Date();
    const oldDate = new Date(now);
    oldDate.setDate(oldDate.getDate() - 30);

    await ExpenseModel.create([
      // Historical avg for Food = 10
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      // Recent anomaly: 50 (5x avg)
      { owner: user._id.toString(), type: 'expense', amount: 50, category: 'Food', description: 'fancy dinner', date: now },
    ]);

    const fetchSpy = mockFetchOk(1);
    const sent = await runUnusualSpendingPushJob();

    expect(sent).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body[0].to).toBe(PUSH_TOKEN);
    expect(body[0].title).toMatch(/Unusual spend: Food/);
    expect(body[0].body).toMatch(/fancy dinner/);
    // avg over 90-day window = (10+10+10+50)/4 = 20 → 50/20 = 2.5x
    expect(body[0].body).toMatch(/2\.5x/);

    const refreshed = await UserModel.findById(user._id).lean();
    expect(refreshed!.budgetAlertsSentThisMonth.some((k: string) => k.startsWith('unusual_'))).toBe(true);
  });

  it('deduplicates: does not re-notify for an expense already marked as sent', async () => {
    const user = await UserModel.create({
      email: 'e@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
    });
    const now = new Date();
    const oldDate = new Date(now);
    oldDate.setDate(oldDate.getDate() - 30);

    await ExpenseModel.create([
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
    ]);
    const anomaly = await ExpenseModel.create({
      owner: user._id.toString(),
      type: 'expense',
      amount: 100,
      category: 'Food',
      date: now,
    });

    await UserModel.findByIdAndUpdate(user._id, {
      $addToSet: { budgetAlertsSentThisMonth: `unusual_${anomaly._id.toString()}` },
    });

    const fetchSpy = mockFetchOk(0);
    const sent = await runUnusualSpendingPushJob();
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips income transactions when scanning recent activity', async () => {
    const user = await UserModel.create({
      email: 'f@test.com',
      password: 'pwhashed',
      expoPushToken: PUSH_TOKEN,
    });
    const now = new Date();
    const oldDate = new Date(now);
    oldDate.setDate(oldDate.getDate() - 30);

    await ExpenseModel.create([
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      { owner: user._id.toString(), type: 'expense', amount: 10, category: 'Food', date: oldDate },
      // A big income — should be filtered out
      { owner: user._id.toString(), type: 'income', amount: 5000, category: 'Salary', date: now },
    ]);

    const fetchSpy = mockFetchOk(0);
    const sent = await runUnusualSpendingPushJob();
    expect(sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('startUnusualSpendingPushScheduler', () => {
  it('returns a Timer object (without invoking the job during tests)', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const timer = startUnusualSpendingPushScheduler();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(timer).toBeDefined();
    clearInterval(timer as unknown as NodeJS.Timeout);
  });
});
