import { Router } from 'express';
import { z } from 'zod';
import { getRequiredOxyUserId, requireOxyAuth, type OxyAuthRequest as AuthRequest } from '@oxyhq/core/server';
import { validate } from '../middleware/validate';
import { getDepositAddress, estimateWithdrawalFee, isLive } from '../services/faircoin.service';

const router = Router();
router.use(requireOxyAuth);

router.get('/deposit-address', async (req: AuthRequest, res, next) => {
  try {
    const userId = getRequiredOxyUserId(req);
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
