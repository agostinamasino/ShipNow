import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_STATUS, USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY } from '../src/constants/index.js';
import { normalizeProductStatus, createProduct, getProducts } from '../src/services/product.service.js';
import { createUser } from '../src/services/user.service.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

test('constantes: valores e inmutabilidad', () => {
  assert.deepEqual(PRODUCT_STATUS, { AVAILABLE: 'available', OUT_OF_STOCK: 'out_of_stock' });
  assert.deepEqual(USER_ROLES, { ADMIN: 'admin', USER: 'user', COURIER: 'courier' });
  assert.deepEqual(ORDER_STATUS, { PENDING: 'pending', IN_PROGRESS: 'in_progress', DELIVERED: 'delivered' });
  assert.deepEqual(DELIVERY_STATUS, { ASSIGNED: 'assigned', IN_TRANSIT: 'in_transit', DELIVERED: 'delivered' });
  assert.deepEqual(ORDER_PRIORITY, { LOW: 'low', NORMAL: 'normal', HIGH: 'high' });
  for (const constants of [PRODUCT_STATUS, USER_ROLES, ORDER_STATUS, DELIVERY_STATUS, ORDER_PRIORITY]) {
    assert.ok(Object.isFrozen(constants));
    assert.throws(() => { constants.NEW = 'changed'; }, TypeError);
    assert.throws(() => { constants[Object.keys(constants)[0]] = 'changed'; }, TypeError);
  }
});

test('GET Products usa lean y convierte copias sin alterar los documentos leídos', async (t) => {
  const stored = [{ _id: 'old-true', status: true }, { _id: 'old-false', status: false },
    { _id: 'new', status: PRODUCT_STATUS.OUT_OF_STOCK }];
  t.mock.method(Product, 'find', () => ({ lean: async () => stored }));
  const result = await getProducts();
  assert.deepEqual(result.map(p => p.status), [
    PRODUCT_STATUS.AVAILABLE, PRODUCT_STATUS.OUT_OF_STOCK, PRODUCT_STATUS.OUT_OF_STOCK,
  ]);
  assert.equal(stored[0].status, true);
  assert.equal(stored[1].status, false);
  assert.notEqual(result[0], stored[0]);
});

for (const [value, expected] of [
  [true, PRODUCT_STATUS.AVAILABLE], [false, PRODUCT_STATUS.OUT_OF_STOCK],
  [undefined, PRODUCT_STATUS.AVAILABLE],
  ...Object.values(PRODUCT_STATUS).map(value => [value, value]),
]) {
  test(`compatibilidad status: ${value}`, () => {
    assert.equal(normalizeProductStatus(value), expected);
    const original = { status: value };
    const copy = { ...original, status: normalizeProductStatus(original.status) };
    assert.equal(original.status, value);
    assert.equal(copy.status, expected);
  });
}

for (const value of [null, '', 'true', 'false', 'unknown', 0, 1, {}, []]) {
  test(`service rechaza status ${JSON.stringify(value)}`, async () => {
    await assert.rejects(createProduct({ name: 'Caja', price: 1, status: value }),
      { name: 'ProductValidationError' });
  });
}

test('Product: default String y estados válidos en el modelo', async () => {
  const product = new Product({ name: 'Caja', price: 1 });
  await product.validate();
  assert.equal(product.status, PRODUCT_STATUS.AVAILABLE);
  for (const status of Object.values(PRODUCT_STATUS)) {
    await new Product({ name: 'Caja', price: 1, status }).validate();
  }
  for (const status of [true, false, null, 'unknown']) {
    await assert.rejects(new Product({ name: 'Caja', price: 1, status }).validate(),
      { name: 'ValidationError' });
  }
});

test('User: default y enum de roles en el modelo', async () => {
  assert.equal(new User().role, USER_ROLES.USER);
  for (const role of Object.values(USER_ROLES)) {
    await new User({ name: 'Ana', email: 'ana@example.com', role }).validate();
  }
  for (const role of [null, '', 'unknown']) {
    await assert.rejects(new User({ name: 'Ana', email: 'ana@example.com', role }).validate(),
      { name: 'ValidationError' });
  }
});

for (const role of [null, '', 'unknown', true, 1, {}, []]) {
  test(`service rechaza role ${JSON.stringify(role)}`, async () => {
    await assert.rejects(createUser({ name: 'Ana', email: 'ana@example.com', role }),
      { name: 'UserValidationError' });
  });
}
