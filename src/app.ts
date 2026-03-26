import './instrument';
import * as Sentry from '@sentry/node';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectWithRetry, getHealthStatus } from './db';
import authRoutes from './routes/auth';
import expenseRoutes from './routes/expenses';
import budgetRoutes from './routes/budgets';
import netWorthRoutes from './routes/net-worth';
import exportRoutes from './routes/export';
import importRoutes from './routes/import';
import recurringRoutes from './routes/recurring';
import reportRoutes from './routes/reports';
import exchangeRateRoutes from './routes/exchange-rates';
import userRoutes from './routes/users';
import { startAlertScheduler } from './jobs/processAlerts';
import { startRecurringScheduler } from './jobs/processRecurring';
import { startWeeklyDigestScheduler } from './jobs/weeklyDigest';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/money-flow';

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

const { version } = require('../package.json') as { version: string };

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version });
});

app.get('/api/health', async (_req, res) => {
  const health = await getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json({ ...health, version });
});

app.use('/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/net-worth', netWorthRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/import', importRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/exchange-rates', exchangeRateRoutes);
app.use('/api/users', userRoutes);

Sentry.setupExpressErrorHandler(app);

// Global error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Only connect and start server when not in test environment
if (process.env.NODE_ENV !== 'test') {
  connectWithRetry(MONGODB_URI)
    .then(() => {
      console.log('Connected to MongoDB');
      startAlertScheduler();
      startRecurringScheduler();
      startWeeklyDigestScheduler();
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err);
      process.exit(1);
    });
}

export default app;
