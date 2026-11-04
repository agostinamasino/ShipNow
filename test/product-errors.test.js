import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import * as productService from '../src/services/product.service.js';
import { createProduct, getProducts } from '../src/controllers/product.controller.js';

const marker = 'PRIVATE_INPUT_DO_NOT_EXPOSE';

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function assertSafe(res) {
  assert.deepEqual(Object.keys(res.body), ['error']);
  const serialized = JSON.stringify(res.body);
  for (const value of [marker, 'ValidationError', 'CastError', 'MongoServerError', 'stack', 'mongodb://']) {
    assert.ok(!serialized.includes(value), `La respuesta no debe incluir ${value}`);
  }
}

for (const [field, data] of [
  ['price', { name: 'Caja', price: marker }],
  ['stock', { name: 'Caja', price: 1, stock: { private: marker } }],
  ['name', { name: { private: marker }, price: 1 }],
  ['name', { price: 1 }],
]) {
  test(`400 seguro ante validación real de Mongoose en ${field}`, async (t) => {
    // Ejecuta las validaciones reales, sin guardar ni conectar a MongoDB.
    t.mock.method(Product, 'create', async data => {
      const product = new Product(data);
      await product.validate();
      return product;
    });
    const res = response();
    await createProduct({ body: data }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, `Datos de producto inválidos. Revisá los campos: ${field}.`);
    assertSafe(res);
  });
}

test('validación con rutas desconocidas usa fallback controlado', async (t) => {
  const error = new Error(`ValidationError: ${marker}`);
  error.name = 'ValidationError';
  error.errors = { [marker]: { message: marker } };
  t.mock.method(Product, 'create', async () => { throw error; });
  const res = response();
  await createProduct({ body: { name: 'Caja', price: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error,
    'Datos de producto inválidos. Revisá los campos: name, description, price, stock, status.');
  assertSafe(res);
});

test('estado inválido mantiene 400 sin repetir el valor recibido', async () => {
  const res = response();
  await createProduct({ body: { name: 'Caja', price: 1, status: marker } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /^status debe ser uno de:/);
  assertSafe(res);
});

test('error interno conserva identidad en el service y devuelve 500 seguro en POST', async (t) => {
  const error = new Error(`MongoServerError: mongodb://${marker}`);
  t.mock.method(Product, 'create', async () => { throw error; });
  const data = { name: 'Caja', price: 1 };
  await assert.rejects(productService.createProduct(data), received => received === error);
  const res = response();
  await createProduct({ body: data }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'No se pudo crear el producto.' });
  assertSafe(res);
});

test('error interno en GET devuelve 500 seguro', async (t) => {
  t.mock.method(Product, 'find', () => {
    throw new Error(`MongoServerError: ${marker}`);
  });
  const res = response();
  await getProducts({}, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'No se pudieron obtener los productos.' });
  assertSafe(res);
});
