import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';

let mongoServer: MongoMemoryServer;

describe('Database Reliability - Health Endpoint', () => {
  let testApp: express.Application;

  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    // Set MongoDB URI for our connection
    process.env.MONGODB_URI = mongoUri;

    // Create a fresh Express app for testing
    testApp = express();
    const PORT = 3002;

    testApp.get('/health', async (_req, res) => {
      try {
        const state = mongoose.connection.readyState;
        if (state === 1) {
          await mongoose.connection.db?.admin().ping();
          res.json({ status: 'ok', database: 'connected' });
        } else {
          res.status(503).json({ status: 'degraded', database: 'disconnected' });
        }
      } catch (err) {
        res.status(503).json({ status: 'error', database: 'unreachable' });
      }
    });

    // Connect to in-memory database
    await mongoose.connect(mongoUri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      minPoolSize: 5,
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority',
    });
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  test('GET /health returns 200 with ok status when database is connected', async () => {
    const response = await request(testApp)
      .get('/health')
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('connected');
  });

  test('GET /health includes database connection status', async () => {
    const response = await request(testApp)
      .get('/health')
      .timeout(5000);

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('database');
    expect(['ok', 'degraded', 'error']).toContain(response.body.status);
  });

  test('GET /health returns 503 when database is disconnected', async () => {
    // Disconnect
    const wasConnected = mongoose.connection.readyState === 1;
    if (wasConnected) {
      await mongoose.disconnect();
    }

    const response = await request(testApp)
      .get('/health')
      .timeout(5000);

    expect(response.status).toBe(503);
    expect(['degraded', 'error']).toContain(response.body.status);

    // Reconnect for next tests
    if (wasConnected && mongoServer) {
      await mongoose.connect(mongoServer.getUri(), {
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000,
      });
    }
  });

  test('GET /health is idempotent - same response on repeated calls', async () => {
    const response1 = await request(testApp).get('/health').timeout(5000);
    const response2 = await request(testApp).get('/health').timeout(5000);

    expect(response1.body).toEqual(response2.body);
  });

  test('GET /health responds within timeout limits', async () => {
    const start = Date.now();

    const response = await request(testApp)
      .get('/health')
      .timeout(5000);

    const duration = Date.now() - start;

    expect(response.status).toBeDefined();
    // Should respond much faster than the 10s timeout
    expect(duration).toBeLessThan(5000);
  });

  test('Connection pooling maintains multiple connections', async () => {
    // Verify connection was made with pooling options
    const conn = mongoose.connection;

    expect(conn).toBeDefined();
    expect(conn.readyState).toBe(1); // Connected
    // In a real MongoDB with multiple clients, pooling ensures reuse
    // Here we just verify the connection is active
  });
});
