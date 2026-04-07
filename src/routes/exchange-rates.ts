import { Router, Response } from 'express';
import { protect, AuthRequest } from '../middleware/auth';
import { getExchangeRates } from '../utils/exchangeRates';

const router = Router();

router.use(protect);

// GET /api/exchange-rates
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await getExchangeRates();
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch exchange rates';
    res.status(500).json({ error: message });
  }
});

export default router;
