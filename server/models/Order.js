import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    orderItems: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        image: { type: String, required: true },
        price: { type: Number, required: true },
        unit: { type: String, required: true },
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
      },
    ],
    shippingAddress: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      postalCode: { type: String, default: '' },
      phone: { type: String, required: true },
    },
    paymentMethod: {
      type: String,
      required: true,
      default: 'Cash On Delivery',
    },
    itemsPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    deliveryFee: {
      type: Number,
      required: true,
      default: 0.0,
    },
    couponDiscount: {
      type: Number,
      default: 0.0,
    },
    totalPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    isPaid: {
      type: Boolean,
      required: true,
      default: false,
    },
    paidAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['Placed', 'pending_assignment', 'assigned', 'Processing', 'Out for Delivery', 'Delivered', 'Cancelled'],
      default: 'pending_assignment',
    },
    estimatedDeliveryTime: {
      type: String,
      default: '10-15 mins',
    },
  },
  {
    timestamps: true,
  }
);

const Order = mongoose.model('Order', orderSchema);
export default Order;

