import mongoose from 'mongoose';
import { DELIVERY_STATUS } from '../constants/index.js';

const deliverySchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  courierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: Object.values(DELIVERY_STATUS),
    default: DELIVERY_STATUS.ASSIGNED,
    required: true,
  },
});

export default mongoose.model('Delivery', deliverySchema);
