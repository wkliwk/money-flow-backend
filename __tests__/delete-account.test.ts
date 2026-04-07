process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import ExpenseModel from '../src/models/Expense';
import GoalModel from '../src/models/Goal';
import TransactionTemplateModel from '../src/models/TransactionTemplate';
import RecurringExpenseModel from '../src/models/RecurringExpense';
import AccountModel from '../src/models/Account';
import NetWorthModel from '../src/models/NetWorth';
import { WeeklyPulseModel } from '../src/models/WeeklyPulse';
import AlertModel from '../src/models/Alert';
import ItemPriceModel from '../src/models/ItemPrice';
import UserModel from '../src/models/User';

let mongod: MongoMemoryServer;

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
});

const registerAndLogin = async (
  email = 'delete-me@example.com',
  password = 'password123'
): Promise<{ token: string; userId: string }> => {
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password });
  const token = res.body.token as string;
  const decoded = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString()
  ) as { userId: string };
  return { token, userId: decoded.userId };
};

describe('DELETE /auth/account', () => {
  it('deletes user and all associated data', async () => {
    const { token, userId } = await registerAndLogin();

    // Seed data across all collections
    await Promise.all([
      ExpenseModel.create({ owner: userId, amount: 100, category: 'food', date: new Date() }),
      ExpenseModel.create({ owner: userId, amount: 50, category: 'transport', date: new Date() }),
      GoalModel.create({ userId, name: 'Save 10k', targetAmount: 10000, currentAmount: 0 }),
      TransactionTemplateModel.create({ owner: userId, name: 'Rent', amount: 5000, category: 'housing', frequency: 'monthly' }),
      RecurringExpenseModel.create({ userId, name: 'Netflix', amount: 79, category: 'entertainment', frequency: 'MONTHLY', start_date: new Date(), nextDueDate: new Date() }),
      AccountModel.create({ userId, name: 'HSBC', type: 'checking', balance: 5000, currency: 'HKD' }),
      NetWorthModel.create({ userId, date: new Date(), assets: 10000, liabilities: 2000, netWorth: 8000 }),
      WeeklyPulseModel.create({
        userId,
        weekStart: '2024-01-01',
        narrative: 'Test week summary',
        stats: { totalSpend: 500, fourWeekAverage: 400, deltaPercent: 25, topCategory: 'food', highestSpendDay: 'Monday', largestTransaction: null, transactionCount: 10 },
      }),
      AlertModel.create({ userId, category: 'food', amount: 90, limit: 100, percentUsed: 0.9, message: 'Near limit' }),
      ItemPriceModel.create({ userId, merchant: 'PARKnSHOP', itemName: 'Milk', price: 25, currency: 'HKD', lastSeen: new Date() }),
    ]);

    // Verify data exists
    expect(await ExpenseModel.countDocuments({ owner: userId })).toBe(2);
    expect(await GoalModel.countDocuments({ userId })).toBe(1);
    expect(await TransactionTemplateModel.countDocuments({ owner: userId })).toBe(1);

    // Delete account
    const res = await request(app)
      .delete('/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Account and all data deleted');

    // Verify all data is gone
    expect(await UserModel.findById(userId)).toBeNull();
    expect(await ExpenseModel.countDocuments({ owner: userId })).toBe(0);
    expect(await GoalModel.countDocuments({ userId })).toBe(0);
    expect(await TransactionTemplateModel.countDocuments({ owner: userId })).toBe(0);
    expect(await RecurringExpenseModel.countDocuments({ userId })).toBe(0);
    expect(await AccountModel.countDocuments({ userId })).toBe(0);
    expect(await NetWorthModel.countDocuments({ userId })).toBe(0);
    expect(await WeeklyPulseModel.countDocuments({ userId })).toBe(0);
    expect(await AlertModel.countDocuments({ userId })).toBe(0);
    expect(await ItemPriceModel.countDocuments({ userId })).toBe(0);
  });

  it('does not delete other users data', async () => {
    const { token, userId } = await registerAndLogin('user-a@example.com', 'password123');
    const { userId: otherUserId } = await registerAndLogin('user-b@example.com', 'password123');

    await ExpenseModel.create({ owner: userId, amount: 100, category: 'food', date: new Date() });
    await ExpenseModel.create({ owner: otherUserId, amount: 200, category: 'food', date: new Date() });

    const res = await request(app)
      .delete('/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'password123' });

    expect(res.status).toBe(200);
    expect(await ExpenseModel.countDocuments({ owner: otherUserId })).toBe(1);
    expect(await UserModel.findById(otherUserId)).not.toBeNull();
  });

  it('returns 401 with incorrect password', async () => {
    const { token } = await registerAndLogin();

    const res = await request(app)
      .delete('/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect password');
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .delete('/auth/account')
      .send({ password: 'password123' });

    expect(res.status).toBe(401);
  });

  it('returns 400 without password in body', async () => {
    const { token } = await registerAndLogin();

    const res = await request(app)
      .delete('/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('prevents login after account deletion', async () => {
    const { token } = await registerAndLogin('gone@example.com', 'password123');

    await request(app)
      .delete('/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'password123' });

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'gone@example.com', password: 'password123' });

    expect(loginRes.status).toBe(401);
  });
});
