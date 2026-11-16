import Order from '../models/Order.js';
import User from '../models/User.js';

export function findAll() {
  return Order.find();
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
