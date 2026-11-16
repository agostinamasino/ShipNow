import * as orderRepository from '../repositories/order.repository.js';
import { ORDER_STATUS, ORDER_PRIORITY, USER_ROLES } from '../constants/index.js';
import { AppError } from '../errors/app-error.js';

function isObjectId(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

export function getOrders() {
  return orderRepository.findAll();
}

export async function getOrderById(id) {
  if (!isObjectId(id)) throw new AppError('ORDER_INVALID_ID');
  const order = await orderRepository.findById(id);
  if (!order) throw new AppError('ORDER_NOT_FOUND');
  return order;
}

export async function createOrder(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('ORDER_VALIDATION_FAILED');
  }

  const { userId, destinationAddress } = data;
  const fields = [];
  if (!isObjectId(userId)) fields.push('userId');
  if (typeof destinationAddress !== 'string' || !destinationAddress.trim()) {
    fields.push('destinationAddress');
  }
  if (fields.length) throw new AppError('ORDER_VALIDATION_FAILED', { details: { fields } });

  const status = data.status === undefined ? ORDER_STATUS.PENDING : data.status;
  const priority = data.priority === undefined ? ORDER_PRIORITY.NORMAL : data.priority;
  if (!Object.values(ORDER_STATUS).includes(status)) throw new AppError('ORDER_INVALID_STATUS');
  if (!Object.values(ORDER_PRIORITY).includes(priority)) throw new AppError('ORDER_INVALID_PRIORITY');

  const user = await orderRepository.findUserById(userId);
  if (!user) throw new AppError('ORDER_USER_NOT_FOUND');
  if (user.role !== USER_ROLES.USER) throw new AppError('ORDER_INVALID_USER_ROLE');

  try {
    return await orderRepository.create({
      userId, destinationAddress: destinationAddress.trim(), status, priority,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      throw new AppError('ORDER_VALIDATION_FAILED', {
        cause: error,
        details: { fields: Object.keys(error.errors ?? {}) },
      });
    }
    throw error;
  }
}
