import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import UserModel from '../models/User';
import ExpenseModel from '../models/Expense';
import TransactionTemplateModel from '../models/TransactionTemplate';
import RecurringExpenseModel from '../models/RecurringExpense';
import GoalModel from '../models/Goal';
import AccountModel from '../models/Account';
import NetWorthModel from '../models/NetWorth';
import { WeeklyPulseModel } from '../models/WeeklyPulse';
import AlertModel from '../models/Alert';
import ItemPriceModel from '../models/ItemPrice';
import FriendshipModel from '../models/Friendship';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

const rateLimitMessage = { error: 'Too many requests, please try again later' };

const isTestWithoutRateLimit = (): boolean =>
  process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT !== 'true';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
  skip: isTestWithoutRateLimit,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
  skip: isTestWithoutRateLimit,
});

export const socialAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
  skip: isTestWithoutRateLimit,
});

const signToken = (userId: string): string =>
  jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn: '7d' });

// POST /auth/register
router.post(
  '/register',
  registerLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const { email, password } = req.body as { email: string; password: string };
      const existing = await UserModel.findOne({ email });
      if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      const user = await UserModel.create({ email, password });
      const token = signToken(user.id as string);
      res.status(201).json({ token });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      res.status(500).json({ error: message });
    }
  }
);

// POST /auth/login
router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const { email, password } = req.body as { email: string; password: string };
      const user = await UserModel.findOne({ email });
      if (!user || !(await user.comparePassword(password))) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
      const token = signToken(user.id as string);
      res.json({ token });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      res.status(500).json({ error: message });
    }
  }
);

// POST /auth/google
router.post(
  '/google',
  socialAuthLimiter,
  [body('idToken').notEmpty()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: 'idToken is required' });
      return;
    }

    try {
      const { idToken } = req.body as { idToken: string };
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        res.status(500).json({ error: 'Google OAuth not configured' });
        return;
      }

      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        res.status(401).json({ error: 'Invalid Google token' });
        return;
      }

      const { email, sub: googleId } = payload;

      // Check if user exists by googleId or email
      let user = await UserModel.findOne({
        $or: [{ googleId }, { email: email.toLowerCase() }],
      });

      if (user) {
        // Link Google account if not already linked
        if (!user.googleId) {
          user.googleId = googleId;
          await user.save();
        }
      } else {
        // Create new OAuth-only user
        user = await UserModel.create({
          email: email.toLowerCase(),
          googleId,
        });
      }

      const token = signToken(user.id as string);
      res.json({ token });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google authentication failed';
      res.status(401).json({ error: message });
    }
  }
);

// POST /auth/apple
router.post(
  '/apple',
  socialAuthLimiter,
  [body('idToken').notEmpty()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: 'idToken is required' });
      return;
    }

    try {
      const { idToken } = req.body as { idToken: string };
      const clientId = process.env.APPLE_CLIENT_ID;
      if (!clientId) {
        res.status(500).json({ error: 'Apple Sign-In not configured' });
        return;
      }

      const payload = await appleSignin.verifyIdToken(idToken, {
        audience: clientId,
      });

      const { email, sub: appleId } = payload;
      if (!email) {
        res.status(401).json({ error: 'Invalid Apple token' });
        return;
      }

      let user = await UserModel.findOne({
        $or: [{ appleId }, { email: email.toLowerCase() }],
      });

      if (user) {
        if (!user.appleId) {
          user.appleId = appleId;
          await user.save();
        }
      } else {
        user = await UserModel.create({
          email: email.toLowerCase(),
          appleId,
        });
      }

      const token = signToken(user.id as string);
      res.json({ token });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Apple authentication failed';
      res.status(401).json({ error: message });
    }
  }
);

export const deleteAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
  skip: isTestWithoutRateLimit,
});

// DELETE /auth/account
router.delete(
  '/account',
  deleteAccountLimiter,
  protect,
  [body('password').notEmpty().withMessage('Password is required')],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const userId = req.userId as string;
      const { password } = req.body as { password: string };

      const user = await UserModel.findById(userId);
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      if (!user.password) {
        res.status(400).json({ error: 'OAuth-only accounts cannot be deleted with password confirmation' });
        return;
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        res.status(401).json({ error: 'Incorrect password' });
        return;
      }

      await Promise.all([
        ExpenseModel.deleteMany({ owner: userId }),
        TransactionTemplateModel.deleteMany({ owner: userId }),
        RecurringExpenseModel.deleteMany({ userId }),
        GoalModel.deleteMany({ userId }),
        AccountModel.deleteMany({ userId }),
        NetWorthModel.deleteMany({ userId }),
        WeeklyPulseModel.deleteMany({ userId }),
        AlertModel.deleteMany({ userId }),
        ItemPriceModel.deleteMany({ userId }),
        FriendshipModel.deleteMany({ $or: [{ requester: userId }, { recipient: userId }] }),
        UserModel.findByIdAndDelete(userId),
      ]);

      res.json({ message: 'Account and all data deleted' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Account deletion failed';
      res.status(500).json({ error: message });
    }
  }
);

export default router;
