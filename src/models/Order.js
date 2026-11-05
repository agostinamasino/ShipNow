import mongoose from 'mongoose';
import { ORDER_STATUS, ORDER_PRIORITY } from '../constants/index.js';

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: Object.values(ORDER_STATUS),
    default: ORDER_STATUS.PENDING,
    required: true,
  },
  priority: {
    type: String,
    enum: Object.values(ORDER_PRIORITY),
    default: ORDER_PRIORITY.NORMAL,
    required: true,
  },
  destinationAddress: { type: String, required: true, trim: true },
});

export default mongoose.model('Order', orderSchema);
