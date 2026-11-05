import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Order from '../src/models/Order.js';
import Delivery from '../src/models/Delivery.js';
import User from '../src/models/User.js';
import { createUser } from '../src/services/user.service.js';
import { ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY, USER_ROLES } from '../src/constants/index.js';

const { ObjectId } = mongoose.Types;
const orderData = { userId: new ObjectId().toHexString(), destinationAddress: '  Calle de prueba 123  ' };
const deliveryData = { orderId: new ObjectId().toHexString(), courierId: new ObjectId().toHexString() };

test('Order aplica estado y prioridad por defecto y recorta la dirección', async () => {
  const order = new Order(orderData);
  await order.validate();
  assert.equal(order.status, ORDER_STATUS.PENDING);
  assert.equal(order.priority, ORDER_PRIORITY.NORMAL);
  assert.equal(order.destinationAddress, 'Calle de prueba 123');
});

test('Delivery aplica el estado asignado por defecto', async () => {
  const delivery = new Delivery(deliveryData);
  await delivery.validate();
  assert.equal(delivery.status, DELIVERY_STATUS.ASSIGNED);
});

test('Order requiere una dirección no vacía', async () => {
  for (const destinationAddress of [undefined, null, '', '   ']) {
    await assert.rejects(new Order({ ...orderData, destinationAddress }).validate(),
      error => error.name === 'ValidationError' && error.errors.destinationAddress?.kind === 'required');
  }
});

for (const [Model, data, field, reference] of [
  [Order, orderData, 'userId', 'User'],
  [Delivery, deliveryData, 'orderId', 'Order'],
  [Delivery, deliveryData, 'courierId', 'User'],
]) {
  test(`${Model.modelName}.${field} requiere un ObjectId con referencia a ${reference}`, async () => {
    assert.equal(Model.schema.path(field).options.ref, reference);
    const doc = new Model(data);
    await doc.validate();
    assert.ok(doc[field] instanceof ObjectId);
    assert.equal(doc[field].toHexString(), data[field]);
    await assert.rejects(new Model({ ...data, [field]: undefined }).validate(),
      error => error.name === 'ValidationError' && error.errors[field]?.kind === 'required');
    await assert.rejects(new Model({ ...data, [field]: 'invalid-id' }).validate(),
      error => error.name === 'ValidationError' && error.errors[field]?.name === 'CastError');
  });
}

for (const [Model, data, field, constants] of [
  [Order, orderData, 'status', ORDER_STATUS],
  [Order, orderData, 'priority', ORDER_PRIORITY],
  [Delivery, deliveryData, 'status', DELIVERY_STATUS],
]) {
  test(`${Model.modelName}.${field} acepta los valores del enum y rechaza valores ajenos`, async () => {
    for (const value of Object.values(constants)) {
      const doc = new Model({ ...data, [field]: value });
      await doc.validate();
      assert.equal(doc[field], value);
    }
    for (const value of ['unknown', '', null]) {
      await assert.rejects(new Model({ ...data, [field]: value }).validate(),
        error => error.name === 'ValidationError' && Boolean(error.errors[field]));
    }
  });
}

test('Users admite ADMIN, USER y COURIER y mantiene USER como rol predeterminado', async (t) => {
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User.collection, 'createIndex', async () => 'email_1');
  t.mock.method(User.prototype, 'save', async function () { return this; });

  for (const role of [USER_ROLES.ADMIN, USER_ROLES.USER, USER_ROLES.COURIER, undefined]) {
    const user = await createUser({ name: 'Persona de prueba', email: 'persona@example.com', role });
    assert.equal(user.role, role ?? USER_ROLES.USER);
  }
});
