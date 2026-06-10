import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { HttpError } from '../middleware/errorHandler';
import { getDepositAddress, estimateWithdrawalFee, isLive } from '../services/faircoin.service';

const router = Router();
router.use(authMiddleware);

router.get('/deposit-address', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const addr = await getDepositAddress(userId);
    res.json({ success: true, data: { ...addr, live: isLive() } });
  } catch (err) {
    next(err);
  }
});

const estimateSchema = z.object({ amountFair: z.string().regex(/^\d+$/) });

router.post('/estimate-fee', validate(estimateSchema), async (req, res, next) => {
  try {
    const { amountFair } = req.body as z.infer<typeof estimateSchema>;
    const fee = await estimateWithdrawalFee(amountFair);
    res.json({ success: true, data: { fee, currency: 'FAIR', live: isLive() } });
  } catch (err) {
    next(err);
  }
});

export default router;
