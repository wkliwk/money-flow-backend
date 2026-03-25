import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import jwt from 'jsonwebtoken';
import UserModel from '../models/User';
import ExpenseModel from '../models/Expense';
import budgetsRouter from './budgets';

const JWT_SECRET = 'test-secret-key';
let mongoServer: MongoMemoryServer;
let testApp: express.Application;
let testUserId: string;

describe('Budget Alerts API', () => {
  beforeAll(async () => {
    // Set JWT_SECRET for the auth middleware
    process.env.JWT_SECRET = JWT_SECRET;

    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    await mongoose.connect(mongoUri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
    });

    testApp = express();
    testApp.use(express.json());

    // Create test user
    const user = new UserModel({
      email: 'test@example.com',
      password: 'password123',
      budgets: [
        { category: 'groceries', limit: 500, alert_threshold: 400 },
        { category: 'entertainment', limit: 200 },
      ],
    });
    await user.save();
    testUserId = user._id.toString();

    // Use the actual budgets router with its built-in auth middleware
    testApp.use('/api/budgets', budgetsRouter);
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  const generateToken = () => jwt.sign({ userId: testUserId }, JWT_SECRET);

  test('GET /api/budgets/:category/alerts returns alert status for budget with threshold', async () => {
    const token = generateToken();

    const response = await request(testApp)
      .get(`/api/budgets/groceries/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.body.budget_category).toBe('groceries');
    expect(response.body.alert_threshold).toBe(400);
    expect(response.body).toHaveProperty('total_spent');
    expect(response.body).toHaveProperty('exceeded');
    expect(response.body).toHaveProperty('remaining');
    expect(response.body).toHaveProperty('month');
  });

  test('GET /api/budgets/:category/alerts returns null threshold for budget without threshold', async () => {
    const token = generateToken();

    const response = await request(testApp)
      .get(`/api/budgets/entertainment/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.body.alert_threshold).toBeNull();
    expect(response.body.alerts).toEqual([]);
  });

  test('GET /api/budgets/:category/alerts detects when budget is exceeded', async () => {
    const token = generateToken();

    // Add expenses that exceed the alert threshold (400)
    await ExpenseModel.create([
      {
        owner: testUserId,
        category: 'groceries',
        amount: 250,
        date: new Date(),
      },
      {
        owner: testUserId,
        category: 'groceries',
        amount: 180,
        date: new Date(),
      },
    ]);

    const response = await request(testApp)
      .get(`/api/budgets/groceries/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.body.total_spent).toBe(430);
    expect(response.body.exceeded).toBe(true);
    expect(response.body.remaining).toBe(0); // negative becomes 0
  });

  test('GET /api/budgets/:category/alerts returns 404 for non-existent budget', async () => {
    const token = generateToken();

    const response = await request(testApp)
      .get(`/api/budgets/nonexistent/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .timeout(5000);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Budget not found');
  });

  test('PUT /api/budgets accepts alert_threshold in request', async () => {
    const token = generateToken();

    const response = await request(testApp)
      .put(`/api/budgets`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        budgets: [
          { category: 'groceries', limit: 500, alert_threshold: 350 },
          { category: 'entertainment', limit: 200, alert_threshold: 150 },
        ],
      })
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.body.budgets[0].alert_threshold).toBe(350);
    expect(response.body.budgets[1].alert_threshold).toBe(150);

    // Verify budget was updated in DB
    const user = await UserModel.findById(testUserId);
    expect(user?.budgets?.[0].alert_threshold).toBe(350);
  });

  test('GET /api/budgets/:category/alerts calculates remaining correctly', async () => {
    const token = generateToken();

    // Clear previous expenses
    await ExpenseModel.deleteMany({ owner: testUserId, category: 'groceries' });

    // Add expense of 200 (threshold is now 350)
    await ExpenseModel.create({
      owner: testUserId,
      category: 'groceries',
      amount: 200,
      date: new Date(),
    });

    const response = await request(testApp)
      .get(`/api/budgets/groceries/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.body.total_spent).toBe(200);
    expect(response.body.exceeded).toBe(false);
    expect(response.body.remaining).toBe(150); // 350 - 200
  });

  test('GET /api/budgets/:category/alerts requires authentication', async () => {
    const response = await request(testApp)
      .get(`/api/budgets/groceries/alerts`)
      .timeout(5000);

    expect([401, 403]).toContain(response.status);
  });
});
