import * as productService from '../services/product.service.js';

export async function getProducts(req, res) {
  const products = await productService.getProducts();
  return res.json(products);
}

export async function createProduct(req, res) {
  const product = await productService.createProduct(req.body);
  return res.status(201).json(product);
}
