import Product from '../models/Product.js';

export function findAll() {
  return Product.find().lean();
}

export function create(data) {
  return Product.create(data);
}
