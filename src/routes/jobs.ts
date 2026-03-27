import { Router, Request, Response } from 'express';
import { monthlySummaryJob } from '../jobs/monthlySummary';

const router = Router();

function requireApiKey(req: Request, res: Response): boolean {
  const apiKey = process.env.JOBS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Jobs API key not configured' });
    return false;
  }
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// POST /api/jobs/monthly-summary
// Protected by X-Api-Key header matching JOBS_API_KEY env var.
// Returns count of summaries sent.
router.post('/monthly-summary', async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  const start = Date.now();
  try {
    await monthlySummaryJob();
    res.json({ ok: true, durationMs: Date.now() - start });
  } catch (error) {
    console.error('[POST /api/jobs/monthly-summary] Error:', error);
    res.status(500).json({ error: 'Job failed' });
  }
});

export default router;
