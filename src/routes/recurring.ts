import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import RecurringExpenseModel from '../models/RecurringExpense';
import { protect, AuthRequest } from '../middleware/auth';
import { validateRecurringData } from '../utils/recurring';

const router = Router();

router.use(protect);

const recurringValidation = [
  body('name').notEmpty().withMessage('name is required'),
  body('amount').isNumeric().withMessage('amount must be a number'),
  body('start_date').isISO8601().withMessage('start_date must be a valid date'),
  body('end_date').optional().isISO8601().withMessage('end_date must be a valid date'),
  body('frequency')
    .isIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'])
    .withMessage('frequency must be one of: DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY'),
];

// GET /api/recurring - list all recurring expenses for user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const recurring = await RecurringExpenseModel.find({ userId: req.userId }).sort({
      start_date: 1,
    });
    res.json({ recurring });
  } catch {
    res.status(500).json({ error: 'Failed to fetch recurring expenses' });
  }
});

// POST /api/recurring - create new recurring expense
router.post('/', recurringValidation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  try {
    const { name, amount, category, start_date, end_date, frequency, description } = req.body;

    // Additional validation
    const validation = validateRecurringData({
      name,
      amount,
      start_date,
      end_date,
      frequency,
    });

    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0] });
      return;
    }

    const recurring = new RecurringExpenseModel({
      userId: req.userId,
      name,
      amount: parseFloat(amount),
      category,
      start_date: new Date(start_date),
      end_date: end_date ? new Date(end_date) : undefined,
      frequency,
      description,
    });

    const saved = await recurring.save();
    res.status(201).json(saved.toObject());
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to create recurring expense' });
  }
});

// GET /api/recurring/:id - get specific recurring expense
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const recurring = await RecurringExpenseModel.findOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!recurring) {
      res.status(404).json({ error: 'Recurring expense not found' });
      return;
    }

    res.json(recurring.toObject());
  } catch {
    res.status(500).json({ error: 'Failed to fetch recurring expense' });
  }
});

// PUT /api/recurring/:id - update recurring expense
router.put('/:id', recurringValidation, async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return;
  }

  try {
    const { name, amount, category, start_date, end_date, frequency, description } = req.body;

    const validation = validateRecurringData({
      name,
      amount,
      start_date,
      end_date,
      frequency,
    });

    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0] });
      return;
    }

    const updated = await RecurringExpenseModel.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      {
        $set: {
          name,
          amount: parseFloat(amount),
          category,
          start_date: new Date(start_date),
          end_date: end_date ? new Date(end_date) : undefined,
          frequency,
          description,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      res.status(404).json({ error: 'Recurring expense not found' });
      return;
    }

    res.json(updated.toObject());
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to update recurring expense' });
  }
});

// DELETE /api/recurring/:id - delete recurring expense
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await RecurringExpenseModel.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!deleted) {
      res.status(404).json({ error: 'Recurring expense not found' });
      return;
    }

    res.json({ message: 'Recurring expense deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete recurring expense' });
  }
});

export default router;
