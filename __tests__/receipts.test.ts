process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'test-api-key';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

import Anthropic from '@anthropic-ai/sdk';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'receipt_user_123';
const authToken = jwt.sign({ userId: TEST_USER_ID }, 'test-secret');

// Minimal valid JPEG buffer (1x1 px)
const JPEG_BUFFER = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==',
  'base64'
);

const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(() => {
  jest.clearAllMocks();
});

function mockSuccessfulExtraction(overrides: Record<string, unknown> = {}) {
  const payload = {
    amount: 125.5,
    description: 'Grocery shopping at ParknShop',
    merchant: 'ParknShop',
    date: '2024-03-15',
    category: 'Groceries',
    currency: 'HKD',
    ...overrides,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

describe('POST /api/receipts/scan', () => {
  it('requires JWT auth', async () => {
    const res = await request(app)
      .post('/api/receipts/scan')
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });

  it('rejects request with no file', async () => {
    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects unsupported file type', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 test');
    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', pdfBuffer, { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  it('rejects oversized file', async () => {
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', bigBuffer, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('returns structured JSON for a successful JPEG extraction', async () => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockResolvedValue(mockSuccessfulExtraction()) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      amount: 125.5,
      description: 'Grocery shopping at ParknShop',
      merchant: 'ParknShop',
      date: '2024-03-15',
      category: 'Groceries',
      currency: 'HKD',
      confidence: 'high',
    });
  });

  it('returns structured JSON for a PNG image', async () => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockResolvedValue(mockSuccessfulExtraction()) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(125.5);
  });

  it('returns confidence=medium when date is missing', async () => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockResolvedValue(mockSuccessfulExtraction({ date: null })) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe('medium');
  });

  it('returns confidence=low when only amount is extractable', async () => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockResolvedValue(mockSuccessfulExtraction({ date: null, merchant: null })) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe('low');
  });

  it('returns 422 when Claude cannot extract amount', async () => {
    const payload = { content: [{ type: 'text', text: '{"amount":null,"merchant":"Test","date":"2024-01-01","category":"Other","currency":"HKD","description":"test"}' }] };
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockResolvedValue(payload) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Could not extract data from receipt');
  });

  it('returns 422 when Claude API throws', async () => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockRejectedValue(new Error('API error')) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Could not extract data from receipt');
  });

  it('returns 422 when Claude returns non-JSON text', async () => {
    const payload = { content: [{ type: 'text', text: 'Sorry, I cannot process this image.' }] };
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockResolvedValue(payload) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
  });

  it('enforces rate limit of 10 scans per hour', async () => {
    const rateLimitUser = 'rate_limit_user_' + Date.now();
    const rateLimitToken = jwt.sign({ userId: rateLimitUser }, 'test-secret');

    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => ({
      messages: { create: jest.fn().mockResolvedValue(mockSuccessfulExtraction()) },
    } as unknown as Anthropic));

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/receipts/scan')
        .set('Authorization', `Bearer ${rateLimitToken}`)
        .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
      expect(res.status).not.toBe(429);
    }

    const res = await request(app)
      .post('/api/receipts/scan')
      .set('Authorization', `Bearer ${rateLimitToken}`)
      .attach('image', JPEG_BUFFER, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(429);
  });
});
