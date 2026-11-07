import express from 'express';
import {
  ONLINE_PAYMENTS_ENABLED,
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from '../services/paymentService.js';

const router = express.Router();

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
