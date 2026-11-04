import { Router } from 'express';
import Product from '../models/Product.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch {
    res.status(500).json({ error: 'No se pudieron obtener los productos.' });
  }
});

router.post('/', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Enviá un objeto JSON.' });
  }
  try {
    const { name, description, price, stock, status } = req.body;
    const product = await Product.create({ name, description, price, stock, status });
    res.status(201).json(product);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'No se pudo crear el producto.' });
  }
});

export default router;
