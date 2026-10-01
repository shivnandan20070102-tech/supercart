import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide category name'],
      trim: true,
      unique: true,
    },
    image: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const Category = mongoose.model('Category', categorySchema);
export default Category;
