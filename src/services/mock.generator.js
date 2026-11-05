import { randomBytes, randomUUID } from 'node:crypto';
import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY } from '../constants/index.js';

const priorities = Object.values(ORDER_PRIORITY);
const deliveryStates = Object.values(DELIVERY_STATUS);

function mockId() {
  return randomBytes(12).toString('hex');
}

export function generatePeople(qty, role, batchId = randomUUID()) {
  const label = role === USER_ROLES.COURIER ? 'Repartidor' : 'Usuario';

  return Array.from({ length: qty }, (_, index) => ({
    _id: mockId(),
    name: `${label} de prueba ${index + 1}`,
    email: `${role}.${batchId}.${index + 1}@example.com`,
    role,
  }));
}

export function generateOrders(users) {
  return users.map((user, index) => ({
    _id: mockId(),
    userId: user._id,
    status: ORDER_STATUS.PENDING,
    priority: priorities[(index + 1) % priorities.length],
    destinationAddress: `Calle de prueba ${index + 1}`,
  }));
}

export function generateDeliveries(orders, couriers) {
  return orders.map((order, index) => ({
    _id: mockId(),
    orderId: order._id,
    courierId: couriers[index % couriers.length]._id,
    status: deliveryStates[index % deliveryStates.length],
  }));
}
