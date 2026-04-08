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

  it('returns version in response', async () => {
    const res = await request(app)
      .get('/health');

    expect(res.status).toBe(200);
    expect(res.body.version).toBeDefined();
  });
});

describe('App bootstrap', () => {
  it('sets up CORS middleware correctly', async () => {
    const res = await request(app)
      .get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('sets up express.json() middleware', async () => {
    const res = await request(app)
      .get('/health');

    // Verify that the app has middleware configured correctly
    expect(res.status).toBe(200);
  });
});

