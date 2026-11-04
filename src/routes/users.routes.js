import { Router } from 'express';
import User from '../models/User.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch {
    res.status(500).json({ error: 'No se pudieron obtener los usuarios.' });
  }
});

router.post('/', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Enviá un objeto JSON.' });
  }
  try {
    const { name, email, role } = req.body;
    const user = await User.create({ name, email, role });
    res.status(201).json(user);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
});

export default router;
