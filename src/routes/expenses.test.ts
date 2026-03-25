import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import expenseRoutes from './expenses';
import { protect } from '../middleware/auth';
import ExpenseModel from '../models/Expense';

let mongoServer: MongoMemoryServer;
const JWT_SECRET = 'test-secret-key';
let app: express.Application;

beforeAll(async () => {
  // Create in-memory MongoDB instance
  mongoServer = await MongoMemoryServer.create();
  process.env.JWT_SECRET = JWT_SECRET;

  // Connect mongoose to in-memory database
  await mongoose.connect(mongoServer.getUri());

  // Create Express app for testing
  app = express();
  app.use(express.json());
  app.use(cors());

  // Mount expense routes
  app.use('/api/expenses', expenseRoutes);

  // Clean up any existing data
  await ExpenseModel.deleteMany({});
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

const generateToken = (userId: string) => {
  return jwt.sign({ userId }, JWT_SECRET);
};

describe('Expenses API', () => {
  describe('POST /api/expenses - Create expense with participants', () => {
    test('should save expense with participants array', async () => {
      const token = generateToken('test-user-1');
      const payload = {
        owner: 'test-user-1',
        item: 'Dinner',
        category: 'food',
        description: 'Dinner with friends',
        amount: 50,
        type: 'expense',
        date: new Date().toISOString(),
        participants: ['Alice', 'Bob', 'Charlie'],
      };

      const response = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('_id');
      expect(response.body.participants).toBeDefined();
      expect(response.body.participants).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    test('should create expense with empty participants array', async () => {
      const token = generateToken('test-user-2');
      const payload = {
        owner: 'test-user-2',
        item: 'Coffee',
        amount: 5,
        type: 'expense',
        participants: [],
      };

      const response = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.participants).toEqual([]);
    });

    test('should default to empty participants array if not provided', async () => {
      const token = generateToken('test-user-3');
      const payload = {
        owner: 'test-user-3',
        item: 'Groceries',
        amount: 30,
        type: 'expense',
      };

      const response = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.participants).toBeDefined();
      expect(response.body.participants).toEqual([]);
    });
  });

  describe('GET /api/expenses - Retrieve expenses with participants', () => {
    test('should return participants in expense list', async () => {
      const userId = 'test-user-4';
      const token = generateToken(userId);

      // Create an expense with participants
      const createResponse = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          owner: userId,
          item: 'Team Lunch',
          amount: 100,
          type: 'expense',
          participants: ['Alice', 'Bob', 'Charlie'],
        });

      const expenseId = createResponse.body._id;

      // Retrieve the expense list
      const getResponse = await request(app)
        .get('/api/expenses')
        .set('Authorization', `Bearer ${token}`);

      expect(getResponse.status).toBe(200);
      const expense = getResponse.body.find((e: any) => e._id === expenseId);
      expect(expense).toBeDefined();
      expect(expense.participants).toBeDefined();
      expect(expense.participants).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('GET /api/expenses/:id - Retrieve single expense with participants', () => {
    test('should return participants when fetching single expense', async () => {
      const userId = 'test-user-5';
      const token = generateToken(userId);

      // Create an expense with participants
      const createResponse = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          owner: userId,
          item: 'Movie Night',
          amount: 50,
          type: 'expense',
          participants: ['David', 'Eve'],
        });

      const expenseId = createResponse.body._id;

      // Retrieve the specific expense
      const getResponse = await request(app)
        .get(`/api/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.participants).toBeDefined();
      expect(getResponse.body.participants).toEqual(['David', 'Eve']);
    });
  });

  describe('PUT /api/expenses/:id - Update expense with participants', () => {
    test('should update participants array', async () => {
      const userId = 'test-user-6';
      const token = generateToken(userId);

      // Create an expense with initial participants
      const createResponse = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          owner: userId,
          item: 'Picnic',
          amount: 75,
          type: 'expense',
          participants: ['Alice', 'Bob'],
        });

      const expenseId = createResponse.body._id;

      // Update the participants
      const updateResponse = await request(app)
        .put(`/api/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          owner: userId,
          item: 'Picnic',
          amount: 75,
          type: 'expense',
          participants: ['Alice', 'Bob', 'Charlie'],
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.participants).toBeDefined();
      expect(updateResponse.body.participants).toEqual(['Alice', 'Bob', 'Charlie']);

      // Verify the update persisted
      const getResponse = await request(app)
        .get(`/api/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getResponse.body.participants).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    test('should clear participants when updated to empty array', async () => {
      const userId = 'test-user-7';
      const token = generateToken(userId);

      // Create an expense with participants
      const createResponse = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          owner: userId,
          item: 'Concert',
          amount: 120,
          type: 'expense',
          participants: ['Frank', 'Grace'],
        });

      const expenseId = createResponse.body._id;

      // Update to empty participants
      const updateResponse = await request(app)
        .put(`/api/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          owner: userId,
          item: 'Concert',
          amount: 120,
          type: 'expense',
          participants: [],
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.participants).toEqual([]);
    });
  });

  describe('Exact frontend flow simulation', () => {
    test('should handle request exactly as frontend sends it (with participants field)', async () => {
      const userId = 'test-user-8';
      const token = generateToken(userId);

      // This simulates exactly what AddExpenseModal sends
      const frontendPayload = {
        description: 'Team lunch',
        amount: 100,
        type: 'expense',
        item: 'Lunch',
        category: 'food',
        participants: ['Alice', 'Bob'],
        date: '2026-03-25',
        owner: userId,
      };

      const response = await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send(frontendPayload);

      expect(response.status).toBe(201);
      expect(response.body.participants).toEqual(['Alice', 'Bob']);

      // Now retrieve it to ensure it persisted
      const retrieved = await request(app)
        .get(`/api/expenses/${response.body._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(retrieved.body.participants).toEqual(['Alice', 'Bob']);
    });
  });
});
