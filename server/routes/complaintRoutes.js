import express from 'express';
import { getMyComplaints, submitComplaint } from '../controllers/complaintController.js';
import { protect } from '../middleware/authMiddleware.js';
import { adminLooseLimiter, complaintLimiter, generalLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Complaint submit: 5/hour/User (spam roko). `protect` PEHLE taaki limiter
// ko req.user.id mile (per-user bucket); bina token ke IP fallback.
router.post('/', protect, complaintLimiter, submitComplaint);

// Apni list: normal read — general loose limit.
router.get('/mine', protect, generalLimiter, getMyComplaints);

// Admin: saari complaints review (trusted -> loose limit).
// NOTE: list/filter Supabase Realtime se hota hai; ye endpoint future use.
router.get('/', protect, adminLooseLimiter, getMyComplaints);

export default router;
