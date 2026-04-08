process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';

describe('global error handler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 500 with a generic message when a route throws', async () => {
    jest.resetModules();
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      setupExpressErrorHandler: jest.fn(),
    }));

    jest.doMock('../src/routes/expenses', () => {
      const { Router } = require('express');
      const router = Router();

      router.get('/boom', (_req: any, _res: any, next: any) => {
        next(new Error('boom'));
      });

      return { __esModule: true, default: router };
    });

    const app = (await import('../src/app')).default;

    const res = await request(app)
      .get('/api/expenses/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

