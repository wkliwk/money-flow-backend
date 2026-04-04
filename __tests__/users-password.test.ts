import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import userRoutes from '../src/routes/users';
import UserModel from '../src/models/User';

let mongoServer: MongoMemoryServer;
const JWT_SECRET = 'test-secret-key';
let app: express.Application;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.JWT_SECRET = JWT_SECRET;
  await mongoose.connect(mongoServer.getUri());

  app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await UserModel.deleteMany({});
});

const generateToken = (userId: string) => {
  return jwt.sign({ userId }, JWT_SECRET);
};

describe('PATCH /api/users/password', () => {
  it('changes password successfully with correct current password', async () => {
    const user = await UserModel.create({ email: 'user@test.com', password: 'password123' });
    const token = generateToken((user._id as mongoose.Types.ObjectId).toString());

    const res = await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password123', newPassword: 'newpass456' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password updated');
  });

  it('allows login with new password after change', async () => {
    const user = await UserModel.create({ email: 'user@test.com', password: 'password123' });
    const token = generateToken((user._id as mongoose.Types.ObjectId).toString());

    await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password123', newPassword: 'newpass456' });

    const updated = await UserModel.findById(user._id);
    const matches = await updated!.comparePassword('newpass456');
    expect(matches).toBe(true);
  });

  it('old password no longer works after change', async () => {
    const user = await UserModel.create({ email: 'user@test.com', password: 'password123' });
    const token = generateToken((user._id as mongoose.Types.ObjectId).toString());

    await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password123', newPassword: 'newpass456' });

    const updated = await UserModel.findById(user._id);
    const matches = await updated!.comparePassword('password123');
    expect(matches).toBe(false);
  });

  it('rejects incorrect current password with 400', async () => {
    const user = await UserModel.create({ email: 'user@test.com', password: 'password123' });
    const token = generateToken((user._id as mongoose.Types.ObjectId).toString());

    const res = await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpass456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Current password is incorrect');
  });

  it('rejects new password shorter than 6 characters', async () => {
    const user = await UserModel.create({ email: 'user@test.com', password: 'password123' });
    const token = generateToken((user._id as mongoose.Types.ObjectId).toString());

    const res = await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password123', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/);
  });

  it('rejects missing currentPassword', async () => {
    const user = await UserModel.create({ email: 'user@test.com', password: 'password123' });
    const token = generateToken((user._id as mongoose.Types.ObjectId).toString());

    const res = await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'newpass456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/currentPassword/);
  });

  it('rejects missing newPassword', async () => {
    const user = await UserModel.create({ email: 'user@test.com', password: 'password123' });
    const token = generateToken((user._id as mongoose.Types.ObjectId).toString());

    const res = await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for account with no password set (social login)', async () => {
    const id = new mongoose.Types.ObjectId();
    await UserModel.collection.insertOne({ _id: id, email: 'social@test.com', budgets: [] });
    const token = generateToken(id.toString());

    const res = await request(app)
      .patch('/api/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'anything', newPassword: 'newpass456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password change not available for social login accounts');
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .patch('/api/users/password')
      .send({ currentPassword: 'password123', newPassword: 'newpass456' });
    expect(res.status).toBe(401);
  });
});
