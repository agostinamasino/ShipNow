import * as userRepository from '../repositories/user.repository.js';
import { USER_ROLES } from '../constants/index.js';
import { AppError } from '../errors/app-error.js';

export function getUsers() {
  return userRepository.findAll();
}

export async function createUser(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('USER_VALIDATION_FAILED');
  }

  const { name } = data;
  const role = data.role === undefined ? USER_ROLES.USER
    : typeof data.role === 'string' ? data.role.trim() : data.role;
  if (!Object.values(USER_ROLES).includes(role)) {
    throw new AppError('USER_INVALID_ROLE');
  }
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : data.email;
  if (typeof email === 'string' && email && await userRepository.findByEmail(email)) {
    throw new AppError('USER_EMAIL_ALREADY_EXISTS');
  }
  try {
    return await userRepository.create({ name, email, role });
  } catch (error) {
    if (error.name === 'ValidationError') {
      throw new AppError('USER_VALIDATION_FAILED', {
        cause: error,
        details: { fields: Object.keys(error.errors ?? {}) },
      });
    }
    if (error.code === 11000 && error.keyPattern?.email) {
      throw new AppError('USER_EMAIL_ALREADY_EXISTS', { cause: error });
    }
    throw error;
  }
}
