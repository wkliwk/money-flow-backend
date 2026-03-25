import './instrument';
import * as Sentry from '@sentry/node';
import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import expenseRoutes from './routes/expenses';
import budgetRoutes from './routes/budgets';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/money-flow';

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    const state = mongoose.connection.readyState;
    if (state === 1) {
      // Check if we can ping the database
      await mongoose.connection.db?.admin().ping();
      res.json({ status: 'ok', database: 'connected' });
    } else {
      res.status(503).json({ status: 'degraded', database: 'disconnected' });
    }
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

app.use('/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/budgets', budgetRoutes);

Sentry.setupExpressErrorHandler(app);

// Global error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Exponential backoff retry logic
const connectWithRetry = (attempt = 1) => {
  const maxAttempts = 5;
  const baseDelay = 1000; // 1 second

  mongoose
    .connect(MONGODB_URI, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      minPoolSize: 5,
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority',
    })
    .then(() => {
      console.log('Connected to MongoDB');
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    })
    .catch((err) => {
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(`MongoDB connection failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`, err.message);
        setTimeout(() => connectWithRetry(attempt + 1), delay);
      } else {
        console.error('MongoDB connection failed after max retries:', err);
        process.exit(1);
      }
    });
};

connectWithRetry();

export default app;
