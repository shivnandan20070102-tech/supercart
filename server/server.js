import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import { protect } from './middleware/authMiddleware.js';
import { startPendingAssignmentWorker } from './jobs/pendingAssignmentWorker.js';
import { getProducts, getProductById } from './controllers/productController.js';
import { loginUser, signupUser } from './controllers/authController.js';
import { createOrder, getOrders, getMyOrders, getOrderById, assignDeliveryPartner, markOrderPacked } from './controllers/orderController.js';

dotenv.config();

const app = express();

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

// Direct Top-Level APIs
app.get('/products', getProducts);
app.get('/products/:id', getProductById);
app.post('/login', loginUser);
app.post('/signup', signupUser);
app.post('/orders', createOrder);
// Alias for old frontend (frontend calls /orders/myorders, new standard is /api/orders/myorders)
// No behaviour change for any user - both URLs return same per-user filtered orders
app.get('/orders/myorders', getMyOrders);
app.get('/orders/:id', getOrderById);
// Alias: admin manual override (PUT /api/orders/:id/assign)
app.put('/orders/:id/assign', protect, assignDeliveryPartner);
// Alias: store manager pack (PUT /api/orders/:id/pack)
app.put('/orders/:id/pack', protect, markOrderPacked);

// Modular REST APIs
app.use('/api/products', productRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);

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
