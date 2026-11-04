import mongoose from 'mongoose';
import { PRODUCT_STATUS } from '../constants/index.js';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  price: { type: Number, required: true, min: 0 },
  stock: {
    type: Number,
    default: 0,
    min: 0,
    validate: { validator: Number.isInteger, message: 'stock debe ser un entero.' },
  },
  status: {
    type: String,
    enum: Object.values(PRODUCT_STATUS),
    default: PRODUCT_STATUS.AVAILABLE,
    required: true,
  },
});

export default mongoose.model('Product', productSchema);
