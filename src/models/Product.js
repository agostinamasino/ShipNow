import mongoose from 'mongoose';

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
  status: { type: Boolean, default: true },
});

export default mongoose.model('Product', productSchema);
