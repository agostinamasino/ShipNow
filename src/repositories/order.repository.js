import Order from '../models/Order.js';
import User from '../models/User.js';

export async function findAll({ skip, limit }) {
  const filter = {};
  const [data, total] = await Promise.all([
    Order.find(filter).sort({ _id: 1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return { data, total };
}

export function findById(id) {
  return Order.findById(id);
}

export function create(data) {
  return Order.create(data);
}

export function findUserById(id) {
  return User.findById(id).select('_id role');
}
