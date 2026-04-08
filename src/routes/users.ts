import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import UserModel from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

// GET /api/users/me
router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    const user = await UserModel.findById(req.userId).select('-password').lean();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch user';
    res.status(500).json({ error: message });
  }
});

// PATCH /api/users/profile — update baseCurrency
router.patch(
  '/profile',
  [
    body('baseCurrency')
      .notEmpty()
      .isLength({ min: 3, max: 3 })
      .toUpperCase()
      .withMessage('baseCurrency must be a 3-letter ISO 4217 currency code'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const { baseCurrency } = req.body as { baseCurrency: string };

      const user = await UserModel.findByIdAndUpdate(
        req.userId,
        { $set: { baseCurrency: baseCurrency.toUpperCase() } },
        { new: true, runValidators: true }
      )
        .select('-password')
        .lean();

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile';
      res.status(500).json({ error: message });
    }
  }
);

// PATCH /api/users/preferences
router.patch(
  '/preferences',
  [
    body('themePreference')
      .isIn(['light', 'dark', 'system'])
      .withMessage('themePreference must be one of: light, dark, system'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const { themePreference } = req.body as { themePreference: 'light' | 'dark' | 'system' };

      const user = await UserModel.findByIdAndUpdate(
        req.userId,
        { $set: { themePreference } },
        { new: true, runValidators: true }
      )
        .select('-password')
        .lean();

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update preferences';
      res.status(500).json({ error: message });
    }
  }
);

// PATCH /api/users/password
router.patch(
  '/password',
  [
    body('currentPassword')
      .notEmpty()
      .withMessage('currentPassword is required'),
    body('newPassword')
      .isLength({ min: 6 })
      .withMessage('newPassword must be at least 6 characters'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };

      const user = await UserModel.findById(req.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (!user.password) {
        res.status(400).json({ error: 'Password change not available for social login accounts' });
        return;
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }

      user.password = newPassword;
      await user.save();

      res.json({ message: 'Password updated' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update password';
      res.status(500).json({ error: message });
    }
  }
);
export default router;
