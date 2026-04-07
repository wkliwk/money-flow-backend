import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import NetWorthModel from '../models/NetWorth';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

// GET /api/net-worth - get snapshots for past 12 months
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const months = Math.min(parseInt(req.query.months as string) || 12, 24);
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const snapshots = await NetWorthModel.find({
      userId: req.userId,
      date: { $gte: startDate },
    }).sort({ date: 1 });

    res.json(snapshots);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch net worth snapshots';
    res.status(500).json({ error: message });
  }
});

// GET /api/net-worth/latest - get most recent snapshot
router.get('/latest', async (req: AuthRequest, res: Response) => {
  try {
    const snapshot = await NetWorthModel.findOne({ userId: req.userId }).sort({ date: -1 });
    res.json(snapshot || null);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch latest snapshot';
    res.status(500).json({ error: message });
  }
});

// POST /api/net-worth - create/update snapshot for today
const validation = [
  body('assets').optional().isObject(),
  body('liabilities').optional().isObject(),
];

router.post('/', validation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Upsert: find or create snapshot for today
    const snapshot = await NetWorthModel.findOneAndUpdate(
      { userId: req.userId, date: today },
      {
        $set: {
          userId: req.userId,
          assets: req.body.assets || {},
          liabilities: req.body.liabilities || {},
          date: today,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(201).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save net worth snapshot';
    res.status(400).json({ error: message });
  }
});

// PUT /api/net-worth/:snapshotId - update a specific snapshot
router.put('/:snapshotId', validation, async (req: AuthRequest, res: Response) => {
  try {
    const snapshot = await NetWorthModel.findOneAndUpdate(
      { _id: req.params.snapshotId, userId: req.userId },
      {
        $set: {
          assets: req.body.assets,
          liabilities: req.body.liabilities,
        },
      },
      { new: true, runValidators: true }
    );

    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    res.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update snapshot';
    res.status(400).json({ error: message });
  }
});

// DELETE /api/net-worth/:snapshotId
router.delete('/:snapshotId', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await NetWorthModel.findOneAndDelete({
      _id: req.params.snapshotId,
      userId: req.userId,
    });

    if (!deleted) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    res.json({ message: 'Deleted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete snapshot';
    res.status(500).json({ error: message });
  }
});

export default router;
