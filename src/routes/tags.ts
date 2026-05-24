import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { protect, AuthRequest } from '../middleware/auth';
import TagModel from '../models/Tag';
import ExpenseModel from '../models/Expense';

const router = Router();

router.use(protect);

const MAX_TAGS_PER_USER = 50;

const nameValidation = body('name')
  .isString()
  .trim()
  .notEmpty()
  .withMessage('name is required')
  .isLength({ max: 50 })
  .withMessage('name must be at most 50 characters');

const colorValidation = body('color')
  .optional()
  .matches(/^#[0-9A-Fa-f]{6}$/)
  .withMessage('color must be a valid hex color (e.g. #ff0000)');

// GET /api/tags — list all tags for the authenticated user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const tags = await TagModel.find({ owner: req.userId }).sort({ name: 1 }).lean();
    res.json(tags);
  } catch (err) {
    console.error('tags.ts:1 failed:', err);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// POST /api/tags — create a new tag
router.post('/', [nameValidation, colorValidation], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  try {
    // Enforce max 50 tags per user
    const count = await TagModel.countDocuments({ owner: req.userId });
    if (count >= MAX_TAGS_PER_USER) {
      res.status(400).json({ error: `Maximum of ${MAX_TAGS_PER_USER} tags allowed per user` });
      return;
    }

    const name = (req.body.name as string).trim();
    const color: string = req.body.color || '#6366f1';

    // Enforce case-insensitive uniqueness per user
    const existing = await TagModel.findOne({
      owner: req.userId,
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    }).lean();
    if (existing) {
      res.status(409).json({ error: 'A tag with this name already exists' });
      return;
    }

    const tag = await TagModel.create({ name, color, owner: req.userId });
    res.status(201).json(tag);
  } catch (err) {
    console.error('tags.ts:2 failed:', err);
    res.status(400).json({ error: 'Failed to create tag' });
  }
});

// PUT /api/tags/:id — update tag name/color
router.put('/:id', [nameValidation, colorValidation], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    const tag = await TagModel.findOne({ _id: req.params.id, owner: req.userId });
    if (!tag) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    const name = (req.body.name as string).trim();

    // Enforce case-insensitive uniqueness per user (exclude self)
    const duplicate = await TagModel.findOne({
      owner: req.userId,
      _id: { $ne: tag._id },
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    }).lean();
    if (duplicate) {
      res.status(409).json({ error: 'A tag with this name already exists' });
      return;
    }

    tag.name = name;
    if (req.body.color !== undefined) {
      tag.color = req.body.color as string;
    }
    await tag.save();
    res.json(tag.toObject());
  } catch (err) {
    console.error('tags.ts:3 failed:', err);
    res.status(400).json({ error: 'Failed to update tag' });
  }
});

// DELETE /api/tags/:id — delete tag and remove from all transactions
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    const tag = await TagModel.findOne({ _id: req.params.id, owner: req.userId });
    if (!tag) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    const tagId = tag._id as mongoose.Types.ObjectId;
    await tag.deleteOne();

    // Remove tag from all expenses that reference it
    await ExpenseModel.updateMany(
      { owner: req.userId, tags: tagId },
      { $pull: { tags: tagId } }
    );

    res.json({ message: 'Tag deleted' });
  } catch (err) {
    console.error('tags.ts:4 failed:', err);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

export default router;
