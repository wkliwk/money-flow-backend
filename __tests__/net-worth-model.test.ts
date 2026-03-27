process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import NetWorthModel from '../src/models/NetWorth';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_networth_model';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await NetWorthModel.deleteMany({});
});

describe('NetWorthModel', () => {
  it('calculates netWorth for full assets/liabilities', async () => {
    const doc = await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: new Date('2026-01-01T00:00:00.000Z'),
      assets: { cash: 10, investments: 20, property: 30, other: 40 },
      liabilities: { loans: 1, creditCardDebt: 2, other: 3 },
    });

    expect(doc.netWorth).toBe(94); // (10+20+30+40) - (1+2+3)
  });

  it('treats missing/zero values as 0', async () => {
    const doc = await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: new Date('2026-01-02T00:00:00.000Z'),
      assets: { cash: 0, investments: 0, property: 0, other: 0 },
      liabilities: { loans: 0, creditCardDebt: 0, other: 0 },
    });

    expect(doc.netWorth).toBe(0);
  });

  it('calculates netWorth with partial assets and undefined liabilities', async () => {
    const doc = await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: new Date('2026-01-03T00:00:00.000Z'),
      assets: { cash: 5000, investments: undefined, property: undefined, other: undefined },
      liabilities: undefined,
    });

    expect(doc.netWorth).toBe(5000); // 5000 - (0 + 0 + 0)
  });

  it('calculates netWorth with only liabilities', async () => {
    const doc = await NetWorthModel.create({
      userId: TEST_USER_ID,
      date: new Date('2026-01-04T00:00:00.000Z'),
      assets: { cash: 0, investments: 0, property: 0, other: 0 },
      liabilities: { loans: 1000, creditCardDebt: 2000, other: 500 },
    });

    expect(doc.netWorth).toBe(-3500); // 0 - (1000 + 2000 + 500)
  });

  it('calculates netWorth using .save() method (pre-save hook)', async () => {
    const doc = new NetWorthModel({
      userId: TEST_USER_ID,
      date: new Date('2026-01-05T00:00:00.000Z'),
      assets: { cash: 50000 },
      liabilities: { loans: 10000 },
    });

    await doc.save();

    expect(doc.netWorth).toBe(40000); // 50000 - 10000
  });
});

