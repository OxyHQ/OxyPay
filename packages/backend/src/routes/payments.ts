import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { HttpError } from '../middleware/errorHandler';
import {
  getPayment,
  payInvoice,
  toPaymentDto,
  transfer,
} from '../services/payment.service';

const router = Router();
router.use(authMiddleware);

const moneySchema = z.object({
  amount: z.string().regex(/^\d+$/),
  currency: z.enum(['FAIR', 'EUR', 'USD']),
});

const payInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  method: z.enum(['oxy_balance', 'faircoin', 'card']),
});

router.post('/pay-invoice', validate(payInvoiceSchema), async (req: AuthRequest, res, next) => {
  try {
    const { invoiceId, method } = req.body as z.infer<typeof payInvoiceSchema>;
    const payerId = req.user?.id ?? req.user?._id;
    if (!payerId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const doc = await payInvoice({ payerId, invoiceId, method });
    res.status(201).json({ success: true, data: toPaymentDto(doc) });
  } catch (err) {
    next(err);
  }
});

const transferSchema = z.object({
  toUserId: z.string().min(1),
  amount: moneySchema,
  note: z.string().max(280).optional(),
});

router.post('/transfer', validate(transferSchema), async (req: AuthRequest, res, next) => {
  try {
    const body = req.body as z.infer<typeof transferSchema>;
    const fromUserId = req.user?.id ?? req.user?._id;
    if (!fromUserId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const doc = await transfer({ fromUserId, ...body });
    res.status(201).json({ success: true, data: toPaymentDto(doc) });
  } catch (err) {
    next(err);
  }
});

router.get('/:paymentId', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const doc = await getPayment(req.params.paymentId, userId);
    res.json({ success: true, data: toPaymentDto(doc) });
  } catch (err) {
    next(err);
  }
});

export default router;
