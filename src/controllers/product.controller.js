import * as productService from '../services/product.service.js';

export async function getProducts(req, res) {
  try {
    const products = await productService.getProducts();
    res.json(products);
  } catch {
    res.status(500).json({ error: 'No se pudieron obtener los productos.' });
  }
}

export async function createProduct(req, res) {
  try {
    const product = await productService.createProduct(req.body);
    res.status(201).json(product);
  } catch (error) {
    if (error.name === 'ProductValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'No se pudo crear el producto.' });
  }
}
