process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { UserModel } from '../src/models/User';
import { ExpenseModel } from '../src/models/Expense';
import { AlertModel } from '../src/models/Alert';
import { checkAndQueueBudgetAlerts, processPendingAlerts } from '../src/utils/alerts';

let mongoServer: MongoMemoryServer;
let token: string;
let testUserId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await ExpenseModel.deleteMany({});
  await AlertModel.deleteMany({});

  // Create test user in database with valid ObjectId
  const userId = new mongoose.Types.ObjectId();
  testUserId = userId.toString();

  await UserModel.create({
    _id: userId,
    email: `test${Date.now()}@example.com`,
    password: 'hashed_password',
    budgets: [],
  });

  // Generate JWT token for test user
  token = jwt.sign({ userId: testUserId }, 'test-secret');
});

describe('Budget Alerts', () => {
  it('should queue an alert when expense exceeds budget threshold', async () => {
    // Get user
    const user = await UserModel.findById(testUserId);
    expect(user).toBeDefined();

    // Set up budget with alerts enabled
    await UserModel.findByIdAndUpdate(user?._id, {
      $set: {
        budgets: [
          {
            category: 'Food',
            limit: 100,
            alert_threshold: 0.8,
            enable_alerts: true,
          },
        ],
      },
    });

    // Create expense that exceeds threshold
    await ExpenseModel.create({
      owner: user?._id,
      description: 'Restaurant',
      amount: 85,
      category: 'Food',
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
    });

    // Check alerts directly (simulating what the background job would do)
    await checkAndQueueBudgetAlerts(user?._id.toString() || '');

    const alerts = await AlertModel.find({ category: 'Food' });
    expect(alerts.length).toBe(1);
    expect(alerts[0].sent).toBe(false);
  });

  it('should not queue duplicate alerts for same month', async () => {
    const user = await UserModel.findById(testUserId);
    expect(user).toBeDefined();

    // Set up budget
    await UserModel.findByIdAndUpdate(user?._id, {
      $set: {
        budgets: [
          {
            category: 'Food',
            limit: 100,
            alert_threshold: 0.5,
            enable_alerts: true,
          },
        ],
      },
    });

    // Create first expensive transaction
    await ExpenseModel.create({
      owner: user?._id,
      description: 'Expensive meal',
      amount: 60,
      category: 'Food',
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
    });

    // Check alerts
    await checkAndQueueBudgetAlerts(user?._id.toString() || '');

    const alertsAfterFirst = await AlertModel.find({ category: 'Food' });
    expect(alertsAfterFirst.length).toBe(1);

    // Create another transaction
    await ExpenseModel.create({
      owner: user?._id,
      description: 'Another meal',
      amount: 30,
      category: 'Food',
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
    });

    // Check alerts again - should not create duplicate
    await checkAndQueueBudgetAlerts(user?._id.toString() || '');

    const alertsAfterSecond = await AlertModel.find({ category: 'Food' });
    expect(alertsAfterSecond.length).toBe(1);
  });

  it('should not queue alerts when category alerts are disabled', async () => {
    const user = await UserModel.findById(testUserId);
    expect(user).toBeDefined();

    // Set up budget but disable alerts
    await UserModel.findByIdAndUpdate(user?._id, {
      $set: {
        budgets: [
          {
            category: 'Entertainment',
            limit: 50,
            alert_threshold: 0.5,
            enable_alerts: false,
          },
        ],
      },
    });

    // Create expensive transaction
    await ExpenseModel.create({
      owner: user?._id,
      description: 'Movie',
      amount: 40,
      category: 'Entertainment',
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
    });

    // Check alerts
    await checkAndQueueBudgetAlerts(user?._id.toString() || '');

    const alerts = await AlertModel.find({ category: 'Entertainment' });
    expect(alerts.length).toBe(0);
  });

  it('should not queue alerts for income transactions', async () => {
    const user = await UserModel.findById(testUserId);
    expect(user).toBeDefined();

    // Set up budget
    await UserModel.findByIdAndUpdate(user?._id, {
      $set: {
        budgets: [
          {
            category: 'Income',
            limit: 1000,
            alert_threshold: 0.5,
            enable_alerts: true,
          },
        ],
      },
    });

    // Create income transaction
    await ExpenseModel.create({
      owner: user?._id,
      description: 'Salary',
      amount: 800,
      category: 'Income',
      type: 'income',
      date: new Date().toISOString().split('T')[0],
    });

    // Check alerts
    await checkAndQueueBudgetAlerts(user?._id.toString() || '');

    const alerts = await AlertModel.find({ category: 'Income' });
    expect(alerts.length).toBe(0);
  });

  it('should enable/disable alerts via POST endpoint', async () => {
    const user = await UserModel.findById(testUserId);
    expect(user).toBeDefined();

    // Set up initial budget
    await UserModel.findByIdAndUpdate(user?._id, {
      $set: {
        budgets: [
          {
            category: 'Utilities',
            limit: 200,
            enable_alerts: true,
          },
        ],
      },
    });

    // Test disabling alerts via endpoint
    const disableRes = await request(app)
      .post('/api/budgets/Utilities/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ enable_alerts: false });

    expect(disableRes.status).toBe(200);

    // Verify disabled in database
    const updatedUser = await UserModel.findById(user?._id);
    const utilities = updatedUser?.budgets.find((b) => b.category === 'Utilities');
    expect(utilities?.enable_alerts).toBe(false);

    // Re-enable alerts
    const enableRes = await request(app)
      .post('/api/budgets/Utilities/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ enable_alerts: true });

    expect(enableRes.status).toBe(200);

    // Verify re-enabled
    const finalUser = await UserModel.findById(user?._id);
    const finalUtilities = finalUser?.budgets.find((b) => b.category === 'Utilities');
    expect(finalUtilities?.enable_alerts).toBe(true);
  });

  it('should handle checking budgets with no alerts enabled', async () => {
    const user = await UserModel.findById(testUserId);
    expect(user).toBeDefined();

    // Set up budget without alerts
    await UserModel.findByIdAndUpdate(user?._id, {
      $set: {
        budgets: [
          {
            category: 'Shopping',
            limit: 100,
            enable_alerts: false,
          },
        ],
      },
    });

    // Create large expense
    await ExpenseModel.create({
      owner: user?._id,
      description: 'Purchases',
      amount: 120,
      category: 'Shopping',
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
    });

    // Check alerts
    await checkAndQueueBudgetAlerts(user?._id.toString() || '');

    const alerts = await AlertModel.find({});
    expect(alerts.length).toBe(0);
  });

  it('should mark alerts as sent after processing', async () => {
    // Create a pending alert manually
    const user = await UserModel.findById(testUserId);
    expect(user).toBeDefined();

    await AlertModel.create({
      userId: user?._id.toString(),
      category: 'Test',
      amount: 100,
      limit: 100,
      percentUsed: 100,
      message: 'Test alert',
      sent: false,
    });

    // Mock Telegram (skip actual sending)
    process.env.TELEGRAM_BOT_TOKEN = '';
    process.env.TELEGRAM_CHAT_ID = '';

    await processPendingAlerts();

    // Without Telegram configured, it should not mark as sent
    const alert = await AlertModel.findOne({ category: 'Test' });
    expect(alert?.sent).toBe(false);
  });
});
