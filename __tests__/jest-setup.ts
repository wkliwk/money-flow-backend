// Jest global setup — sets env vars before any module is imported
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.PORT = '0';
// MONGODB_URI is set per test file via MongoMemoryServer
