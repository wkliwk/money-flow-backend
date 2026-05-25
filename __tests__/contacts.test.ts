process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import ContactModel from '../src/models/Contact';

let mongod: MongoMemoryServer;
const USER = 'user_test_contacts';
const OTHER = 'user_other_contacts';
const token = jwt.sign({ userId: USER }, 'test-secret');
const otherToken = jwt.sign({ userId: OTHER }, 'test-secret');

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

describe('GET /api/contacts', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/contacts');
    expect(res.status).toBe(401);
  });

  it('returns empty list initially', async () => {
    const res = await request(app).get('/api/contacts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contacts: [] });
  });

  it('returns only the owner contacts, newest first', async () => {
    await ContactModel.create({ userId: OTHER, name: 'NotMine' });
    await ContactModel.create({ userId: USER, name: 'Alice' });
    await new Promise((r) => setTimeout(r, 10));
    await ContactModel.create({ userId: USER, name: 'Casey' });

    const res = await request(app).get('/api/contacts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.contacts.map((c: { name: string }) => c.name)).toEqual(['Casey', 'Alice']);
  });

  it('returns 500 if the query throws', async () => {
    jest.spyOn(ContactModel, 'find').mockImplementationOnce(() => { throw new Error('db'); });
    const res = await request(app).get('/api/contacts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/contacts', () => {
  it('creates a contact with just a name', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Casey' });
    expect(res.status).toBe(201);
    expect(res.body.contact.name).toBe('Casey');
    expect(res.body.contact.userId).toBe(USER);
  });

  it('stores optional email and color when provided', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Alice', email: 'ALICE@example.com', color: '#5B4EC7' });
    expect(res.status).toBe(201);
    expect(res.body.contact.email).toBe('alice@example.com');
    expect(res.body.contact.color).toBe('#5B4EC7');
  });

  it('rejects an empty name', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('rejects a malformed email', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('returns 500 if create throws', async () => {
    jest.spyOn(ContactModel, 'create').mockRejectedValueOnce(new Error('db'));
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' });
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/contacts/:id', () => {
  it('updates name + email + color', async () => {
    const c = await ContactModel.create({ userId: USER, name: 'Old' });
    const res = await request(app)
      .patch(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New', email: 'new@example.com', color: '#FF0000' });
    expect(res.status).toBe(200);
    expect(res.body.contact.name).toBe('New');
    expect(res.body.contact.email).toBe('new@example.com');
    expect(res.body.contact.color).toBe('#FF0000');
  });

  it('allows clearing optional fields by passing null', async () => {
    const c = await ContactModel.create({ userId: USER, name: 'A', email: 'a@b.com', color: '#fff' });
    const res = await request(app)
      .patch(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: null, color: null });
    expect(res.status).toBe(200);
    expect(res.body.contact.email).toBeFalsy();
    expect(res.body.contact.color).toBeFalsy();
  });

  it('returns 404 when contact does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .patch(`/api/contacts/${fakeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('does not allow updating someone else contact', async () => {
    const c = await ContactModel.create({ userId: OTHER, name: 'Mine' });
    const res = await request(app)
      .patch(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });

  it('rejects an empty name update', async () => {
    const c = await ContactModel.create({ userId: USER, name: 'X' });
    const res = await request(app)
      .patch(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('returns 500 when update throws', async () => {
    const c = await ContactModel.create({ userId: USER, name: 'X' });
    jest.spyOn(ContactModel, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db'));
    const res = await request(app)
      .patch(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Y' });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/contacts/:id', () => {
  it('deletes the contact', async () => {
    const c = await ContactModel.create({ userId: USER, name: 'X' });
    const res = await request(app)
      .delete(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    const found = await ContactModel.findById(c._id);
    expect(found).toBeNull();
  });

  it('returns 404 when not found', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .delete(`/api/contacts/${fakeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when contact belongs to other user', async () => {
    const c = await ContactModel.create({ userId: OTHER, name: 'Mine' });
    const res = await request(app)
      .delete(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 500 when delete throws', async () => {
    const c = await ContactModel.create({ userId: USER, name: 'X' });
    jest.spyOn(ContactModel, 'findOneAndDelete').mockRejectedValueOnce(new Error('db'));
    const res = await request(app)
      .delete(`/api/contacts/${c._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});

// Keep otherToken referenced so lint doesn't strip it for future tests
void otherToken;
