import * as userService from '../services/user.service.js';

export async function getUsers(req, res) {
  try {
    const users = await userService.getUsers();
    res.json(users);
  } catch {
    res.status(500).json({ error: 'No se pudieron obtener los usuarios.' });
  }
}

export async function createUser(req, res) {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    if (error.name === 'UserValidationError') {
      return res.status(400).json({ error: error.message });
    }
    if (error.name === 'UserConflictError') {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
}
