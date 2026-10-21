import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import complaintRoutes from './routes/complaintRoutes.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import { optionalAuth, protect } from './middleware/authMiddleware.js';
import {
  adminLooseLimiter,
  complaintLimiter,
  forgotPasswordLimiter,
  generalLimiter,
  loginLimiter,
  orderLimiter,
  signupLimiter,
} from './middleware/rateLimit.js';
import { startPendingAssignmentWorker } from './jobs/pendingAssignmentWorker.js';
import { getProducts, getProductById } from './controllers/productController.js';
import { forgotPassword, loginUser, signupUser } from './controllers/authController.js';
import { submitComplaint } from './controllers/complaintController.js';
import { createOrder, getOrders, getMyOrders, getOrderById, assignDeliveryPartner, markOrderPacked } from './controllers/orderController.js';
import { getOrderInvoice, sendInvoiceEmailEndpoint, updateOrderStatus } from './controllers/invoiceController.js';
import { getJwtSecret } from './config/jwt.js';

dotenv.config();
getJwtSecret();

const app = express();

// Render (proxy) ke peeche sahi client IP ke liye zaroori — bina iske
// saare users ek hi IP (proxy) se gine jayenge. 1 = pehla trusted proxy.
app.set('trust proxy', 1);

// Body Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — Live Vercel frontend + local dev explicitly allowed.
// Pehle bare `cors()` (wildcard *) tha, isliye browser origin block nahi
// hota tha; phir bhi explicit allowlist rakhte hain taaki future me koi
// galat domain API hit na kare aur preflight hamesha clean 200 de.
// Extra domain chahiye to Render env me: CORS_ALLOWED_ORIGINS=https://a.com,https://b.com
const CORS_DEFAULT_ORIGINS = [
  'https://supercart-iota.vercel.app', // Live Vercel frontend
  'http://localhost:5173', // Vite dev
  'http://localhost:3000', // CRA/alt dev
  'http://localhost:5000', // local backend self-check
];
const CORS_ENV_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Vercel preview deployments (supercart-*.vercel.app) bhi allow — exact
// production domain upar list me hai, ye sirf preview/test builds ke liye.
const CORS_PREVIEW_PATTERN = /\.vercel\.app$/;
const corsOptions = {
  origin: (origin, callback) => {
    // Origin header nahi (curl, mobile apps, server-to-server) — allow.
    if (!origin) return callback(null, true);
    const list = CORS_ENV_ORIGINS.length > 0 ? CORS_ENV_ORIGINS : CORS_DEFAULT_ORIGINS;
    if (list.includes(origin) || CORS_PREVIEW_PATTERN.test(origin)) return callback(null, true);
    // Unknown browser origin — crash nahi, bas CORS headers mat do (browser khud block karega).
    console.warn(`⚠️ CORS blocked origin: ${origin}`);
    return callback(null, false);
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // Kuch purane webviews 204 preflight par atakte hain — 200 safest hai.
  optionsSuccessStatus: 200,
  maxAge: 86400, // preflight 24h cache — har POST se pehle OPTIONS nahi ghumega
};
app.use(cors(corsOptions));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Root Route — Render par "/" kholne par 404 na aaye isliye.
// Ye sirf API info deta hai, koi feature/logic change nahi karta.
// Asli website (User/Admin/Delivery/Store panel) client/ frontend se chalti hai.
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'SuperCart API is running 🚀 — frontend ke liye /api/health check karo',
    health: '/api/health',
    docs: ['/api/health', '/products', '/api/products', '/api/auth/login', '/api/orders/myorders'],
    timestamp: new Date().toISOString(),
  });
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'SuperCart Backend is live with Supabase Cloud Integration 🚀',
    supabase_connected: true,
    timestamp: new Date().toISOString(),
  });
});

// Direct Top-Level APIs (legacy aliases — SAME rate limits as /api/*)
// Products/browse: 100 req/min/IP (loose — normal use affect na ho).
app.get('/products', generalLimiter, getProducts);
app.get('/products/:id', generalLimiter, getProductById);
// Auth: login 5/15min, signup 3/hour, forgot 3/hour (per-IP brute-force guard).
app.post('/login', loginLimiter, loginUser);
app.post('/signup', signupLimiter, signupUser);
app.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
// Order place: 10/hour/User. optionalAuth PEHLE taaki logged-in user ka
// per-USER bucket bane (guest/bina-token par IP fallback — bot bhi ruke).
app.post('/orders', optionalAuth, orderLimiter, createOrder);
// Complaints alias: 5/hour/User.
app.post('/complaints', protect, complaintLimiter, submitComplaint);
// Alias for old frontend (frontend calls /orders/myorders, new standard is /api/orders/myorders)
// SECURITY FIX: protect lagaya taaki bina login koi ?userId se dusre ka data na dekhe
app.get('/orders/myorders', protect, generalLimiter, getMyOrders);
app.get('/orders/:id', protect, generalLimiter, getOrderById);
// Alias: admin manual override (PUT /api/orders/:id/assign) — trusted -> loose
app.put('/orders/:id/assign', protect, adminLooseLimiter, assignDeliveryPartner);
// Alias: store manager pack (PUT /api/orders/:id/pack) — trusted -> loose
app.put('/orders/:id/pack', protect, adminLooseLimiter, markOrderPacked);
// Alias: invoice PDF + delivered-status email (purana frontend /orders/* par ho to bhi chale)
app.get('/orders/:id/invoice', protect, generalLimiter, getOrderInvoice);
app.put('/orders/:id/status', protect, adminLooseLimiter, updateOrderStatus);
app.post('/orders/:id/send-invoice-email', protect, adminLooseLimiter, sendInvoiceEmailEndpoint);

// Modular REST APIs
// Products: general loose limit (100/min/IP).
app.use('/api/products', generalLimiter, productRoutes);
// Auth/Orders/Complaints routers me route-level specific limiters lage hain.
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/complaints', complaintRoutes);

// Global Error Handlers
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛒 Grocery Backend Server running on port ${PORT}`);
  console.log(`⚡ Supabase Project Connected: eagwchutdhtgioujetag`);
  console.log(`📡 Health Check:  http://localhost:${PORT}/api/health`);
  console.log(`📦 GET Products:  http://localhost:${PORT}/products`);
  console.log(`🔑 POST Login:    http://localhost:${PORT}/login`);
  console.log(`✨ POST Signup:   http://localhost:${PORT}/signup`);
  console.log(`======================================================\n`);

  // Agar order place hote waqt koi partner available na ho to order
  // "pending_assignment" rehta hai — ye worker har 30s me retry karta hai
  // + Realtime listener partner available hote hi turant assign karta hai.
  // Disable karna ho to: PENDING_ASSIGN_WORKER=off
  if (String(process.env.PENDING_ASSIGN_WORKER || 'on').toLowerCase() !== 'off') {
    try {
      startPendingAssignmentWorker({
        intervalMs: Number(process.env.PENDING_ASSIGN_INTERVAL_MS) || 30_000,
      });
    } catch (e) {
      console.warn(`⚠️ Pending-assignment worker start nahi hua: ${e.message}`);
    }
  } else {
    console.log('⏸️ [worker] Pending-assignment worker disabled (PENDING_ASSIGN_WORKER=off)');
  }
});
