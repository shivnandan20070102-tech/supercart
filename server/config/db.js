import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { initialProducts } from '../data/seedData.js';

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grocery_delivery_db';

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`\n🌿 [MongoDB Connected]: ${conn.connection.host}`);
    console.log(`📦 Database Name: ${conn.connection.name}`);

    // Auto-seed initial grocery products if database is newly initialized
    try {
      const productCount = await Product.countDocuments();
      if (productCount === 0) {
        console.log('🌱 Database is empty. Seeding initial grocery products...');
        await Product.insertMany(initialProducts);
        console.log(`✅ Successfully seeded ${initialProducts.length} grocery products into MongoDB!`);
      } else {
        console.log(`🛒 Found ${productCount} existing grocery products in database.`);
      }
    } catch (seedError) {
      console.warn('⚠️ Product auto-seed warning:', seedError.message);
    }
  } catch (error) {
    console.error(`\n❌ [MongoDB Connection Error]: ${error.message}`);
    console.warn(`💡 TIP: MongoDB Atlas URI set karne ke liye 'server/.env' file mein MONGO_URI update karein:`);
    console.warn(`   MONGO_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/grocery_db?retryWrites=true&w=majority\n`);
  }
};

export default connectDB;
