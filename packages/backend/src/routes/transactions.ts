import { Router } from 'express';
import { z } from 'zod';
import { getRequiredOxyUserId, requireOxyAuth, type OxyAuthRequest as AuthRequest } from '@oxyhq/core/server';
import { validate } from '../middleware/validate';
import { listTransactions } from '../services/transaction.service';

const router = Router();
router.use(requireOxyAuth);

const listSchema = z.object({
  walletId: z.string().optional(),
  currency: z.enum(['FAIR', 'EUR', 'USD']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get('/', validate(listSchema, 'query'), async (req: AuthRequest, res, next) => {
  try {
    const params = req.query as unknown as z.infer<typeof listSchema>;
    const userId = getRequiredOxyUserId(req);
    const page = await listTransactions({ userId, ...params });
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

export default router;
