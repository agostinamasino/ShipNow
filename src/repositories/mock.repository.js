import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';

function unavailable() {
  const error = new Error('El seed requiere una conexión MongoDB con soporte para transacciones.');
  error.name = 'MockPersistenceUnavailableError';
  return error;
}

function insertedIds(input, inserted) {
  return new Map(input.map((doc, index) => [doc._id, inserted[index]._id]));
}

export async function insertMockBatch({ users, couriers, orders, deliveries }) {
  if (mongoose.connection.readyState !== 1) throw unavailable();

  try {
    return await mongoose.connection.transaction(async session => {
      const people = [...users, ...couriers];
      const insertedPeople = await User.insertMany(people, { session });
      const personIds = insertedIds(people, insertedPeople);
      const insertedOrders = orders.length ? await Order.insertMany(orders.map(order => ({
        ...order, userId: personIds.get(order.userId),
      })), { session }) : [];
      const orderIds = insertedIds(orders, insertedOrders);
      const insertedDeliveries = deliveries.length ? await Delivery.insertMany(deliveries.map(delivery => ({
        ...delivery, orderId: orderIds.get(delivery.orderId), courierId: personIds.get(delivery.courierId),
      })), { session }) : [];

      return {
        users: insertedPeople.slice(0, users.length).map(doc => doc._id.toString()),
        couriers: insertedPeople.slice(users.length).map(doc => doc._id.toString()),
        orders: insertedOrders.map(doc => doc._id.toString()),
        deliveries: insertedDeliveries.map(doc => doc._id.toString()),
      };
    });
  } catch (error) {
    if (error.code === 20 || ['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError']
      .includes(error.name)) {
      throw unavailable();
    }
    throw error;
  }
}
