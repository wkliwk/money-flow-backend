process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const DEPRECATED_MSG = /Use \/api\/contacts instead/i;

describe('deprecated /api/friends — all routes return 410', () => {
  it('GET /api/friends returns 410', async () => {
    const res = await request(app).get('/api/friends');
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(DEPRECATED_MSG);
  });

  it('GET /api/friends/pending returns 410', async () => {
    const res = await request(app).get('/api/friends/pending');
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(DEPRECATED_MSG);
  });

  it('POST /api/friends/request returns 410', async () => {
    const res = await request(app)
      .post('/api/friends/request')
      .send({ email: 'anyone@example.com' });
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(DEPRECATED_MSG);
  });

  it('POST /api/friends/:id/accept returns 410', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post(`/api/friends/${fakeId}/accept`);
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(DEPRECATED_MSG);
  });

  it('POST /api/friends/:id/reject returns 410', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post(`/api/friends/${fakeId}/reject`);
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(DEPRECATED_MSG);
  });

  it('DELETE /api/friends/:id returns 410', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).delete(`/api/friends/${fakeId}`);
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(DEPRECATED_MSG);
  });
});
