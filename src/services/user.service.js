import * as userRepository from '../repositories/user.repository.js';
import { USER_ROLES } from '../constants/index.js';

function userError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function duplicateEmailError() {
  return userError('UserConflictError', 'Ya existe un usuario con ese correo electrónico.');
}

export function getUsers() {
  return userRepository.findAll();
}

export async function createUser(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw userError('UserValidationError', 'Enviá un objeto JSON.');
  }

  const { name } = data;
  const role = data.role === undefined ? USER_ROLES.USER
    : typeof data.role === 'string' ? data.role.trim() : data.role;
  if (!Object.values(USER_ROLES).includes(role)) {
    throw userError('UserValidationError', `role debe ser uno de: ${Object.values(USER_ROLES).join(', ')}.`);
  }
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : data.email;
  try {
    if (typeof email === 'string' && email && await userRepository.findByEmail(email)) {
      throw duplicateEmailError();
    }
    return await userRepository.create({ name, email, role });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const fields = ['name', 'email', 'role'].filter(field => error.errors?.[field]);
      throw userError('UserValidationError', `Datos de usuario inválidos. Revisá los campos: ${fields.join(', ') || 'name, email, role'}.`);
    }
    if (error.code === 11000 && error.keyPattern?.email) {
      throw duplicateEmailError();
    }
    throw error;
  }
}
