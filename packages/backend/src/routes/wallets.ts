import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { HttpError } from '../middleware/errorHandler';
import {
  devTopUp,
  getOrCreateWallet,
  getWallet,
  listUserWallets,
  toWalletDto,
} from '../services/wallet.service';

const router = Router();
router.use(authMiddleware);

const currencyEnum = z.enum(['FAIR', 'EUR', 'USD']);

/** List all wallets for the authenticated user. */
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const summary = await listUserWallets(getUserId(req));
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

const createWalletSchema = z.object({ currency: currencyEnum });

/** Create (or fetch) a wallet for the given currency. */
router.post('/', validate(createWalletSchema), async (req: AuthRequest, res, next) => {
  try {
    const { currency } = req.body as z.infer<typeof createWalletSchema>;
    const doc = await getOrCreateWallet(getUserId(req), currency);
    res.json({ success: true, data: toWalletDto(doc) });
  } catch (err) {
    next(err);
  }
});

/** Fetch a single wallet (must belong to the caller). */
router.get('/:walletId', async (req: AuthRequest, res, next) => {
  try {
    const doc = await getWallet(getUserId(req), req.params.walletId);
    res.json({ success: true, data: toWalletDto(doc) });
  } catch (err) {
    next(err);
  }
});

const devTopUpSchema = z.object({ currency: currencyEnum, amount: z.string().min(1) });

/**
 * Dev-only top-up. Disabled outside `NODE_ENV !== 'production'`.
 */
router.post('/dev/top-up', validate(devTopUpSchema), async (req: AuthRequest, res, next) => {
  try {
    const { currency, amount } = req.body as z.infer<typeof devTopUpSchema>;
    const doc = await devTopUp(getUserId(req), currency, amount);
    res.json({ success: true, data: toWalletDto(doc) });
  } catch (err) {
    next(err);
  }
});

function getUserId(req: AuthRequest): string {
  const id = req.user?.id ?? req.user?._id;
  if (!id) throw new HttpError(401, 'unauthorized', 'Missing user');
  return id;
}

export default router;
