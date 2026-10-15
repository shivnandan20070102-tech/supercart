import express from 'express';
import { signupUser, loginUser, getUserProfile, forgotPassword } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import { forgotPasswordLimiter, loginLimiter, signupLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Brute-force / spam protection (per-IP):
// login 5/15min, signup 3/hour, forgot-password 3/hour.
router.post('/signup', signupLimiter, signupUser);
router.post('/register', signupLimiter, signupUser); // alias
router.post('/login', loginLimiter, loginUser);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/forgot_password', forgotPasswordLimiter, forgotPassword); // alias
router.get('/profile', protect, getUserProfile);

export default router;
