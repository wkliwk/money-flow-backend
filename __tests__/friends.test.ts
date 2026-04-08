process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import UserModel from '../src/models/User';
import FriendshipModel from '../src/models/Friendship';

let mongod: MongoMemoryServer;
let userA: string;
let userB: string;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const a = await UserModel.create({ email: 'alice@test.com', password: 'pass123456' });
  const b = await UserModel.create({ email: 'bob@test.com', password: 'pass123456' });
  userA = String(a._id);
  userB = String(b._id);
  tokenA = jwt.sign({ userId: userA }, 'test-secret');
  tokenB = jwt.sign({ userId: userB }, 'test-secret');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await FriendshipModel.deleteMany({});
});

describe('POST /api/friends/request', () => {
  it('returns 401 without auth', async () => {
    await request(app).post('/api/friends/request').send({ email: 'bob@test.com' }).expect(401);
  });

  it('sends friend request by email', async () => {
    const res = await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'bob@test.com' })
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.email).toBe('bob@test.com');
  });

  it('returns 404 for non-existent user', async () => {
    await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'nobody@test.com' })
      .expect(404);
  });

  it('returns 400 when friending yourself', async () => {
    await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'alice@test.com' })
      .expect(400);
  });

  it('returns 409 for duplicate request', async () => {
    await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'bob@test.com' })
      .expect(201);
    await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'bob@test.com' })
      .expect(409);
  });

  it('returns 400 for invalid email', async () => {
    await request(app)
      .post('/api/friends/request')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});

describe('GET /api/friends/pending', () => {
  it('returns pending requests for recipient', async () => {
    await FriendshipModel.create({ requester: userA, recipient: userB, status: 'pending' });
    const res = await request(app)
      .get('/api/friends/pending')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].email).toBe('alice@test.com');
  });

  it('returns empty for requester', async () => {
    await FriendshipModel.create({ requester: userA, recipient: userB, status: 'pending' });
    const res = await request(app)
      .get('/api/friends/pending')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.requests).toHaveLength(0);
  });
});

describe('POST /api/friends/:id/accept', () => {
  it('accepts a pending request', async () => {
    const f = await FriendshipModel.create({ requester: userA, recipient: userB, status: 'pending' });
    await request(app)
      .post(`/api/friends/${f._id}/accept`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const updated = await FriendshipModel.findById(f._id);
    expect(updated?.status).toBe('accepted');
  });

  it('returns 404 if not the recipient', async () => {
    const f = await FriendshipModel.create({ requester: userA, recipient: userB, status: 'pending' });
    await request(app)
      .post(`/api/friends/${f._id}/accept`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });
});

describe('POST /api/friends/:id/reject', () => {
  it('rejects and removes the request', async () => {
    const f = await FriendshipModel.create({ requester: userA, recipient: userB, status: 'pending' });
    await request(app)
      .post(`/api/friends/${f._id}/reject`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const deleted = await FriendshipModel.findById(f._id);
    expect(deleted).toBeNull();
  });
});

describe('GET /api/friends', () => {
  it('returns accepted friends for both users', async () => {
    await FriendshipModel.create({ requester: userA, recipient: userB, status: 'accepted' });

    const resA = await request(app)
      .get('/api/friends')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(resA.body.friends).toHaveLength(1);
    expect(resA.body.friends[0].email).toBe('bob@test.com');

    const resB = await request(app)
      .get('/api/friends')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(resB.body.friends).toHaveLength(1);
    expect(resB.body.friends[0].email).toBe('alice@test.com');
  });

  it('does not return pending friendships', async () => {
    await FriendshipModel.create({ requester: userA, recipient: userB, status: 'pending' });
    const res = await request(app)
      .get('/api/friends')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.friends).toHaveLength(0);
  });
});

describe('DELETE /api/friends/:id', () => {
  it('removes an accepted friendship', async () => {
    const f = await FriendshipModel.create({ requester: userA, recipient: userB, status: 'accepted' });
    await request(app)
      .delete(`/api/friends/${f._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const deleted = await FriendshipModel.findById(f._id);
    expect(deleted).toBeNull();
  });

  it('returns 404 for non-existent friendship', async () => {
    await request(app)
      .delete(`/api/friends/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });
});
