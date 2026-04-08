import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import { parseTransactionText } from '../utils/parseTransactionText';

const router = Router();

router.use(protect);

router.post(
  '/parse-text',
  [
    body('text')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('text is required')
      .isLength({ max: 500 })
      .withMessage('text must be at most 500 characters'),
    body('locale')
      .optional()
      .isString()
      .isLength({ max: 10 })
      .withMessage('locale must be at most 10 characters'),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { text, locale } = req.body as { text: string; locale?: string };

    try {
      const parsed = await parseTransactionText(text, locale);
      res.json(parsed);
    } catch {
      res.status(500).json({ error: 'Failed to parse transaction text' });
    }
  },
);

export default router;
