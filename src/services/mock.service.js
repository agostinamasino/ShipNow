import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS } from '../constants/index.js';
import { generatePeople, generateOrders, generateDeliveries } from './mock.generator.js';

const DEFAULT_QTY = 10;
const MAX_QTY = 100;

function parseQty(value) {
  if (value === undefined) return DEFAULT_QTY;

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const qty = Number(value);
    if (qty <= MAX_QTY) return qty;
  }

  const error = new Error(`qty debe ser un entero entre 0 y ${MAX_QTY}.`);
  error.name = 'MockValidationError';
  throw error;
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
  const linkedOrders = orders.map((order, index) => ({
    ...order,
    status: deliveries[index].status === DELIVERY_STATUS.DELIVERED
      ? ORDER_STATUS.DELIVERED
      : ORDER_STATUS.IN_PROGRESS,
  }));

  return { deliveries, orders: linkedOrders, users, couriers };
}
