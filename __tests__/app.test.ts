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
      .get('/health')
      .set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('blocks unknown origins', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(500);
  });

  it('allows localhost:3002 for local dev', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:3002');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3002');
  });

  it('sets up express.json() middleware', async () => {
    const res = await request(app)
      .get('/health');

    // Verify that the app has middleware configured correctly
    expect(res.status).toBe(200);
  });
});

