import express from 'express';
import {
  assignDeliveryPartner,
  createOrder,
  getMyOrders,
  getOrderById,
  getPendingAssignments,
  markOrderPacked,
  retryPendingAssignments,
  deliverOrderWithOtp,
  transitionDeliveryStatus,
  cancelOrder,
  acceptOrderDelivery,
  rejectOrderDelivery,
  reportDeliveryIssue,
  submitOrderReview,
  getRefundOrderList,
  markOrderRefunded,
  getReviewsList,
  advanceOrderStep,
  collectCashPayment,
  verifyOrderOtp,
  getCustomerOtp,
  adminOverrideDeliver,
} from '../controllers/orderController.js';
import { protect } from '../middleware/authMiddleware.js';
import { adminLooseLimiter, generalLimiter, orderLimiter } from '../middleware/rateLimit.js';
import {
  getOrderInvoice,
  sendInvoiceEmailEndpoint,
  updateOrderStatus,
} from '../controllers/invoiceController.js';

const router = express.Router();

// Order place: 10/hour/User (bot spam roko, genuine user safe).
// `protect` PEHLE taaki limiter ko req.user.id mile (per-user bucket).
router.route('/').post(protect, orderLimiter, createOrder);
// NOTE: specific routes hamesha '/:id' se PEHLE rakho, warna 'pending' id samjha jayega
// Admin/monitoring + Store-Manager pack: trusted users -> loose limit.
router.route('/pending/list').get(protect, adminLooseLimiter, getPendingAssignments);
router.route('/retry-assign').post(protect, adminLooseLimiter, retryPendingAssignments);
router.route('/myorders').get(protect, generalLimiter, getMyOrders);
// Invoice PDF: har order ka UNIQUE receipt (owner / admin / store_manager / partner).
router.route('/:id/invoice').get(protect, generalLimiter, getOrderInvoice);
// Delivered par invoice email: backend status update + manual resend/test.
router.route('/:id/status').put(protect, adminLooseLimiter, updateOrderStatus);
router.route('/:id/deliver').post(protect, adminLooseLimiter, deliverOrderWithOtp);
router.route('/:id/delivery-status').post(protect, adminLooseLimiter, transitionDeliveryStatus);
// Delivery partner: accept / reject assigned order (server-side RPC, SECURITY DEFINER)
router.route('/:id/accept').post(protect, adminLooseLimiter, acceptOrderDelivery);
router.route('/:id/reject').post(protect, adminLooseLimiter, rejectOrderDelivery);
router.route('/:id/send-invoice-email').post(protect, adminLooseLimiter, sendInvoiceEmailEndpoint);
// Admin: cancelled / return_refund orders + reviews (specific paths BEFORE generic /:id)
router.route('/admin/refunds').get(protect, adminLooseLimiter, getRefundOrderList);
router.route('/admin/reviews').get(protect, adminLooseLimiter, getReviewsList);
// Customer cancel (own order, before packed)
router.route('/:id/cancel').post(protect, generalLimiter, cancelOrder);
// Delivery partner: report issue (return/refund)
router.route('/:id/delivery-issue').post(protect, generalLimiter, reportDeliveryIssue);
// Delivery partner: submit review (after delivered, once)
router.route('/:id/review').post(protect, generalLimiter, submitOrderReview);
// Admin: mark order as refunded (only pending)
router.route('/:id/mark-refunded').patch(protect, adminLooseLimiter, markOrderRefunded);
// Admin manual override (auto-assign ke bawajood partner change)
router.route('/:id/assign').put(protect, adminLooseLimiter, assignDeliveryPartner);
// Store Manager: packed mark + turant auto-assign
router.route('/:id/pack').put(protect, adminLooseLimiter, markOrderPacked);
// Part A: Delivery step flow (forward-only) — assigned partner
router.route('/:id/advance-step').post(protect, adminLooseLimiter, advanceOrderStep);
// Part A: Partner confirms cash collected (amount from server total)
router.route('/:id/collect-payment').post(protect, adminLooseLimiter, collectCashPayment);
// Part A: Partner verifies customer OTP (5-attempt lock)
router.route('/:id/verify-otp').post(protect, adminLooseLimiter, verifyOrderOtp);
// Part A: Customer/admin fetch OTP (only when out for delivery)
router.route('/:id/otp').get(protect, generalLimiter, getCustomerOtp);
// Part A: Admin override deliver without OTP (reason mandatory + audit)
router.route('/:id/admin-deliver-override').post(protect, adminLooseLimiter, adminOverrideDeliver);
router.route('/:id').get(protect, generalLimiter, getOrderById);

export default router;
