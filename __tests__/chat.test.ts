process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GROQ_API_KEY = 'test-groq-key';
jest.setTimeout(30000);

const mockCreate = jest.fn();

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import UserModel from '../src/models/User';
import ExpenseModel from '../src/models/Expense';

let mongod: MongoMemoryServer;
let testUserId: string;
let authToken: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), {
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const user = await UserModel.create({
    email: `chat-test-${Date.now()}@example.com`,
    password: 'password123',
    budgets: [{ category: 'Food', limit: 2000 }],
  });
  testUserId = (user._id as mongoose.Types.ObjectId).toString();
  authToken = jwt.sign({ userId: testUserId }, 'test-secret', { expiresIn: '1h' });

  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: 'You spent 500 on food this month.' } }],
  });
});

afterEach(async () => {
  await UserModel.deleteMany({});
  await ExpenseModel.deleteMany({});
});

describe('POST /api/chat/money-assistant', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/chat/money-assistant')
      .send({ message: 'How much did I spend on food?' });

    expect(res.status).toBe(401);
  });

  it('returns 400 for empty message', async () => {
    const res = await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: '' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('returns 400 for missing message field', async () => {
    const res = await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 for message exceeding 500 characters', async () => {
    const res = await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'a'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('accepts message of exactly 500 characters', async () => {
    const res = await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'a'.repeat(500) });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('You spent 500 on food this month.');
  });

  it('returns reply from Groq on valid request', async () => {
    const res = await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'How much did I spend on food?' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('You spent 500 on food this month.');
  });

  it('includes expense data in context sent to Groq', async () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10);

    await ExpenseModel.create({
      owner: testUserId,
      type: 'expense',
      category: 'Food',
      amount: 150,
      item: "McDonald's",
      date: recentDate,
    });

    await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'What did I spend on food?' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const systemMessage = callArgs.messages[0].content as string;
    expect(systemMessage).toContain('Food');
    expect(systemMessage).toContain('150');
  });

  it('includes budget vs actual in context sent to Groq', async () => {
    const now = new Date();
    await ExpenseModel.create({
      owner: testUserId,
      type: 'expense',
      category: 'Food',
      amount: 800,
      date: new Date(now.getFullYear(), now.getMonth(), 5),
    });

    await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'How is my food budget?' });

    const callArgs = mockCreate.mock.calls[0][0];
    const systemMessage = callArgs.messages[0].content as string;
    expect(systemMessage).toContain('2000');
    expect(systemMessage).toContain('800');
  });

  it('returns fallback reply when Groq throws an error', async () => {
    mockCreate.mockRejectedValue(new Error('Groq API unavailable'));

    const res = await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'How much did I spend?' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("I couldn't analyse your data right now. Try again in a moment.");
  });

  it('returns fallback reply when Groq returns empty content', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '' } }],
    });

    const res = await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'How much did I spend?' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("I couldn't analyse your data right now. Try again in a moment.");
  });

  it('excludes expenses older than 90 days from context', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    await ExpenseModel.create([
      {
        owner: testUserId,
        type: 'expense',
        category: 'Shopping',
        amount: 9999,
        date: oldDate,
      },
      {
        owner: testUserId,
        type: 'expense',
        category: 'Food',
        amount: 100,
        date: new Date(),
      },
    ]);

    await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'What did I spend?' });

    const callArgs = mockCreate.mock.calls[0][0];
    const systemMessage = callArgs.messages[0].content as string;
    expect(systemMessage).not.toContain('9999');
    expect(systemMessage).toContain('Food');
  });

  it('passes user message to Groq as user role', async () => {
    const userMessage = 'Where am I overspending?';

    await request(app)
      .post('/api/chat/money-assistant')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: userMessage });

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg?.content).toBe(userMessage);
  });
});
