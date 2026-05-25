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
import receiptRoutes from './routes/receipts';
import templateRoutes from './routes/templates';
import friendRoutes from './routes/friends';
import contactsRoutes from './routes/contacts';
import jobRoutes from './routes/jobs';
import itemPriceRoutes from './routes/item-prices';
import accountRoutes from './routes/accounts';
import insightRoutes from './routes/insights';
import goalRoutes from './routes/goals';
import transactionRoutes from './routes/transactions';
import notificationRoutes from './routes/notifications';
import tagRoutes from './routes/tags';
import { startAlertScheduler } from './jobs/processAlerts';
import { startBudgetAlertPushScheduler } from './jobs/budgetAlertPush';
import { startWeeklySummaryPushScheduler } from './jobs/weeklySummaryPush';
import { startUnusualSpendingPushScheduler } from './jobs/unusualSpendingPush';
import { startRecurringScheduler } from './jobs/processRecurring';
import { startWeeklyDigestScheduler } from './jobs/weeklyDigest';
import { startMonthlySummaryScheduler } from './jobs/monthlySummary';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/money-flow';

const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3002'];
const allowedOrigins = new Set<string>([
  ...DEV_ORIGINS,
  ...(process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());

const { version } = require('../package.json') as { version: string };

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version });
});

app.get('/debug-sentry', (_req, _res) => {
  throw new Error('Sentry test error — verify capture works');
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
app.use('/api/receipts', receiptRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/item-prices', itemPriceRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tags', tagRoutes);

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
      startMonthlySummaryScheduler();
      startBudgetAlertPushScheduler();
      startWeeklySummaryPushScheduler();
      startUnusualSpendingPushScheduler();
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
