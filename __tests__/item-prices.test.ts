process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ItemPriceModel from '../src/models/ItemPrice';

let mongod: MongoMemoryServer;
const USER = 'user_test_item_prices';
const OTHER = 'user_other_item_prices';
const token = jwt.sign({ userId: USER }, 'test-secret');

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

describe('POST /api/item-prices/extract', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .send({ merchant: 'X', items: [{ itemName: 'a', price: 1 }] });
    expect(res.status).toBe(401);
  });

  it('upserts new items and returns count', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({
        merchant: '  ParkN  ',
        items: [
          { itemName: 'Milk', price: 25.5 },
          { itemName: ' Bread ', price: 12, currency: 'hkd' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stored: 2, merchant: 'ParkN' });

    const docs = await ItemPriceModel.find({ userId: USER }).lean();
    expect(docs).toHaveLength(2);
    const milk = docs.find((d) => d.itemName === 'Milk')!;
    expect(milk.price).toBe(25.5);
    expect(milk.currency).toBe('HKD');
    expect(milk.occurrences).toBe(1);
    expect(milk.priceHistory).toHaveLength(1);
  });

  it('increments occurrences and appends price history on repeated upserts', async () => {
    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ merchant: 'M', items: [{ itemName: 'X', price: 10 }] });

    await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ merchant: 'M', items: [{ itemName: 'X', price: 12 }] });

    const doc = await ItemPriceModel.findOne({ userId: USER, itemName: 'X' }).lean();
    expect(doc!.price).toBe(12);
    expect(doc!.occurrences).toBe(2);
    expect(doc!.priceHistory).toHaveLength(2);
  });

  it('accepts optional ISO receiptDate', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({
        merchant: 'M',
        items: [{ itemName: 'X', price: 1 }],
        receiptDate: '2026-01-15T00:00:00.000Z',
      });
    expect(res.status).toBe(200);
    const doc = await ItemPriceModel.findOne({ userId: USER }).lean();
    expect(new Date(doc!.lastSeen).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('rejects missing merchant', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ itemName: 'X', price: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/merchant/i);
  });

  it('rejects empty items array', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ merchant: 'M', items: [] });
    expect(res.status).toBe(400);
  });

  it('rejects negative price', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ merchant: 'M', items: [{ itemName: 'X', price: -1 }] });
    expect(res.status).toBe(400);
  });

  it('rejects 4-letter currency', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ merchant: 'M', items: [{ itemName: 'X', price: 1, currency: 'HKDX' }] });
    expect(res.status).toBe(400);
  });

  it('rejects bad receiptDate', async () => {
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ merchant: 'M', items: [{ itemName: 'X', price: 1 }], receiptDate: 'yesterday' });
    expect(res.status).toBe(400);
  });

  it('returns 500 when db throws', async () => {
    jest.spyOn(ItemPriceModel, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db'));
    const res = await request(app)
      .post('/api/item-prices/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ merchant: 'M', items: [{ itemName: 'X', price: 1 }] });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to store item prices');
  });
});

describe('GET /api/item-prices', () => {
  beforeEach(async () => {
    await ItemPriceModel.create([
      { userId: USER, merchant: 'A', itemName: 'X', price: 1, currency: 'HKD', lastSeen: new Date('2026-01-01') },
      { userId: USER, merchant: 'B', itemName: 'Y', price: 2, currency: 'HKD', lastSeen: new Date('2026-02-01') },
      { userId: OTHER, merchant: 'A', itemName: 'X', price: 99, currency: 'HKD', lastSeen: new Date('2026-03-01') },
    ]);
  });

  it('returns only user prices, newest lastSeen first', async () => {
    const res = await request(app)
      .get('/api/item-prices')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].merchant).toBe('B');
    expect(res.body[1].merchant).toBe('A');
  });

  it('filters by merchant', async () => {
    const res = await request(app)
      .get('/api/item-prices?merchant=A')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].itemName).toBe('X');
  });

  it('filters by item', async () => {
    const res = await request(app)
      .get('/api/item-prices?item=Y')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].merchant).toBe('B');
  });

  it('rejects empty merchant query string', async () => {
    const res = await request(app)
      .get('/api/item-prices?merchant=%20%20')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 500 when db throws', async () => {
    jest.spyOn(ItemPriceModel, 'find').mockImplementationOnce(() => {
      throw new Error('db');
    });
    const res = await request(app)
      .get('/api/item-prices')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/item-prices/suggest', () => {
  beforeEach(async () => {
    await ItemPriceModel.create([
      { userId: USER, merchant: 'M', itemName: 'A', price: 1, currency: 'HKD', lastSeen: new Date('2026-01-01'), occurrences: 5 },
      { userId: USER, merchant: 'M', itemName: 'B', price: 2, currency: 'HKD', lastSeen: new Date('2026-02-01'), occurrences: 3 },
      { userId: USER, merchant: 'OTHER', itemName: 'C', price: 3, currency: 'HKD', lastSeen: new Date('2026-03-01'), occurrences: 9 },
    ]);
  });

  it('returns items at the requested merchant, sorted by occurrences desc', async () => {
    const res = await request(app)
      .get('/api/item-prices/suggest?merchant=M')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.merchant).toBe('M');
    expect(res.body.items.map((i: { itemName: string }) => i.itemName)).toEqual(['A', 'B']);
  });

  it('rejects missing merchant', async () => {
    const res = await request(app)
      .get('/api/item-prices/suggest')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns empty items when merchant has no entries', async () => {
    const res = await request(app)
      .get('/api/item-prices/suggest?merchant=NOPE')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('returns 500 when db throws', async () => {
    jest.spyOn(ItemPriceModel, 'find').mockImplementationOnce(() => {
      throw new Error('db');
    });
    const res = await request(app)
      .get('/api/item-prices/suggest?merchant=M')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});
