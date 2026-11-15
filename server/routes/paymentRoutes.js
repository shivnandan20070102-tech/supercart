import express from 'express';
import {
  ONLINE_PAYMENTS_ENABLED,
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from '../services/paymentService.js';
import { createOrder, verifyPayment } from '../controllers/paymentController.js';
import { protect } from '../middleware/authMiddleware.js';
import { generalLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Online payment flow (create-order / verify are authenticated — sirf
// authorized user hi apne order ka payment state badal sake).
router.post('/create-order', protect, generalLimiter, createOrder);
router.post('/verify', protect, generalLimiter, verifyPayment);
// Webhook gateway se aata hai (server-to-server) — public, par raw JSON body
// (HMAC signature ke liye) zaroori hai. Ye route server.js me global
// express.json() se PEHLE register hota hai (express.raw ke saath).

// Public payment configuration — client checkout isi se decide karta hai ki
// online methods enabled hain ya nahi (single source of truth = server env).
// Server par payment_method validation alag ho bhi karti hai (createOrder).
router.get('/config', (req, res) => {
  res.status(200).json({
    success: true,
    online_payments_enabled: ONLINE_PAYMENTS_ENABLED,
    methods: [
      { key: 'cod', label: PAYMENT_METHOD_LABELS.cash_on_delivery, online: false },
      ...ONLINE_PAYMENT_METHODS.map((m) => ({
        key: m,
        label: PAYMENT_METHOD_LABELS[m] || m,
        online: true,
      })),
    ],
  });
});

export default router;
