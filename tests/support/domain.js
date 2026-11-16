import { expect } from 'chai';
import User from '../../src/models/User.js';
import Order from '../../src/models/Order.js';
import Delivery from '../../src/models/Delivery.js';
import { USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY } from '../../src/constants/index.js';

export async function expectDomain({ users = [], couriers = [], orders = [], deliveries = [] }) {
  const people = [...users, ...couriers];
  expect(new Set(people.map(person => person.email)).size).to.equal(people.length);
  for (const [list, role] of [[users, USER_ROLES.USER], [couriers, USER_ROLES.COURIER]]) {
    for (const person of list) {
      expect(person).to.have.all.keys('_id', 'name', 'email', 'role');
      expect(person.role).to.equal(role);
      expect(person.name).to.be.a('string').and.not.empty;
      expect(person.email).to.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      await new User(person).validate();
    }
  }
  for (const order of orders) {
    expect(order).to.have.all.keys('_id', 'userId', 'status', 'priority', 'destinationAddress');
    expect(users.some(user => user._id === order.userId)).to.equal(true);
    expect(Object.values(ORDER_STATUS)).to.include(order.status);
    expect(Object.values(ORDER_PRIORITY)).to.include(order.priority);
    await new Order(order).validate();
  }
  expect(new Set(deliveries.map(delivery => delivery.orderId)).size).to.equal(deliveries.length);
  for (const delivery of deliveries) {
    expect(delivery).to.have.all.keys('_id', 'orderId', 'courierId', 'status');
    const order = orders.find(item => item._id === delivery.orderId);
    expect(order).not.to.equal(undefined);
    expect(couriers.some(courier => courier._id === delivery.courierId)).to.equal(true);
    expect(Object.values(DELIVERY_STATUS)).to.include(delivery.status);
    expect(order.status).to.equal(delivery.status === DELIVERY_STATUS.DELIVERED
      ? ORDER_STATUS.DELIVERED : ORDER_STATUS.IN_PROGRESS);
    await new Delivery(delivery).validate();
  }
  for (const list of [users, couriers, orders, deliveries]) {
    expect(new Set(list.map(item => item._id)).size).to.equal(list.length);
    for (const item of list) expect(item._id).to.match(/^[a-f0-9]{24}$/);
  }
}
