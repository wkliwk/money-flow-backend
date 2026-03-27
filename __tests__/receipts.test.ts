process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'test-api-key';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';

jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn();
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

import Anthropic from '@anthropic-ai/sdk';
const MockedAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

let mongod: MongoMemoryServer;
let authToken: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const res = await request(app)
    .post('/auth/register')
    .send({ email: 'test@example.com', password: 'password123' });
  authToken = res.body.token;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(() => {
  jest.clearAllMocks();
});

const getMockCreate = () => {
  const instance = MockedAnthropic.mock.results[0]?.value;
  return instance?.messages?.create as jest.Mock;
};

describe('POST /api/receipts/scan', () => {
  it('extracts transaction data from receipt image', async () => {
    const extractedData = {
      amount: 42.50,
      description: 'Grocery shopping',
      category: 'Food',
      date: '2026-03-27',
      merchant: 'Park n Shop',
      currency: 'HKD',
      confidence: 'high',
    };

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('receipt', Buffer.from('fake-image-data'), {
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
      });

    const mockCreate = getMockCreate();
    if (mockCreate) {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(extractedData) }],
      });
    }

    // Re-run with properly mocked create
    const mockCreateFn = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(extractedData) }],
    });
    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreateFn },
    }) as unknown as Anthropic);

    const res2 = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('receipt', Buffer.from('fake-image-data'), {
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
      });

    expect(res2.status).toBe(200);
    expect(res2.body.amount).toBe(42.50);
    expect(res2.body.merchant).toBe('Park n Shop');
    expect(res2.body.confidence).toBe('high');
  });

  it('rejects request without auth', async () => {
    const res = await request(app)
      .post('/api/receipts/scan')
      .attach('receipt', Buffer.from('fake-image-data'), {
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(401);
  });

  it('rejects request without file', async () => {
    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No receipt image provided');
  });

  it('rejects non-image file types', async () => {
    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('receipt', Buffer.from('not-an-image'), {
        filename: 'document.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(500);
  });

  it('returns 422 when extraction fails', async () => {
    MockedAnthropic.mockImplementation(() => ({
      messages: {
        create: jest.fn().mockRejectedValue(new Error('API error')),
      },
    }) as unknown as Anthropic);

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('receipt', Buffer.from('fake-image-data'), {
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Could not extract data from receipt');
  });
});
