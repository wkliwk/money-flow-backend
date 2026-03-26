process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import app from '../src/app';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request(app)
      .get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

