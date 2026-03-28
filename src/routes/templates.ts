import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import Template from '../models/Template';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

const validation = [
  body('label').notEmpty().withMessage('label is required'),
  body('category').notEmpty().withMessage('category is required'),
  body('type').optional().isIn(['income', 'expense']),
  body('defaultAmount').optional().isNumeric().withMessage('defaultAmount must be a number'),
];

// GET /api/templates
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const items = await Template.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    res.json(items.map((i) => ({ ...i, id: i._id })));
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/templates
router.post('/', validation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }
  try {
    const { label, item, description, type, category, defaultAmount } = req.body;
    const doc = await Template.create({
      userId: req.userId,
      label,
      item,
      description: description || '',
      type: type || 'expense',
      category,
      defaultAmount: defaultAmount !== undefined ? parseFloat(defaultAmount) : undefined,
    });
    const obj = doc.toObject();
    res.status(201).json({ ...obj, id: obj._id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create template';
    res.status(400).json({ error: message });
  }
});

// DELETE /api/templates/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await Template.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
