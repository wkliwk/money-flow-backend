import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import UserModel from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

/**
 * POST /api/notifications/register
 * Store the user's Expo push token and notification preferences.
 *
 * Body: { token: string, prefs?: { budgetAlerts?: boolean, weeklySummary?: boolean, unusualSpending?: boolean } }
 */
router.post(
  '/register',
  [
    body('token')
      .isString()
      .notEmpty()
      .withMessage('token is required')
      .matches(/^Expo(nent)?PushToken\[.+\]$/)
      .withMessage('token must be a valid Expo push token'),
    body('prefs.budgetAlerts').optional().isBoolean(),
    body('prefs.weeklySummary').optional().isBoolean(),
    body('prefs.unusualSpending').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const { token, prefs } = req.body as {
        token: string;
        prefs?: {
          budgetAlerts?: boolean;
          weeklySummary?: boolean;
          unusualSpending?: boolean;
        };
      };

      const update: Record<string, unknown> = { expoPushToken: token };

      if (prefs) {
        if (typeof prefs.budgetAlerts === 'boolean') {
          update['pushNotificationPrefs.budgetAlerts'] = prefs.budgetAlerts;
        }
        if (typeof prefs.weeklySummary === 'boolean') {
          update['pushNotificationPrefs.weeklySummary'] = prefs.weeklySummary;
        }
        if (typeof prefs.unusualSpending === 'boolean') {
          update['pushNotificationPrefs.unusualSpending'] = prefs.unusualSpending;
        }
      }

      await UserModel.findByIdAndUpdate(req.userId, { $set: update });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to register push token' });
    }
  }
);

/**
 * DELETE /api/notifications/register
 * Remove the user's Expo push token (opt out of push notifications).
 */
router.delete('/register', async (req: AuthRequest, res: Response) => {
  try {
    await UserModel.findByIdAndUpdate(req.userId, {
      $unset: { expoPushToken: '' },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to unregister push token' });
  }
});

/**
 * PUT /api/notifications/prefs
 * Update notification preferences without changing the token.
 */
router.put(
  '/prefs',
  [
    body('budgetAlerts').optional().isBoolean(),
    body('weeklySummary').optional().isBoolean(),
    body('unusualSpending').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }

    try {
      const { budgetAlerts, weeklySummary, unusualSpending } = req.body as {
        budgetAlerts?: boolean;
        weeklySummary?: boolean;
        unusualSpending?: boolean;
      };

      const update: Record<string, unknown> = {};
      if (typeof budgetAlerts === 'boolean') {
        update['pushNotificationPrefs.budgetAlerts'] = budgetAlerts;
      }
      if (typeof weeklySummary === 'boolean') {
        update['pushNotificationPrefs.weeklySummary'] = weeklySummary;
      }
      if (typeof unusualSpending === 'boolean') {
        update['pushNotificationPrefs.unusualSpending'] = unusualSpending;
      }

      if (Object.keys(update).length === 0) {
        res.status(400).json({ error: 'No valid preferences provided' });
        return;
      }

      await UserModel.findByIdAndUpdate(req.userId, { $set: update });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to update notification preferences' });
    }
  }
);

export default router;
