process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import itemPriceRoutes from './item-prices';
import ItemPriceModel from '../models/ItemPrice';

let mongoServer: MongoMemoryServer;
let app: express.Application;

const JWT_SECRET = 'test-secret';

const generateToken = (userId: string) => jwt.sign({ userId }, JWT_SECRET);

const USER_A = 'user-price-a';
const USER_B = 'user-price-b';
const TOKEN_A = generateToken(USER_A);
const TOKEN_B = generateToken(USER_B);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());
  app.use(cors());
  app.use('/api/item-prices', itemPriceRoutes);
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ItemPriceModel.deleteMany({});
});

// ─── POST /api/item-prices/extract ────────────────────────────────────────────

describe('POST /api/item-prices/extract', () => {
  it('requires JWT auth', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .send({ merchant: "McDonald's", items: [{ itemName: 'Big Mac', price: 30 }] });
    expect(res.status).toBe(401);
  });

  it('rejects missing merchant', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ items: [{ itemName: 'Big Mac', price: 30 }] });
    expect(res.status).toBe(400);
  });

  it('rejects empty items array', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: "McDonald's", items: [] });
    expect(res.status).toBe(400);
  });

  it('rejects item with negative price', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: "McDonald's", items: [{ itemName: 'Big Mac', price: -5 }] });
    expect(res.status).toBe(400);
  });

  it('rejects item with empty itemName', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: "McDonald's", items: [{ itemName: '   ', price: 30 }] });
    expect(res.status).toBe(400);
  });

  it('stores a single item and returns stored count', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        merchant: "McDonald's",
        items: [{ itemName: 'Big Mac', price: 30, currency: 'HKD' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(1);
    expect(res.body.merchant).toBe("McDonald's");

    const doc = await ItemPriceModel.findOne({ userId: USER_A, merchant: "McDonald's", itemName: 'Big Mac' });
    expect(doc).not.toBeNull();
    expect(doc!.price).toBe(30);
    expect(doc!.currency).toBe('HKD');
    expect(doc!.occurrences).toBe(1);
    expect(doc!.priceHistory).toHaveLength(1);
  });

  it('stores multiple items in a single call', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        merchant: "McDonald's",
        items: [
          { itemName: 'Big Mac', price: 30 },
          { itemName: 'McFlurry', price: 15 },
          { itemName: 'Fries', price: 12 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(3);

    const count = await ItemPriceModel.countDocuments({ userId: USER_A, merchant: "McDonald's" });
    expect(count).toBe(3);
  });

  it('updates price and appends to priceHistory on second scan', async () => {
    // First scan
    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: "McDonald's", items: [{ itemName: 'Big Mac', price: 28 }] });

    // Second scan with new price
    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: "McDonald's", items: [{ itemName: 'Big Mac', price: 30 }] });

    const doc = await ItemPriceModel.findOne({ userId: USER_A, merchant: "McDonald's", itemName: 'Big Mac' });
    expect(doc!.price).toBe(30);
    expect(doc!.occurrences).toBe(2);
    expect(doc!.priceHistory).toHaveLength(2);
    expect(doc!.priceHistory[0].price).toBe(28);
    expect(doc!.priceHistory[1].price).toBe(30);
  });

  it('defaults currency to HKD when not provided', async () => {
    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: 'Starbucks', items: [{ itemName: 'Latte', price: 45 }] });

    const doc = await ItemPriceModel.findOne({ userId: USER_A, merchant: 'Starbucks', itemName: 'Latte' });
    expect(doc!.currency).toBe('HKD');
  });

  it('uses receiptDate when provided', async () => {
    const receiptDate = '2026-01-15';
    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        merchant: 'Wellcome',
        items: [{ itemName: 'Milk', price: 20 }],
        receiptDate,
      });

    const doc = await ItemPriceModel.findOne({ userId: USER_A, merchant: 'Wellcome', itemName: 'Milk' });
    expect(doc!.lastSeen.toISOString().startsWith('2026-01-15')).toBe(true);
  });

  it('rejects invalid receiptDate', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({
        merchant: 'Wellcome',
        items: [{ itemName: 'Milk', price: 20 }],
        receiptDate: 'not-a-date',
      });
    expect(res.status).toBe(400);
  });

  it('is scoped to the authenticated user (user isolation)', async () => {
    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: "McDonald's", items: [{ itemName: 'Big Mac', price: 30 }] });

    const docForB = await ItemPriceModel.findOne({ userId: USER_B, merchant: "McDonald's" });
    expect(docForB).toBeNull();
  });

  it('normalises currency to uppercase', async () => {
    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ merchant: 'KFC', items: [{ itemName: 'Zinger', price: 45, currency: 'hkd' }] });

    const doc = await ItemPriceModel.findOne({ userId: USER_A, merchant: 'KFC', itemName: 'Zinger' });
    expect(doc!.currency).toBe('HKD');
  });
});

// ─── GET /api/item-prices ─────────────────────────────────────────────────────

describe('GET /api/item-prices', () => {
  beforeEach(async () => {
    // Seed data for USER_A
    await ItemPriceModel.create([
      {
        userId: USER_A,
        merchant: "McDonald's",
        itemName: 'Big Mac',
        price: 30,
        currency: 'HKD',
        lastSeen: new Date('2026-03-01'),
        priceHistory: [{ price: 30, date: new Date('2026-03-01') }],
        occurrences: 1,
      },
      {
        userId: USER_A,
        merchant: "McDonald's",
        itemName: 'McFlurry',
        price: 15,
        currency: 'HKD',
        lastSeen: new Date('2026-03-01'),
        priceHistory: [{ price: 15, date: new Date('2026-03-01') }],
        occurrences: 1,
      },
      {
        userId: USER_A,
        merchant: 'Starbucks',
        itemName: 'Latte',
        price: 45,
        currency: 'HKD',
        lastSeen: new Date('2026-03-10'),
        priceHistory: [{ price: 45, date: new Date('2026-03-10') }],
        occurrences: 2,
      },
      // USER_B data — should never appear in USER_A's results
      {
        userId: USER_B,
        merchant: "McDonald's",
        itemName: 'Big Mac',
        price: 999,
        currency: 'HKD',
        lastSeen: new Date('2026-03-01'),
        priceHistory: [{ price: 999, date: new Date('2026-03-01') }],
        occurrences: 1,
      },
    ]);
  });

  it('requires JWT auth', async () => {
    const res = await request(app).get('/api/item-prices');
    expect(res.status).toBe(401);
  });

  it('returns all items for the user when no filters given', async () => {
    const res = await request(app)
      .get('/api/item-prices')
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    // All belong to USER_A
    for (const item of res.body) {
      expect(item.userId).toBeUndefined(); // userId not selected
    }
  });

  it('filters by merchant', async () => {
    const res = await request(app)
      .get("/api/item-prices?merchant=McDonald's")
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const item of res.body) {
      expect(item.merchant).toBe("McDonald's");
    }
  });

  it('filters by merchant and item', async () => {
    const res = await request(app)
      .get("/api/item-prices?merchant=McDonald's&item=Big Mac")
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].itemName).toBe('Big Mac');
    expect(res.body[0].price).toBe(30);
  });

  it('returns empty array when item not found', async () => {
    const res = await request(app)
      .get("/api/item-prices?merchant=McDonald's&item=Impossible Burger")
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('does not expose other user data', async () => {
    const res = await request(app)
      .get('/api/item-prices')
      .set('Authorization', `Bearer ${TOKEN_A}`);
    const prices = res.body as Array<{ price: number }>;
    const hasBadData = prices.some((p) => p.price === 999);
    expect(hasBadData).toBe(false);
  });
});

// ─── GET /api/item-prices/suggest ────────────────────────────────────────────

describe('GET /api/item-prices/suggest', () => {
  beforeEach(async () => {
    await ItemPriceModel.create([
      {
        userId: USER_A,
        merchant: "McDonald's",
        itemName: 'Big Mac',
        price: 30,
        currency: 'HKD',
        lastSeen: new Date('2026-03-27'),
        priceHistory: [{ price: 30, date: new Date('2026-03-27') }],
        occurrences: 5,
      },
      {
        userId: USER_A,
        merchant: "McDonald's",
        itemName: 'McFlurry',
        price: 15,
        currency: 'HKD',
        lastSeen: new Date('2026-03-20'),
        priceHistory: [{ price: 15, date: new Date('2026-03-20') }],
        occurrences: 2,
      },
      {
        userId: USER_A,
        merchant: 'Starbucks',
        itemName: 'Latte',
        price: 45,
        currency: 'HKD',
        lastSeen: new Date('2026-03-10'),
        priceHistory: [{ price: 45, date: new Date('2026-03-10') }],
        occurrences: 3,
      },
    ]);
  });

  it('requires JWT auth', async () => {
    const res = await request(app).get("/api/item-prices/suggest?merchant=McDonald's");
    expect(res.status).toBe(401);
  });

  it('requires merchant query param', async () => {
    const res = await request(app)
      .get('/api/item-prices/suggest')
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(400);
  });

  it('returns all items at a merchant sorted by occurrences desc', async () => {
    const res = await request(app)
      .get("/api/item-prices/suggest?merchant=McDonald's")
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body.merchant).toBe("McDonald's");
    expect(res.body.items).toHaveLength(2);
    // Big Mac has more occurrences, should be first
    expect(res.body.items[0].itemName).toBe('Big Mac');
    expect(res.body.items[1].itemName).toBe('McFlurry');
  });

  it('returns empty items array for unknown merchant', async () => {
    const res = await request(app)
      .get('/api/item-prices/suggest?merchant=Unknown Place')
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('does not mix merchants', async () => {
    const res = await request(app)
      .get('/api/item-prices/suggest?merchant=Starbucks')
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].itemName).toBe('Latte');
  });

  it('does not include priceHistory in suggestion response', async () => {
    const res = await request(app)
      .get("/api/item-prices/suggest?merchant=McDonald's")
      .set('Authorization', `Bearer ${TOKEN_A}`);
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.priceHistory).toBeUndefined();
    }
  });
});
