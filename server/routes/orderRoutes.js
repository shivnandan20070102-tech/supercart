import express from 'express';
import {
  assignDeliveryPartner,
  createOrder,
  getMyOrders,
  getOrderById,
  getPendingAssignments,
  markOrderPacked,
  retryPendingAssignments,
} from '../controllers/orderController.js';
import { protect } from '../middleware/authMiddleware.js';
import { adminLooseLimiter, generalLimiter, orderLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Order place: 10/hour/User (bot spam roko, genuine user safe).
// `protect` PEHLE taaki limiter ko req.user.id mile (per-user bucket).
router.route('/').post(protect, orderLimiter, createOrder);
// NOTE: specific routes hamesha '/:id' se PEHLE rakho, warna 'pending' id samjha jayega
// Admin/monitoring + Store-Manager pack: trusted users -> loose limit.
router.route('/pending/list').get(protect, adminLooseLimiter, getPendingAssignments);
router.route('/retry-assign').post(protect, adminLooseLimiter, retryPendingAssignments);
router.route('/myorders').get(protect, generalLimiter, getMyOrders);
// Admin manual override (auto-assign ke bawajood partner change)
router.route('/:id/assign').put(protect, adminLooseLimiter, assignDeliveryPartner);
// Store Manager: packed mark + turant auto-assign
router.route('/:id/pack').put(protect, adminLooseLimiter, markOrderPacked);
router.route('/:id').get(protect, generalLimiter, getOrderById);

export default router;
