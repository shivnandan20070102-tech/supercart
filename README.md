# 🛒 SuperCart - MERN Grocery Delivery App

A full-stack grocery delivery application built using the MERN stack (MongoDB, Express, React, Node.js) with clear separation between `client` (Frontend) and `server` (Backend).

---

## 📁 Project Structure

```
suoer cart/
├── client/                     # Frontend (React 19 + Vite + Tailwind CSS)
│   ├── public/                 # Static assets
│   ├── src/
│   │   ├── components/         # Reusable UI components (ProductCard, Navbar, Footer)
│   │   ├── context/            # Global state (CartContext.jsx)
│   │   ├── pages/              # Views (Home.jsx, Cart.jsx, Login.jsx)
│   │   ├── services/           # API service layer (api.js)
│   │   ├── App.jsx             # React router & layout
│   │   ├── main.jsx            # React root mount
│   │   └── index.css           # Tailwind styles
│   ├── package.json
│   └── vite.config.js
│
├── server/                     # Backend (Node.js + Express + Mongoose)
│   ├── config/                 # MongoDB connection (db.js)
│   ├── controllers/            # authController.js, productController.js, orderController.js
│   ├── data/                   # Seed data (seedData.js)
│   ├── middleware/             # authMiddleware.js, errorMiddleware.js
│   ├── models/                 # User.js, Product.js, Order.js, Category.js
│   ├── routes/                 # authRoutes.js, productRoutes.js, orderRoutes.js
│   ├── utils/                  # generateToken.js
│   ├── seeder.js               # Database seeder script
│   ├── .env                    # Environment variables (PORT, MONGO_URI, JWT_SECRET)
│   ├── server.js               # Express server entrypoint
│   └── package.json
│
├── .gitignore
└── README.md
```

---

## 🍃 MongoDB Atlas Connection Setup Guide

MongoDB Atlas Free Tier se connect karne ke liye:

1. **MongoDB Atlas** ([mongodb.com/atlas](https://www.mongodb.com/atlas)) par free account banayein.
2. Ek **Free M0 Cluster** create karein.
3. **Database Access** mein jakar ek Database User (Username & Password) banayein.
4. **Network Access** mein jakar **Add IP Address** -> `0.0.0.0/0` (Allow Access from Anywhere) select karein.
5. **Connect** -> **Drivers (Node.js)** par click karke connection string copy karein.
6. `server/.env` file open karein aur `MONGO_URI` update karein:
   ```env
   MONGO_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/grocery_db?retryWrites=true&w=majority
   ```
7. Database mein initial products seed karne ke liye:
   ```bash
   cd server
   node seeder.js
   ```

---

## 🚀 How to Run the Project (Kaise Run Karein)

### 1️⃣ Frontend (`client`):
```bash
cd client
npm run dev
```
👉 Browser: **http://localhost:5173**

### 2️⃣ Backend (`server`):
```bash
cd server
npm run dev
# ya
npm start
```
👉 Health Check: **http://localhost:5000/api/health**

---

## 📡 Live Database Endpoints

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/products` / `/api/products` | Sare products MongoDB se fetch karein (Supports `?category=` & `?search=`) | No |
| `GET` | `/products/:id` | Single product by MongoDB ID | No |
| `POST` | `/signup` / `/api/auth/signup` | Naya user register karein (Password hashed with bcrypt) | No |
| `POST` | `/login` / `/api/auth/login` | User login check karein & JWT token payein | No |
| `GET` | `/api/auth/profile` | Logged in user profile | Yes (Bearer Token) |
| `POST` | `/api/orders` | Grocery order place karein MongoDB mein | Yes (Bearer Token) |
| `GET` | `/api/orders/myorders` | User ke previous orders list | Yes (Bearer Token) |
