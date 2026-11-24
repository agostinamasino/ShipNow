import Product from '../models/Product.js';

export async function findAll({ skip, limit }) {
  const filter = {};
  const [data, total] = await Promise.all([
    Product.find(filter).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  return { data, total };
}

export function create(data) {
  return Product.create(data);
}
