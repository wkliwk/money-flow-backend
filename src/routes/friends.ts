import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import FriendshipModel from '../models/Friendship';
import UserModel from '../models/User';

const router = Router();
router.use(protect);

// POST /api/friends/request — send friend request by email
router.post(
  '/request',
  body('email').isEmail().withMessage('Valid email required'),
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const email = (req.body.email as string).toLowerCase().trim();

      // Find recipient user
      const recipient = await UserModel.findOne({ email }).lean();
      if (!recipient) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const recipientId = String(recipient._id);

      // Cannot friend yourself
      if (recipientId === req.userId) {
        res.status(400).json({ error: 'Cannot send friend request to yourself' });
        return;
      }

      // Check for existing friendship in either direction
      const existing = await FriendshipModel.findOne({
        $or: [
          { requester: req.userId, recipient: recipientId },
          { requester: recipientId, recipient: req.userId },
        ],
      });

      if (existing) {
        if (existing.status === 'accepted') {
          res.status(409).json({ error: 'Already friends' });
          return;
        }
        if (existing.status === 'pending') {
          res.status(409).json({ error: 'Friend request already pending' });
          return;
        }
        // If rejected, allow re-request by updating
        existing.status = 'pending';
        existing.requester = req.userId!;
        existing.recipient = recipientId;
        await existing.save();
        res.status(201).json({ id: existing._id, status: 'pending', email });
        return;
      }

      const friendship = await FriendshipModel.create({
        requester: req.userId,
        recipient: recipientId,
        status: 'pending',
      });

      res.status(201).json({ id: friendship._id, status: 'pending', email });
    } catch (err) {
      console.error('friends.ts:1 failed:', err);
      res.status(500).json({ error: 'Failed to send friend request' });
    }
  }
);

// GET /api/friends — list accepted friends
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const friendships = await FriendshipModel.find({
      $or: [{ requester: req.userId }, { recipient: req.userId }],
      status: 'accepted',
    }).lean();

    const friendIds = friendships.map((f) =>
      f.requester === req.userId ? f.recipient : f.requester
    );

    const users = await UserModel.find({ _id: { $in: friendIds } })
      .select('email')
      .lean();

    const friends = friendships.map((f) => {
      const friendId = f.requester === req.userId ? f.recipient : f.requester;
      const user = users.find((u) => String(u._id) === friendId);
      return { id: String(f._id), email: user?.email || 'unknown', since: f.createdAt };
    });

    res.json({ friends });
  } catch (err) {
    console.error('friends.ts:2 failed:', err);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// GET /api/friends/pending — list incoming pending requests
router.get('/pending', async (req: AuthRequest, res: Response) => {
  try {
    const pending = await FriendshipModel.find({
      recipient: req.userId,
      status: 'pending',
    }).lean();

    const requesterIds = pending.map((p) => p.requester);
    const users = await UserModel.find({ _id: { $in: requesterIds } })
      .select('email')
      .lean();

    const requests = pending.map((p) => {
      const user = users.find((u) => String(u._id) === p.requester);
      return { id: String(p._id), email: user?.email || 'unknown', createdAt: p.createdAt };
    });

    res.json({ requests });
  } catch (err) {
    console.error('friends.ts:3 failed:', err);
    res.status(500).json({ error: 'Failed to fetch pending requests' });
  }
});

// POST /api/friends/:id/accept
router.post('/:id/accept', async (req: AuthRequest, res: Response) => {
  try {
    const friendship = await FriendshipModel.findOne({
      _id: req.params.id,
      recipient: req.userId,
      status: 'pending',
    });

    if (!friendship) {
      res.status(404).json({ error: 'Pending request not found' });
      return;
    }

    friendship.status = 'accepted';
    await friendship.save();
    res.json({ status: 'accepted' });
  } catch (err) {
    console.error('friends.ts:4 failed:', err);
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// POST /api/friends/:id/reject
router.post('/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const friendship = await FriendshipModel.findOne({
      _id: req.params.id,
      recipient: req.userId,
      status: 'pending',
    });

    if (!friendship) {
      res.status(404).json({ error: 'Pending request not found' });
      return;
    }

    await friendship.deleteOne();
    res.json({ status: 'removed' });
  } catch (err) {
    console.error('friends.ts:5 failed:', err);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// DELETE /api/friends/:id — unfriend
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const friendship = await FriendshipModel.findOne({
      _id: req.params.id,
      $or: [{ requester: req.userId }, { recipient: req.userId }],
      status: 'accepted',
    });

    if (!friendship) {
      res.status(404).json({ error: 'Friendship not found' });
      return;
    }

    await friendship.deleteOne();
    res.json({ status: 'removed' });
  } catch (err) {
    console.error('friends.ts:6 failed:', err);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

export default router;
