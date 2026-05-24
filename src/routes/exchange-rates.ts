import { Router, Response } from 'express';
import { protect, AuthRequest } from '../middleware/auth';
import { getExchangeRates } from '../utils/exchangeRates';

const router = Router();

router.use(protect);

// GET /api/exchange-rates?base=USD
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const base = ((req.query.base as string) || 'USD').toUpperCase();
    const data = await getExchangeRates(base);
    res.json(data);
  } catch (err) {
    console.error('exchange-rates.ts:1 failed:', err);
    res.status(500).json({ error: 'Failed to fetch exchange rates' });
  }
});

export default router;
