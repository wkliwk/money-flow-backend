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
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

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
    } catch {
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  }
);

export default router;
