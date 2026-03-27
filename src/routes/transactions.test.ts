process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'test-api-key';

import request from 'supertest';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import transactionRoutes from './transactions';

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

const JWT_SECRET = 'test-secret';

const app = express();
app.use(express.json());
app.use(cors());
app.use('/api/transactions', transactionRoutes);

const authToken = jwt.sign({ userId: 'user_123' }, JWT_SECRET);

function mockClaudeResponse(payload: Record<string, unknown>) {
  (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      }),
    },
  } as unknown as Anthropic));
}

const FULL_PARSE_RESPONSE = {
  merchant: "McDonald's",
  amount: 65,
  currency: 'HKD',
  category: 'Food',
  subcategory: 'Fast Food',
  participants: ['Casey'],
  date: '2026-03-27',
  notes: 'Big Mac Meal',
  confidence: 0.95,
  missing_fields: [],
};

beforeEach(() => {
  (Anthropic as jest.MockedClass<typeof Anthropic>).mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/transactions/parse-text', () => {
  it('requires JWT auth', async () => {
    const res = await request(app).post('/api/transactions/parse-text').send({ text: 'test' });
    expect(res.status).toBe(401);
  });

  it('rejects missing text', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects empty text', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects text over 1000 characters', async () => {
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'a'.repeat(1001) });
    expect(res.status).toBe(400);
  });

  it('rejects invalid locale', async () => {
    mockClaudeResponse(FULL_PARSE_RESPONSE);
    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'test', locale: 'fr-FR' });
    expect(res.status).toBe(400);
  });

  it('returns structured JSON for a Cantonese transaction', async () => {
    mockClaudeResponse(FULL_PARSE_RESPONSE);

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: '我今日同Casey食咗麥當勞巨無霸餐 $65', locale: 'zh-HK' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      merchant: "McDonald's",
      amount: 65,
      currency: 'HKD',
      category: 'Food',
      subcategory: 'Fast Food',
      participants: ['Casey'],
      confidence: 0.95,
      missing_fields: [],
    });
  });

  it('returns null for amount when missing', async () => {
    mockClaudeResponse({
      ...FULL_PARSE_RESPONSE,
      amount: null,
      confidence: 0.5,
      missing_fields: ['amount'],
    });

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: '食咗麥當勞', locale: 'zh-HK' });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBeNull();
    expect(res.body.missing_fields).toContain('amount');
  });

  it('defaults currency to HKD when not specified', async () => {
    mockClaudeResponse({ ...FULL_PARSE_RESPONSE, currency: undefined });

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'bought coffee $30' });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('HKD');
  });

  it('defaults category to Other for unknown category', async () => {
    mockClaudeResponse({ ...FULL_PARSE_RESPONSE, category: 'Gambling' });

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'bet $100' });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe('Other');
  });

  it('returns 422 when Claude API throws', async () => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockRejectedValue(new Error('API error')) },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'lunch $50' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Could not parse transaction text');
  });

  it('returns 422 when Claude returns non-JSON text', async () => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'I cannot parse this.' }],
        }),
      },
    } as unknown as Anthropic));

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'lunch $50' });

    expect(res.status).toBe(422);
  });

  it('enforces rate limit of 30 parses per hour', async () => {
    const userId = 'rate_limit_user_' + Date.now();
    const token = jwt.sign({ userId }, JWT_SECRET);

    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify(FULL_PARSE_RESPONSE) }],
        }),
      },
    } as unknown as Anthropic));

    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post('/api/transactions/parse-text')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'lunch $50' });
      expect(res.status).not.toBe(429);
    }

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'lunch $50' });
    expect(res.status).toBe(429);
  });

  it('accepts valid locale zh-HK', async () => {
    mockClaudeResponse(FULL_PARSE_RESPONSE);

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'coffee $30', locale: 'zh-HK' });

    expect(res.status).toBe(200);
  });

  it('accepts valid locale en', async () => {
    mockClaudeResponse(FULL_PARSE_RESPONSE);

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'coffee $30', locale: 'en' });

    expect(res.status).toBe(200);
  });

  it('clamps confidence to 0–1 range', async () => {
    mockClaudeResponse({ ...FULL_PARSE_RESPONSE, confidence: 1.5 });

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'lunch $50' });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBeLessThanOrEqual(1);
  });

  it('returns empty participants array when none mentioned', async () => {
    mockClaudeResponse({ ...FULL_PARSE_RESPONSE, participants: [] });

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'bought coffee $30' });

    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual([]);
  });

  it('returns 500 when ANTHROPIC_API_KEY is not set', async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const res = await request(app)
      .post('/api/transactions/parse-text')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ text: 'lunch $50' });

    expect(res.status).toBe(500);
    process.env.ANTHROPIC_API_KEY = savedKey;
  });
});
