import { Router, Request, Response } from 'express';
import ExpenseModel from '../models/Expense';

const router = Router();

// GET /api/expenses
router.get('/', async (_req: Request, res: Response) => {
  try {
    const expenses = await ExpenseModel.find().sort({ createdAt: -1 });
    res.json(expenses);
  } catch {
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// POST /api/expenses
router.post('/', async (req: Request, res: Response) => {
  try {
    const expense = new ExpenseModel(req.body);
    const saved = await expense.save();
    res.status(201).json(saved);
  } catch {
    res.status(400).json({ error: 'Failed to create expense' });
  }
});

// PUT /api/expenses/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await ExpenseModel.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!updated) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.json(updated);
  } catch {
    res.status(400).json({ error: 'Failed to update expense' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await ExpenseModel.findByIdAndDelete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
