import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';
import User from './models/User.js';
import Order from './models/Order.js';
import { initialProducts } from './data/seedData.js';

dotenv.config();

const importData = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grocery_delivery_db';
    await mongoose.connect(mongoUri);

    console.log('Clearing existing database collections...');
    await Product.deleteMany();
    await Order.deleteMany();
    await User.deleteMany();

    console.log('Inserting seed users...');
    const adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@supercart.com',
      password: 'adminpassword123',
      role: 'admin',
      phone: '9998887776',
    });

    const sampleCustomer = await User.create({
      name: 'Rohan Sharma',
      email: 'rohan.sharma@example.com',
      password: 'password123',
      role: 'customer',
      phone: '9876543210',
    });

    console.log('Inserting grocery products...');
    await Product.insertMany(initialProducts);

    console.log('\n=============================================');
    console.log('✅ DATA IMPORTED SUCCESSFULLY TO MONGODB!');
    console.log(`📦 Seeded ${initialProducts.length} Products`);
    console.log(`👤 Seeded 2 Users (admin@supercart.com / rohan.sharma@example.com)`);
    console.log('=============================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Data Import Failed:', error.message);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grocery_delivery_db';
    await mongoose.connect(mongoUri);

    await Product.deleteMany();
    await Order.deleteMany();
    await User.deleteMany();

    console.log('⚠️ All MongoDB collections destroyed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Data Destruction Failed:', error.message);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
