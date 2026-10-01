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

const router = express.Router();

router.route('/').post(protect, createOrder);
// NOTE: specific routes hamesha '/:id' se PEHLE rakho, warna 'pending' id samjha jayega
router.route('/pending/list').get(protect, getPendingAssignments);
router.route('/retry-assign').post(protect, retryPendingAssignments);
router.route('/myorders').get(protect, getMyOrders);
// Admin manual override (auto-assign ke bawajood partner change)
router.route('/:id/assign').put(protect, assignDeliveryPartner);
// Store Manager: packed mark + turant auto-assign
router.route('/:id/pack').put(protect, markOrderPacked);
router.route('/:id').get(protect, getOrderById);

export default router;
