process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import app from '../src/app';

let mongod: MongoMemoryServer;
const TEST_USER_ID = 'user_test_123';
const OTHER_USER_ID = 'user_other_456';
const authToken = jwt.sign({ userId: TEST_USER_ID }, 'test-secret');
const otherToken = jwt.sign({ userId: OTHER_USER_ID }, 'test-secret');

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
});

const basePayload = {
  name: 'Monthly Rent',
  amount: 1500,
  category: 'Housing',
  description: 'Apartment rent',
  frequency: 'monthly',
};

async function createTemplate(overrides = {}) {
  const res = await request(app)
    .post('/api/templates')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ ...basePayload, ...overrides });
  return res.body;
}

describe('GET /api/templates', () => {
  it('returns empty array for new user', async () => {
    const res = await request(app)
      .get('/api/templates')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([]);
  });

  it('returns all templates for user', async () => {
    await createTemplate({ name: 'Template 1' });
    await createTemplate({ name: 'Template 2' });
    const res = await request(app)
      .get('/api/templates')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(2);
    expect(res.body.templates[0].name).toBe('Template 2');
    expect(res.body.templates[1].name).toBe('Template 1');
  });

  it('only returns templates for authenticated user', async () => {
    await createTemplate({ name: 'User 1 Template' });
    const res = await request(app)
      .get('/api/templates')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/templates');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

describe('POST /api/templates', () => {
  it('creates new template with valid data', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send(basePayload);
    expect(res.status).toBe(201);
    expect(res.body._id).toBeDefined();
    expect(res.body.name).toBe('Monthly Rent');
    expect(res.body.amount).toBe(1500);
    expect(res.body.category).toBe('Housing');
    expect(res.body.frequency).toBe('monthly');
    expect(res.body.owner).toBe(TEST_USER_ID);
  });

  it('creates template with weekly frequency', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, frequency: 'weekly', amount: 50 });
    expect(res.status).toBe(201);
    expect(res.body.frequency).toBe('weekly');
  });

  it('creates template with biweekly frequency', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, frequency: 'biweekly', amount: 75 });
    expect(res.status).toBe(201);
    expect(res.body.frequency).toBe('biweekly');
  });

  it('creates template without optional fields', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Simple', amount: 100, frequency: 'monthly' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Simple');
    expect(res.body.category).toBeUndefined();
    expect(res.body.description).toBeUndefined();
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amount: 100, frequency: 'monthly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('name');
  });

  it('rejects missing amount', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Test', frequency: 'monthly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('amount');
  });

  it('rejects non-numeric amount', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, amount: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('amount');
  });

  it('rejects missing frequency', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Test', amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('frequency');
  });

  it('rejects invalid frequency', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, frequency: 'daily' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('frequency');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/templates').send(basePayload);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/templates/:id', () => {
  it('retrieves specific template', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .get(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(created._id);
    expect(res.body.name).toBe('Monthly Rent');
  });

  it('returns 404 for non-existent template', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/templates/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Template not found');
  });

  it('prevents access to other user templates', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .get(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const created = await createTemplate();
    const res = await request(app).get(`/api/templates/${created._id}`);
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/templates/:id', () => {
  it('updates template with valid data', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .put(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, name: 'Updated Rent', amount: 2000 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Rent');
    expect(res.body.amount).toBe(2000);
  });

  it('updates frequency', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .put(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, frequency: 'biweekly' });
    expect(res.status).toBe(200);
    expect(res.body.frequency).toBe('biweekly');
  });

  it('returns 404 for non-existent template', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .put(`/api/templates/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(basePayload);
    expect(res.status).toBe(404);
  });

  it('prevents other users from updating templates', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .put(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(basePayload);
    expect(res.status).toBe(404);
  });

  it('rejects invalid frequency on update', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .put(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...basePayload, frequency: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .put(`/api/templates/${created._id}`)
      .send(basePayload);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/templates/:id', () => {
  it('deletes template', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .delete(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Template deleted');

    const getRes = await request(app)
      .get(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for non-existent template', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .delete(`/api/templates/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });

  it('prevents other users from deleting templates', async () => {
    const created = await createTemplate();
    const res = await request(app)
      .delete(`/api/templates/${created._id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const created = await createTemplate();
    const res = await request(app).delete(`/api/templates/${created._id}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/templates/apply/:id', () => {
  it('creates expense from template', async () => {
    const template = await createTemplate();
    const res = await request(app)
      .post(`/api/templates/apply/${template._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(201);
    expect(res.body.description).toBe(template.name);
    expect(res.body.amount).toBe(template.amount);
    expect(res.body.category).toBe(template.category);
    expect(res.body.owner).toBe(TEST_USER_ID);
  });

  it('uses template name as expense description', async () => {
    const template = await createTemplate({ name: 'Grocery Shopping' });
    const res = await request(app)
      .post(`/api/templates/apply/${template._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(201);
    expect(res.body.description).toBe('Grocery Shopping');
  });

  it('preserves category when applying template', async () => {
    const template = await createTemplate({ category: 'Food' });
    const res = await request(app)
      .post(`/api/templates/apply/${template._id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('Food');
  });

  it('returns 404 for non-existent template', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/templates/apply/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(404);
  });

  it('prevents applying other user templates', async () => {
    const template = await createTemplate();
    const res = await request(app)
      .post(`/api/templates/apply/${template._id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const template = await createTemplate();
    const res = await request(app).post(`/api/templates/apply/${template._id}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/templates/apply-multiple', () => {
  it('applies multiple templates at once', async () => {
    const t1 = await createTemplate({ name: 'Rent', amount: 1500 });
    const t2 = await createTemplate({ name: 'Internet', amount: 50 });
    const t3 = await createTemplate({ name: 'Groceries', amount: 200 });

    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ templateIds: [t1._id, t2._id, t3._id] });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(3);
    expect(res.body.expenses).toHaveLength(3);
    expect(res.body.expenses[0].description).toBe('Rent');
    expect(res.body.expenses[1].description).toBe('Internet');
    expect(res.body.expenses[2].description).toBe('Groceries');
  });

  it('creates all expenses even if templates are in different order', async () => {
    const t1 = await createTemplate({ name: 'Template 1', amount: 100 });
    const t2 = await createTemplate({ name: 'Template 2', amount: 200 });

    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ templateIds: [t2._id, t1._id] });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
  });

  it('returns 400 for empty templateIds', async () => {
    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ templateIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing templateIds', async () => {
    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 if templateIds is not an array', async () => {
    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ templateIds: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('returns 404 if some templates not found', async () => {
    const t1 = await createTemplate({ name: 'Template 1' });
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ templateIds: [t1._id, fakeId] });

    expect(res.status).toBe(404);
  });

  it('prevents applying other user templates in batch', async () => {
    const t1 = await createTemplate({ name: 'Template 1' });

    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ templateIds: [t1._id] });

    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const t1 = await createTemplate();
    const res = await request(app)
      .post('/api/templates/apply-multiple')
      .send({ templateIds: [t1._id] });
    expect(res.status).toBe(401);
  });
});
