import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { HttpError } from '../middleware/errorHandler';
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  listMerchantInvoices,
  toInvoiceDto,
} from '../services/invoice.service';

const router = Router();
router.use(authMiddleware);

const moneySchema = z.object({
  amount: z.string().regex(/^\d+$/, 'Amount must be a non-negative integer string in base units'),
  currency: z.enum(['FAIR', 'EUR', 'USD']),
});

const lineItemSchema = z.object({
  name: z.string().min(1).max(140),
  description: z.string().max(500).optional(),
  price: moneySchema,
  quantity: z.number().int().min(1).optional(),
  type: z.enum(['product', 'subscription', 'service', 'fee']).optional(),
});

const createSchema = z.object({
  customerId: z.string().optional(),
  amount: moneySchema,
  items: z.array(lineItemSchema).max(50).optional(),
  description: z.string().max(500).optional(),
  appId: z.string().optional(),
  idempotencyKey: z.string().max(140).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
  expiresInSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
});

router.post('/', validate(createSchema), async (req: AuthRequest, res, next) => {
  try {
    const body = req.body as z.infer<typeof createSchema>;
    const merchantId = req.user?.id ?? req.user?._id;
    if (!merchantId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const doc = await createInvoice({ merchantId, ...body });
    res.status(201).json({ success: true, data: toInvoiceDto(doc) });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const merchantId = req.user?.id ?? req.user?._id;
    if (!merchantId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const items = await listMerchantInvoices(merchantId);
    res.json({ success: true, data: { items } });
  } catch (err) {
    next(err);
  }
});

router.get('/:invoiceId', async (req: AuthRequest, res, next) => {
  try {
    const doc = await getInvoice(req.params.invoiceId);
    const userId = req.user?.id ?? req.user?._id;
    if (doc.merchantId !== userId && doc.customerId && doc.customerId !== userId) {
      // Allow open invoices to be fetched by any signed-in user (they may pay).
      if (doc.status !== 'open' || doc.customerId) {
        throw new HttpError(403, 'forbidden', 'Not your invoice');
      }
    }
    res.json({ success: true, data: toInvoiceDto(doc) });
  } catch (err) {
    next(err);
  }
});

router.post('/:invoiceId/cancel', async (req: AuthRequest, res, next) => {
  try {
    const merchantId = req.user?.id ?? req.user?._id;
    if (!merchantId) throw new HttpError(401, 'unauthorized', 'Missing user');
    const doc = await cancelInvoice(req.params.invoiceId, merchantId);
    res.json({ success: true, data: toInvoiceDto(doc) });
  } catch (err) {
    next(err);
  }
});

export default router;
