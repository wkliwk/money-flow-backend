import { Router, Request, Response } from 'express';

const router = Router();

const gone = (_req: Request, res: Response) => {
  res.status(410).json({ message: 'Friends API deprecated. Use /api/contacts instead.' });
};

router.get('/', gone);
router.get('/pending', gone);
router.post('/request', gone);
router.post('/:id/accept', gone);
router.post('/:id/reject', gone);
router.delete('/:id', gone);

export default router;
