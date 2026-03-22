import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import UserModel from '../models/User';

const router = Router();

const signToken = (userId: string): string =>
  jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn: '7d' });

// POST /auth/register
router.post(
  '/register',
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
    } catch {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// POST /auth/login
router.post(
  '/login',
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
    } catch {
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

export default router;
