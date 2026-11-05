import { randomUUID } from 'node:crypto';
import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS } from '../constants/index.js';
import { generatePeople, generateOrders, generateDeliveries } from './mock.generator.js';
import { insertMockBatch } from '../repositories/mock.repository.js';

const DEFAULT_QTY = 10;
const MAX_QTY = 100;
const batchFields = ['users', 'couriers', 'orders', 'deliveries'];

function invalid(message) {
  const error = new Error(message);
  error.name = 'MockValidationError';
  return error;
}

function parseQty(value) {
  if (value === undefined) return DEFAULT_QTY;

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const qty = Number(value);
    if (qty <= MAX_QTY) return qty;
  }

  throw invalid(`qty debe ser un entero entre 0 y ${MAX_QTY}.`);
}

export function getMockUsers(qty) {
  return { users: generatePeople(parseQty(qty), USER_ROLES.USER) };
}

export function getMockCouriers(qty) {
  return { couriers: generatePeople(parseQty(qty), USER_ROLES.COURIER) };
}

export function getMockOrders(qty) {
  const { users } = getMockUsers(qty);
  return { orders: generateOrders(users), users };
}

export function getMockDeliveries(qty) {
  const { orders, users } = getMockOrders(qty);
  const couriers = generatePeople(orders.length, USER_ROLES.COURIER);
  const deliveries = generateDeliveries(orders, couriers);
  return { deliveries, orders: linkOrderStatuses(orders, deliveries), users, couriers };
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
    throw invalid('Enviá un objeto JSON con cantidades.');
  }
  if (qty !== undefined && body && Object.keys(body).length > 0) {
    throw invalid('Usá qty o un body con cantidades, sin combinar los dos formatos.');
  }
  if (body && Object.keys(body).some(field => !batchFields.includes(field))) {
    throw invalid('Los campos admitidos son users, couriers, orders y deliveries.');
  }

  const uniformCount = qty === undefined ? undefined : parseQty(qty);
  const counts = Object.fromEntries(batchFields.map(field => [
    field, uniformCount ?? (Object.hasOwn(body ?? {}, field) ? body[field] : 0),
  ]));
  const values = Object.values(counts);
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw invalid('Las cantidades deben ser enteros no negativos.');
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > MAX_QTY) {
    throw invalid(`El lote debe contener entre 1 y ${MAX_QTY} documentos en total.`);
  }
  if (counts.orders > 0 && counts.users === 0) {
    throw invalid('Para generar pedidos, incluí al menos un usuario.');
  }
  if (counts.deliveries > counts.orders || (counts.deliveries > 0 && counts.couriers === 0)) {
    throw invalid('Las entregas requieren un pedido distinto por entrega y al menos un repartidor.');
  }
  return counts;
}

export async function seedMocks(qty, body) {
  const counts = seedCounts(qty, body);
  const batchId = randomUUID();
  const users = generatePeople(counts.users, USER_ROLES.USER, batchId);
  const couriers = generatePeople(counts.couriers, USER_ROLES.COURIER, batchId);
  const customers = Array.from({ length: counts.orders }, (_, index) => users[index % users.length]);
  const orders = generateOrders(customers);
  const deliveries = generateDeliveries(orders.slice(0, counts.deliveries), couriers);
  const ids = await insertMockBatch({ users, couriers, orders: linkOrderStatuses(orders, deliveries), deliveries });
  return { batchId, counts, ids };
}
