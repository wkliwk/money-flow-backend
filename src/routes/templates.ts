import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import TransactionTemplateModel from '../models/TransactionTemplate';
import ExpenseModel from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

const templateValidation = [
  body('name').notEmpty().withMessage('name is required'),
  body('amount').isNumeric().withMessage('amount must be a number'),
  body('frequency')
    .isIn(['weekly', 'biweekly', 'monthly'])
    .withMessage('frequency must be one of: weekly, biweekly, monthly'),
  body('category').optional().isString().withMessage('category must be a string'),
  body('description').optional().isString().withMessage('description must be a string'),
];

// GET /api/templates - list all templates for user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const templates = await TransactionTemplateModel.find({ owner: req.userId }).sort({
      createdAt: -1,
    });
    res.json({ templates });
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/templates - create new template
router.post('/', templateValidation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  try {
    const { name, amount, category, description, frequency } = req.body;

    const template = new TransactionTemplateModel({
      owner: req.userId,
      name,
      amount: parseFloat(amount),
      category,
      description,
      frequency,
    });

    const saved = await template.save();
    res.status(201).json(saved.toObject());
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to create template' });
  }
});

// GET /api/templates/:id - get specific template
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const template = await TransactionTemplateModel.findOne({
      _id: req.params.id,
      owner: req.userId,
    });

    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(template.toObject());
  } catch {
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// PUT /api/templates/:id - update template
router.put('/:id', templateValidation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  try {
    const { name, amount, category, description, frequency } = req.body;

    const updated = await TransactionTemplateModel.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      {
        $set: {
          name,
          amount: parseFloat(amount),
          category,
          description,
          frequency,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(updated.toObject());
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to update template' });
  }
});

// DELETE /api/templates/:id - delete template
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await TransactionTemplateModel.findOneAndDelete({
      _id: req.params.id,
      owner: req.userId,
    });

    if (!deleted) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json({ message: 'Template deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// POST /api/templates/apply/:id - apply single template to create expense
router.post('/apply/:id', async (req: AuthRequest, res: Response) => {
  try {
    const template = await TransactionTemplateModel.findOne({
      _id: req.params.id,
      owner: req.userId,
    });

    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const expense = new ExpenseModel({
      owner: req.userId,
      description: template.name,
      category: template.category,
      amount: template.amount,
      date: new Date(),
    });

    const saved = await expense.save();
    res.status(201).json(saved.toObject());
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to apply template' });
  }
});

// POST /api/templates/apply-multiple - apply multiple templates at once
router.post('/apply-multiple', async (req: AuthRequest, res: Response) => {
  const { templateIds } = req.body;

  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    res.status(400).json({ error: 'templateIds must be a non-empty array' });
    return;
  }

  try {
    const templates = await TransactionTemplateModel.find({
      _id: { $in: templateIds },
      owner: req.userId,
    });

    if (templates.length !== templateIds.length) {
      res.status(404).json({ error: 'Some templates not found or unauthorized' });
      return;
    }

    const expenses = templates.map((template) => ({
      owner: req.userId,
      description: template.name,
      category: template.category,
      amount: template.amount,
      date: new Date(),
    }));

    const created = await ExpenseModel.insertMany(expenses);
    res.status(201).json({ created: created.length, expenses: created });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to apply templates' });
  }
});

export default router;
