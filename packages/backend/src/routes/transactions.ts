import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { HttpError } from '../middleware/errorHandler';
import { listTransactions } from '../services/transaction.service';

const router = Router();
router.use(authMiddleware);

const listSchema = z.object({
  walletId: z.string().optional(),
  currency: z.enum(['FAIR', 'EUR', 'USD']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get('/', validate(listSchema, 'query'), async (req: AuthRequest, res, next) => {
  try {
    const params = req.query as unknown as z.infer<typeof listSchema>;
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const page = await listTransactions({ userId, ...params });
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

export default router;
