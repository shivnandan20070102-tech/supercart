import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide product name'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Please provide product description'],
    },
    price: {
      type: Number,
      required: [true, 'Please provide product price'],
      min: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
      default: function () {
        return this.price;
      },
    },
    unit: {
      type: String,
      required: [true, 'Please specify unit (e.g. 1 kg, 500 g, 1 Litre, 1 dozen)'],
      default: '1 pc',
    },
    category: {
      type: String,
      required: [true, 'Please specify a category'],
      trim: true,
    },
    image: {
      type: String,
      required: [true, 'Please provide an image URL'],
    },
    stock: {
      type: Number,
      required: [true, 'Please provide stock quantity'],
      min: 0,
      default: 50,
    },
    inStock: {
      type: Boolean,
      default: true,
    },
    badge: {
      type: String,
      default: '',
    },
    rating: {
      type: Number,
      default: 4.5,
      min: 0,
      max: 5,
    },
    reviewsCount: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Search indexing on name and category
productSchema.index({ name: 'text', category: 'text' });

const Product = mongoose.model('Product', productSchema);
export default Product;
