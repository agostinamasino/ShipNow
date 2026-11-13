import { randomUUID } from 'node:crypto';
import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS } from '../constants/index.js';
import { generatePeople, generateOrders, generateDeliveries } from './mock.generator.js';
import { insertMockBatch } from '../repositories/mock.repository.js';
import { AppError } from '../errors/app-error.js';
import logger from '../config/logger.js';

const DEFAULT_QTY = 10;
const MAX_QTY = 100;
const batchFields = ['users', 'couriers', 'orders', 'deliveries'];

function parseQty(value, min = 0, max = MAX_QTY) {
  if (value === undefined) return DEFAULT_QTY;

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const qty = Number(value);
    if (qty >= min && qty <= max) return qty;
  }

  throw new AppError('MOCK_INVALID_QTY');
}

export function getMockUsers(qty) {
  const users = generatePeople(parseQty(qty), USER_ROLES.USER);
  logger.debug(`MOCK_PREVIEW entity=users qty=${users.length}`);
  return { users };
}

export function getMockCouriers(qty) {
  const couriers = generatePeople(parseQty(qty), USER_ROLES.COURIER);
  logger.debug(`MOCK_PREVIEW entity=couriers qty=${couriers.length}`);
  return { couriers };
}

function orderPreview(qty) {
  const users = generatePeople(parseQty(qty), USER_ROLES.USER);
  return { orders: generateOrders(users), users };
}

export function getMockOrders(qty) {
  const result = orderPreview(qty);
  logger.debug(`MOCK_PREVIEW entity=orders qty=${result.orders.length}`);
  return result;
}

export function getMockDeliveries(qty) {
  const { orders, users } = orderPreview(qty);
  const couriers = generatePeople(orders.length, USER_ROLES.COURIER);
  const deliveries = generateDeliveries(orders, couriers);
  const result = { deliveries, orders: linkOrderStatuses(orders, deliveries), users, couriers };
  logger.debug(`MOCK_PREVIEW entity=deliveries qty=${deliveries.length}`);
  return result;
}

function linkOrderStatuses(orders, deliveries) {
  const statuses = new Map(deliveries.map(delivery => [
    delivery.orderId,
    delivery.status === DELIVERY_STATUS.DELIVERED ? ORDER_STATUS.DELIVERED : ORDER_STATUS.IN_PROGRESS,
  ]));
  return orders.map(order => ({ ...order, status: statuses.get(order._id) ?? order.status }));
}

function seedCounts(qty, body) {
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
    throw new AppError('MOCK_INVALID_SEED_REQUEST');
  }
  if (qty !== undefined && body && Object.keys(body).length > 0) {
    throw new AppError('MOCK_INVALID_SEED_REQUEST');
  }
  if (body && Object.keys(body).some(field => !batchFields.includes(field))) {
    throw new AppError('MOCK_INVALID_SEED_REQUEST');
  }

  const uniformCount = qty === undefined ? undefined : parseQty(qty, 1, MAX_QTY / batchFields.length);
  const counts = Object.fromEntries(batchFields.map(field => [
    field, uniformCount ?? (Object.hasOwn(body ?? {}, field) ? body[field] : 0),
  ]));
  const values = Object.values(counts);
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new AppError('MOCK_INVALID_SEED_REQUEST');
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > MAX_QTY) {
    throw new AppError('MOCK_INVALID_SEED_REQUEST');
  }
  if (counts.orders > 0 && counts.users === 0) {
    throw new AppError('MOCK_INVALID_SEED_RELATIONS');
  }
  if (counts.deliveries > counts.orders || (counts.deliveries > 0 && counts.couriers === 0)) {
    throw new AppError('MOCK_INVALID_SEED_RELATIONS');
  }
  return counts;
}

export async function seedMocks(qty, body) {
  const counts = seedCounts(qty, body);
  logger.info(`MOCK_SEED_STARTED ${batchFields.map(field => `${field}=${counts[field]}`).join(' ')}`);
  const batchId = randomUUID();
  const users = generatePeople(counts.users, USER_ROLES.USER, batchId);
  const couriers = generatePeople(counts.couriers, USER_ROLES.COURIER, batchId);
  const customers = Array.from({ length: counts.orders }, (_, index) => users[index % users.length]);
  const orders = generateOrders(customers);
  const deliveries = generateDeliveries(orders.slice(0, counts.deliveries), couriers);
  const ids = await insertMockBatch({ users, couriers, orders: linkOrderStatuses(orders, deliveries), deliveries });
  logger.info(`MOCK_SEED_COMPLETED ${batchFields.map(field => `${field}=${ids[field].length}`).join(' ')}`);
  return { batchId, counts, ids };
}
