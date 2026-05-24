import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import AccountModel, { ACCOUNT_TYPES } from '../models/Account';

const router = Router();

router.use(protect);

// GET /api/accounts
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await AccountModel.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch accounts';
    res.status(500).json({ error: message });
  }
});

// POST /api/accounts
router.post(
  '/',
  [
    body('name').notEmpty().withMessage('name is required'),
    body('type')
      .isIn(ACCOUNT_TYPES)
      .withMessage(`type must be one of: ${ACCOUNT_TYPES.join(', ')}`),
    body('startingBalance')
      .optional()
      .isNumeric()
      .withMessage('startingBalance must be a number'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const { name, type, startingBalance } = req.body as {
        name: string;
        type: string;
        startingBalance?: number;
      };
      const account = await AccountModel.create({
        userId: req.userId,
        name,
        type,
        startingBalance: startingBalance ?? 0,
      });
      res.status(201).json({ account });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create account';
      res.status(500).json({ error: message });
    }
  }
);

// PUT /api/accounts/:id
router.put(
  '/:id',
  [
    body('name').optional().notEmpty().withMessage('name cannot be empty'),
    body('type')
      .optional()
      .isIn(ACCOUNT_TYPES)
      .withMessage(`type must be one of: ${ACCOUNT_TYPES.join(', ')}`),
    body('startingBalance')
      .optional()
      .isNumeric()
      .withMessage('startingBalance must be a number'),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const account = await AccountModel.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $set: req.body },
        { new: true }
      );
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }
      res.json({ account });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update account';
      res.status(500).json({ error: message });
    }
  }
);

// DELETE /api/accounts/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const account = await AccountModel.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    await AccountModel.deleteOne({ _id: req.params.id });

    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /api/accounts/:id failed:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
