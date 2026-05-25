import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import ContactModel from '../models/Contact';

const router = Router();
router.use(protect);

const validation = [
  body('name')
    .isString()
    .withMessage('name must be a string')
    .trim()
    .notEmpty()
    .withMessage('name is required')
    .isLength({ max: 80 })
    .withMessage('name must be at most 80 characters'),
  body('email')
    .optional({ nullable: true })
    .isString()
    .withMessage('email must be a string')
    .trim()
    .isEmail()
    .withMessage('email must be a valid address')
    .isLength({ max: 200 })
    .withMessage('email must be at most 200 characters'),
  body('color')
    .optional({ nullable: true })
    .isString()
    .withMessage('color must be a string')
    .isLength({ max: 16 })
    .withMessage('color must be at most 16 characters'),
];

// GET /api/contacts — list owner's contacts, newest first
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const contacts = await ContactModel.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ contacts });
  } catch (err) {
    console.error('contacts.ts:list failed:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /api/contacts — create a new contact
router.post('/', validation, async (req: AuthRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }
  try {
    const contact = await ContactModel.create({
      userId: req.userId,
      name: req.body.name,
      email: req.body.email,
      color: req.body.color,
    });
    res.status(201).json({ contact });
  } catch (err) {
    console.error('contacts.ts:create failed:', err);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

// PATCH /api/contacts/:id — update name/email/color
router.patch(
  '/:id',
  [
    body('name')
      .optional()
      .isString().trim().notEmpty().isLength({ max: 80 })
      .withMessage('name must be a non-empty string up to 80 characters'),
    body('email')
      .optional({ nullable: true })
      .isString().trim().isEmail().isLength({ max: 200 })
      .withMessage('email must be a valid address'),
    body('color')
      .optional({ nullable: true })
      .isString().isLength({ max: 16 })
      .withMessage('color must be at most 16 characters'),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: errors.array()[0].msg });
      return;
    }
    try {
      const $set: Record<string, unknown> = {};
      const $unset: Record<string, unknown> = {};
      if (typeof req.body.name === 'string') $set.name = req.body.name;
      if (typeof req.body.email === 'string') $set.email = req.body.email;
      else if (req.body.email === null) $unset.email = '';
      if (typeof req.body.color === 'string') $set.color = req.body.color;
      else if (req.body.color === null) $unset.color = '';

      const update: Record<string, unknown> = {};
      if (Object.keys($set).length) update.$set = $set;
      if (Object.keys($unset).length) update.$unset = $unset;

      const contact = await ContactModel.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        update,
        { new: true, runValidators: true }
      );
      if (!contact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }
      res.json({ contact });
    } catch (err) {
      console.error('contacts.ts:update failed:', err);
      res.status(500).json({ error: 'Failed to update contact' });
    }
  }
);

// DELETE /api/contacts/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const deleted = await ContactModel.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!deleted) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('contacts.ts:delete failed:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

export default router;
