import * as userService from '../services/user.service.js';

export async function getUsers(req, res) {
  const users = await userService.getUsers();
  return res.json(users);
}

export async function createUser(req, res) {
  const user = await userService.createUser(req.body);
  return res.status(201).json(user);
}
