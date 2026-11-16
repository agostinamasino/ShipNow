import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import document from '../src/config/swagger.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';
import productsRouter from '../src/routes/products.routes.js';
import usersRouter from '../src/routes/users.routes.js';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';
import { ERROR_CATALOG } from '../src/errors/error.catalog.js';
import { PRODUCT_STATUS, USER_ROLES, ORDER_STATUS, DELIVERY_STATUS } from '../src/constants/index.js';
import Order from '../src/models/Order.js';
import Delivery from '../src/models/Delivery.js';
import mocksRouter from '../src/routes/mocks.routes.js';
import loggerRouter from '../src/routes/logger.routes.js';
import ordersRouter from '../src/routes/orders.routes.js';
import request from 'supertest';
import { ORDER_PRIORITY } from '../src/constants/index.js';

function resolveRef(reference) {
  assert.ok(reference.startsWith('#/'));
  const value = reference.slice(2).split('/').reduce((current, key) => current?.[key], document);
  assert.ok(value, reference);
  return value;
}

function dereference(value) {
  return value.$ref ? resolveRef(value.$ref) : value;
}

// Comprueba los tipos y restricciones utilizados en nuestros schemas 3.0.3.
function assertMatches(rawSchema, value) {
  const schema = dereference(rawSchema);
  if (value === null && schema.nullable) return;
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(branch => {
      try { assertMatches(branch, value); return true; } catch { return false; }
    });
    assert.equal(matches.length, 1);
    return;
  }
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    for (const field of schema.required ?? []) assert.ok(Object.hasOwn(value, field), field);
    for (const [key, item] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties, key), key);
      if (schema.properties?.[key]) assertMatches(schema.properties[key], item);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value));
    for (const item of value) assertMatches(schema.items, item);
  } else if (schema.type === 'integer') {
    assert.ok(Number.isInteger(value));
  } else {
    assert.equal(typeof value, schema.type);
  }
  if (schema.minimum !== undefined) assert.ok(value >= schema.minimum);
  if (schema.maximum !== undefined) assert.ok(value <= schema.maximum);
  if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength);
  if (schema.pattern) assert.match(value, new RegExp(schema.pattern));
}

function visit(value, inspect) {
  if (!value || typeof value !== 'object') return;
  inspect(value);
  for (const child of Object.values(value)) visit(child, inspect);
}

test('se documentan exactamente las catorce operaciones existentes con métodos y tags correctos', () => {
  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => [method, path, operation.tags]));
  assert.deepEqual(operations, [
    ['get', '/api/products', ['Products']], ['post', '/api/products', ['Products']],
    ['get', '/api/users', ['Users']], ['post', '/api/users', ['Users']],
    ['get', '/api/orders', ['Orders']], ['post', '/api/orders', ['Orders']],
    ['get', '/api/orders/{id}', ['Orders']],
    ['get', '/health', ['Health']],
    ['get', '/api/mocks/users', ['Users', 'Mocks']],
    ['get', '/api/mocks/couriers', ['Users', 'Mocks']],
    ['get', '/api/mocks/orders', ['Orders', 'Mocks']],
    ['get', '/api/mocks/deliveries', ['Deliveries', 'Mocks']],
    ['post', '/api/mocks/seed', ['Mocks']],
    ['get', '/api/logger-test', ['Logger']],
  ]);
  for (const [prefix, router] of [['/api/products', productsRouter], ['/api/users', usersRouter]]) {
    const actualMethods = router.stack.filter(layer => layer.route).flatMap(layer => {
      assert.equal(layer.route.path, '/');
      return Object.keys(layer.route.methods);
    });
    assert.deepEqual(Object.keys(document.paths[prefix]), actualMethods);
  }
  for (const [prefix, router] of [['/api/mocks', mocksRouter], ['/api/logger-test', loggerRouter]]) {
    for (const layer of router.stack.filter(layer => layer.route)) {
      const path = prefix + (layer.route.path === '/' ? '' : layer.route.path);
      assert.deepEqual(Object.keys(document.paths[path]), Object.keys(layer.route.methods));
    }
  }
  assert.equal(new Set(operations.map(([method, path]) => document.paths[path][method].operationId)).size, 14);
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const operation of Object.values(methods)) {
      for (const parameter of operation.parameters ?? []) {
        if (path === '/api/orders/{id}') {
          assert.equal(parameter.in, 'path');
          assert.equal(parameter.name, 'id');
          assert.equal(parameter.required, true);
        } else {
          assert.equal(parameter.in, 'query');
          assert.equal(parameter.name, 'qty');
        }
      }
      assert.equal(operation.security, undefined);
      assert.equal(operation.responses[401], undefined);
      assert.equal(operation.responses[403], undefined);
    }
  }
});

test('los veintiún schemas existen y todos los $ref del documento se resuelven', () => {
  assert.deepEqual(Object.keys(document.components.schemas).sort(),
    ['ObjectId', 'ProductCreate', 'Product', 'UserCreate', 'User', 'ErrorResponse', 'HealthResponse',
      'Order', 'OrderCreate', 'Delivery', 'MockUser', 'MockCourier', 'MockOrder', 'MockDelivery',
      'MockUsersResponse', 'MockCouriersResponse', 'MockOrdersResponse', 'MockDeliveriesResponse',
      'SeedCounts', 'SeedRequest', 'SeedResponse'].sort());
  visit(document, value => { if (value.$ref) resolveRef(value.$ref); });
});

test('campos, defaults y enums coinciden con modelos y constantes', () => {
  const schemas = document.components.schemas;
  assert.deepEqual(schemas.ProductCreate.required, ['name', 'price']);
  assert.deepEqual(schemas.UserCreate.required, ['name', 'email']);
  for (const [schemaName, Model] of [['Product', Product], ['User', User], ['Order', Order], ['Delivery', Delivery]]) {
    assert.deepEqual(Object.keys(schemas[schemaName].properties).sort(), Object.keys(Model.schema.paths).sort());
    for (const [field, property] of Object.entries(schemas[schemaName].properties)) {
      const path = Model.schema.path(field);
      if (property.default !== undefined) assert.deepEqual(property.default, path.defaultValue);
      if (property.enum) assert.deepEqual(property.enum, path.enumValues);
    }
  }
  assert.deepEqual(schemas.Product.properties.status.enum, Object.values(PRODUCT_STATUS));
  assert.deepEqual(schemas.UserCreate.properties.role.enum, Object.values(USER_ROLES));
  assert.equal(schemas.UserCreate.properties.email.pattern, User.schema.path('email').options.match[0].source);
  assert.equal(schemas.ProductCreate.properties.stock.type, 'integer');
  for (const field of ['price', 'stock']) assert.equal(schemas.ProductCreate.properties[field].minimum, 0);
  assertMatches(schemas.ProductCreate, { name: 'Caja', price: 0, status: false });
  assertMatches(schemas.ProductCreate, { name: 'Caja', price: 1, status: true, description: null });
  assert.throws(() => assertMatches(schemas.ProductCreate, { name: 'Caja', price: -1 }));
  assert.throws(() => assertMatches(schemas.ProductCreate, { name: 'Caja', price: 1, stock: 1.5 }));
  assert.throws(() => assertMatches(schemas.ProductCreate, { name: 'Caja', price: 1, status: 'unknown' }));
  assert.throws(() => assertMatches(schemas.UserCreate, { name: 'Ana', email: 'invalid' }));
});

test('cada código documentado coincide con el status, mensaje y formato del catálogo', () => {
  for (const methods of Object.values(document.paths)) {
    for (const operation of Object.values(methods)) {
      for (const [status, rawResponse] of Object.entries(operation.responses)) {
        if (Number(status) < 400) continue;
        const response = dereference(rawResponse);
        const media = response.content['application/json'];
        for (const [code, example] of Object.entries(media.examples)) {
          assert.equal(ERROR_CATALOG[code].status, Number(status));
          assert.equal(example.value.error.message, ERROR_CATALOG[code].message);
          assert.equal(example.value.error.code, code);
          assertMatches(media.schema, example.value);
        }
      }
    }
  }
  for (const [path, expected] of [
    ['/api/products', ['PRODUCT_VALIDATION_FAILED', 'PRODUCT_INVALID_STATUS', 'INVALID_JSON']],
    ['/api/users', ['USER_VALIDATION_FAILED', 'USER_INVALID_ROLE', 'INVALID_JSON']],
  ]) {
    const response = dereference(document.paths[path].post.responses[400]);
    assert.deepEqual(Object.keys(response.content['application/json'].examples), expected);
  }
});

test('ejemplos HTTP de Products, Users y Health respetan los schemas y cuerpos documentados', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productsRouter);
  app.use('/api/users', usersRouter);
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use(errorMiddleware);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => { if (server.listening) await new Promise(resolve => server.close(resolve)); });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const productExample = document.paths['/api/products'].post.responses[201].content['application/json'].example;
  const userExample = document.paths['/api/users'].post.responses[201].content['application/json'].example;
  let product;
  let user;
  t.mock.method(Product, 'create', async data => {
    product = new Product({ ...data, _id: productExample._id, __v: 0 });
    await product.validate();
    return product;
  });
  t.mock.method(Product, 'find', () => ({ lean: async () => product ? [product.toObject()] : [] }));
  t.mock.method(User, 'findOne', async () => null);
  t.mock.method(User.collection, 'createIndex', async () => 'email_1');
  t.mock.method(User.prototype, 'save', async function () {
    this._id = userExample._id;
    this.__v = 0;
    user = this;
    return this;
  });
  t.mock.method(User, 'find', async () => user ? [user] : []);

  for (const path of ['/api/products', '/api/users']) {
    const operation = document.paths[path].post;
    const media = operation.requestBody.content['application/json'];
    for (const { value } of Object.values(media.examples)) {
      assertMatches(media.schema, value);
      const response = await fetch(origin + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
      });
      assert.equal(response.status, 201);
      assertMatches(operation.responses[201].content['application/json'].schema, await response.json());
    }
    const successMedia = operation.responses[201].content['application/json'];
    const complete = path === '/api/products' ? media.examples.complete.value
      : { name: userExample.name, email: userExample.email, role: userExample.role };
    const created = await fetch(origin + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(complete),
    });
    assert.deepEqual(await created.json(), successMedia.example);
    const listed = await fetch(origin + path);
    assert.equal(listed.status, 200);
    assertMatches(document.paths[path].get.responses[200].content['application/json'].schema, await listed.json());
  }
  const health = await fetch(origin + '/health');
  assert.equal(health.status, 200);
  const healthMedia = document.paths['/health'].get.responses[200].content['application/json'];
  assert.deepEqual(await health.json(), healthMedia.example);
  assertMatches(healthMedia.schema, healthMedia.example);
});

test('los objetos mock tienen exactamente los campos reales sin __v y roles especializados', () => {
  const schemas = document.components.schemas;
  for (const [schemaName, Model] of [
    ['MockUser', User], ['MockCourier', User], ['MockOrder', Order], ['MockDelivery', Delivery],
  ]) {
    const properties = schemas[schemaName].properties;
    assert.deepEqual(Object.keys(properties).sort(), Object.keys(Model.schema.paths).filter(field => field !== '__v').sort());
    assert.equal(properties.__v, undefined);
    assert.equal(schemas[schemaName].additionalProperties, false);
  }
  assert.deepEqual(schemas.MockUser.properties.role.enum, [USER_ROLES.USER]);
  assert.deepEqual(schemas.MockCourier.properties.role.enum, [USER_ROLES.COURIER]);
  assert.ok(document.paths['/api/orders'].get);
  assert.ok(document.paths['/api/orders'].post);
  assert.equal(document.paths['/api/deliveries'], undefined);
});

test('qty y SeedRequest representan los dos formatos y sus restricciones sin ejecutar el seed', () => {
  for (const entity of ['users', 'couriers', 'orders', 'deliveries']) {
    const operation = document.paths['/api/mocks/' + entity].get;
    const [qty] = operation.parameters;
    assert.equal(qty.name, 'qty');
    assert.equal(qty.required, false);
    assert.deepEqual(qty.schema, { type: 'integer', minimum: 0, maximum: 100, default: 10 });
  }
  const operation = document.paths['/api/mocks/seed'].post;
  assert.deepEqual(operation.parameters[0].schema, { type: 'integer', minimum: 1, maximum: 25 });
  assert.equal(operation.requestBody.required, false);
  const schema = document.components.schemas.SeedRequest;
  assert.equal(schema.required, undefined);
  assert.equal(schema.additionalProperties, false);
  for (const field of ['users', 'couriers', 'orders', 'deliveries']) {
    assert.deepEqual(schema.properties[field], { type: 'integer', minimum: 0, maximum: 100, default: 0 });
  }
  assertMatches(schema, { users: 2, couriers: 2, orders: 3, deliveries: 3 });
  assertMatches(schema, {});
  for (const body of [null, [], { unknown: 1 }, { users: -1 }, { users: '2' }, { users: 1.5 }]) {
    assert.throws(() => assertMatches(schema, body));
  }
  for (const phrase of ['INSERTA datos reales', 'qty=10', '1 a 100', '{} con qty',
    'pedido distinto', 'transacción', 'replica set']) {
    assert.ok(operation.description.includes(phrase), phrase);
  }
  const response400 = dereference(operation.responses[400]);
  assert.deepEqual(Object.keys(response400.content['application/json'].examples), [
    'MOCK_INVALID_QTY', 'MOCK_INVALID_SEED_REQUEST', 'MOCK_INVALID_SEED_RELATIONS', 'INVALID_JSON',
  ]);
  const seedResponse = operation.responses[201].content['application/json'];
  assertMatches(seedResponse.schema, seedResponse.example);
  assert.match(seedResponse.example.batchId, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const ids = Object.values(seedResponse.example.ids).flat();
  assert.equal(new Set(ids).size, ids.length);
  for (const field of Object.keys(seedResponse.example.counts)) {
    assert.equal(seedResponse.example.counts[field], seedResponse.example.ids[field].length);
  }
});

test('los cuatro GET y sus ejemplos coinciden con OpenAPI y mantienen referencias internas sin persistencia', async (t) => {
  assert.equal(mongoose.connection.readyState, 0);
  const persistence = [
    t.mock.method(mongoose, 'connect'),
    t.mock.method(mongoose.connection, 'transaction'),
    ...[User, Order, Delivery].map(Model => t.mock.method(Model, 'insertMany')),
  ];
  const app = express();
  app.use('/api/mocks', mocksRouter);
  app.use(errorMiddleware);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => { if (server.listening) await new Promise(resolve => server.close(resolve)); });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  function assertRelationships(body) {
    for (const user of body.users ?? []) assert.equal(user.role, USER_ROLES.USER);
    for (const courier of body.couriers ?? []) assert.equal(courier.role, USER_ROLES.COURIER);
    const people = [...body.users ?? [], ...body.couriers ?? []];
    assert.equal(new Set(people.map(person => person.email)).size, people.length);
    for (const order of body.orders ?? []) assert.ok(body.users.some(user => user._id === order.userId));
    for (const delivery of body.deliveries ?? []) {
      const order = body.orders.find(order => order._id === delivery.orderId);
      assert.ok(order);
      assert.ok(body.couriers.some(courier => courier._id === delivery.courierId));
      assert.equal(order.status, delivery.status === DELIVERY_STATUS.DELIVERED
        ? ORDER_STATUS.DELIVERED : ORDER_STATUS.IN_PROGRESS);
    }
  }

  for (const entity of ['users', 'couriers', 'orders', 'deliveries']) {
    const path = '/api/mocks/' + entity;
    const operation = document.paths[path].get;
    const media = operation.responses[200].content['application/json'];
    assertMatches(media.schema, media.example);
    assertRelationships(media.example);
    for (const qty of [0, 2, 10]) {
      const response = await fetch(origin + path + (qty === 10 ? '' : '?qty=' + qty));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body[entity].length, qty);
      assertMatches(media.schema, body);
      assertRelationships(body);
    }
    const failed = await fetch(origin + path + '?qty=-1');
    assert.equal(failed.status, 400);
    assert.deepEqual(await failed.json(),
      dereference(operation.responses[400]).content['application/json'].examples.MOCK_INVALID_QTY.value);
  }
  assert.ok(persistence.every(operation => operation.mock.callCount() === 0));
});

test('importar Swagger mantiene logger visible en todos los entornos sin ejecutar el seed', () => {
  for (const nodeEnv of ['development', 'production', 'test']) {
    const source = `
      import mongoose from 'mongoose';
      import User from './src/models/User.js';
      import Order from './src/models/Order.js';
      import Delivery from './src/models/Delivery.js';
      let operations = 0;
      const forbidden = () => { operations++; throw new Error('Persistencia no permitida'); };
      mongoose.connect = forbidden;
      mongoose.connection.transaction = forbidden;
      for (const Model of [User, Order, Delivery]) Model.insertMany = forbidden;
      const { default: document } = await import('./src/config/swagger.js');
      console.log(JSON.stringify({ operation: document.paths['/api/logger-test'].get, operations }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, NODE_ENV: nodeEnv, PORT: '3000', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused' },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const { operation, operations } = JSON.parse(result.stdout);
    assert.equal(operations, 0);
    assert.deepEqual(operation.tags, ['Logger']);
    assert.deepEqual(operation.responses[200].content['application/json'].example, { status: 'ok' });
    assert.equal(operation.responses[404].$ref, '#/components/responses/RouteNotFound');
    for (const phrase of ['development', 'production', 'test', 'fatal no termina']) {
      assert.ok(operation.description.includes(phrase), phrase);
    }
    assert.equal(operation.security, undefined);
  }
});

test('Orders documenta exactamente los métodos del router sin PATCH ni CRUD de Deliveries', () => {
  const actual = ordersRouter.stack.filter(layer => layer.route).flatMap(({ route }) =>
    Object.keys(route.methods).map(method => [
      '/api/orders' + (route.path === '/' ? '' : route.path.replace(':id', '{id}')), method,
    ]));
  const documented = Object.entries(document.paths).filter(([path]) => path.startsWith('/api/orders'))
    .flatMap(([path, methods]) => Object.keys(methods).map(method => [path, method]));
  assert.deepEqual(documented, actual);
  assert.equal(document.paths['/api/orders/{id}'].patch, undefined);
  assert.equal(document.paths['/api/orders/{id}/status'], undefined);
  assert.equal(document.paths['/api/deliveries'], undefined);
  assert.equal(document.paths['/api/deliveries/{id}'], undefined);
});

test('OrderCreate describe los campos aceptados, enums, defaults y validación de dirección', () => {
  const schema = document.components.schemas.OrderCreate;
  assert.deepEqual(schema.required, ['userId', 'destinationAddress']);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['userId', 'destinationAddress', 'status', 'priority'].sort());
  assert.notEqual(schema.additionalProperties, false); // El service ignora campos adicionales.
  assert.equal(schema.properties.userId.$ref, '#/components/schemas/ObjectId');
  assert.deepEqual(schema.properties.status.enum, Object.values(ORDER_STATUS));
  assert.deepEqual(schema.properties.priority.enum, Object.values(ORDER_PRIORITY));
  assert.equal(schema.properties.status.default, ORDER_STATUS.PENDING);
  assert.equal(schema.properties.priority.default, ORDER_PRIORITY.NORMAL);
  const minimal = document.paths['/api/orders'].post.requestBody.content['application/json'].examples.minimal.value;
  assertMatches(schema, minimal);
  assertMatches(schema, { ...minimal, ignored: true });
  for (const field of ['status', 'priority']) {
    for (const value of [null, '', 'unknown']) assert.throws(() => assertMatches(schema, { ...minimal, [field]: value }));
  }
  for (const value of ['', '   ', 123, null]) {
    assert.throws(() => assertMatches(schema, { ...minimal, destinationAddress: value }));
  }
  assert.throws(() => assertMatches(schema, { ...minimal, userId: 'invalid' }));
  assert.throws(() => assertMatches(schema, { destinationAddress: minimal.destinationAddress }));
  assert.throws(() => assertMatches(schema, { userId: minimal.userId }));
  assert.ok(schema.description.includes('USER'));
});

test('Orders declara body, parámetro requerido y respuestas reutilizables exactas', () => {
  const collection = document.paths['/api/orders'];
  const detail = document.paths['/api/orders/{id}'].get;
  assert.equal(collection.post.requestBody.required, true);
  assert.equal(collection.post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/OrderCreate');
  assert.equal(collection.get.requestBody, undefined);
  assert.equal(detail.requestBody, undefined);
  assert.deepEqual(detail.parameters, [{
    name: 'id', in: 'path', required: true,
    description: 'ObjectId hexadecimal de 24 caracteres, sin espacios.',
    schema: { $ref: '#/components/schemas/ObjectId' }, example: '507f1f77bcf86cd799439031',
  }]);
  for (const [operation, statuses] of [[collection.get, ['200', '400', '413', '500']],
    [collection.post, ['201', '400', '404', '413', '500']], [detail, ['200', '400', '404', '413', '500']]]) {
    assert.deepEqual(Object.keys(operation.responses), statuses);
    assert.equal(operation.responses[413].$ref, '#/components/responses/PayloadTooLarge');
    assert.equal(operation.responses[500].$ref, '#/components/responses/InternalError');
    assert.ok(operation.description.includes('INVALID_JSON'));
  }
  assert.deepEqual(collection.get.responses[200].content['application/json'].schema,
    { type: 'array', items: { $ref: '#/components/schemas/Order' } });
  assert.equal(collection.post.responses[201].content['application/json'].schema.$ref, '#/components/schemas/Order');
  assert.equal(detail.responses[200].content['application/json'].schema.$ref, '#/components/schemas/Order');
});

test('los errores de Orders cubren sus siete códigos y solo validación incluye detalles', () => {
  const collection = document.paths['/api/orders'];
  const detail = document.paths['/api/orders/{id}'].get;
  for (const [operation, status, codes] of [
    [collection.post, 400, ['ORDER_VALIDATION_FAILED', 'ORDER_INVALID_STATUS', 'ORDER_INVALID_PRIORITY', 'ORDER_INVALID_USER_ROLE', 'INVALID_JSON']],
    [collection.post, 404, ['ORDER_USER_NOT_FOUND']],
    [detail, 400, ['ORDER_INVALID_ID', 'INVALID_JSON']],
    [detail, 404, ['ORDER_NOT_FOUND']],
  ]) {
    const media = dereference(operation.responses[status]).content['application/json'];
    assert.deepEqual(Object.keys(media.examples), codes);
    for (const [code, { value }] of Object.entries(media.examples)) {
      assert.equal(ERROR_CATALOG[code].status, status);
      assert.equal(value.error.message, ERROR_CATALOG[code].message);
      if (code === 'ORDER_VALIDATION_FAILED') assert.deepEqual(value.error.details, { fields: ['userId'] });
      else assert.equal(value.error.details, undefined);
      assertMatches(media.schema, value);
    }
  }
  const fields = document.components.schemas.ErrorResponse.properties.error.properties.details.properties.fields.items.enum;
  for (const field of ['userId', 'destinationAddress', 'status', 'priority']) assert.ok(fields.includes(field));
});

test('ejemplos OpenAPI de Orders coinciden con respuestas HTTP y validación real sin MongoDB', async t => {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);
  app.use(errorMiddleware);
  const collection = document.paths['/api/orders'];
  const detail = document.paths['/api/orders/{id}'].get;
  const example = collection.post.responses[201].content['application/json'].example;
  let order;
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: example.userId, role: USER_ROLES.USER }) }));
  t.mock.method(Order, 'create', async data => {
    order = new Order({ ...data, _id: example._id, __v: 0 });
    await order.validate();
    return order;
  });
  t.mock.method(Order, 'find', async () => order ? [order] : []);
  t.mock.method(Order, 'findById', async () => order ?? null);
  const media = collection.post.requestBody.content['application/json'];
  for (const { value } of Object.values(media.examples)) {
    assertMatches(media.schema, value);
    const response = await request(app).post('/api/orders').send(value).expect(201);
    assertMatches(collection.post.responses[201].content['application/json'].schema, response.body);
  }
  const created = await request(app).post('/api/orders').send(media.examples.minimal.value).expect(201);
  assert.deepEqual(created.body, example);
  assert.deepEqual((await request(app).get('/api/orders/' + example._id).expect(200)).body,
    detail.responses[200].content['application/json'].example);
  const listed = await request(app).get('/api/orders').expect(200);
  assertMatches(collection.get.responses[200].content['application/json'].schema, listed.body);
  assert.deepEqual(listed.body, collection.get.responses[200].content['application/json'].examples.populated.value);
  order = undefined;
  assert.deepEqual((await request(app).get('/api/orders').expect(200)).body,
    collection.get.responses[200].content['application/json'].examples.empty.value);
  for (const [path, code] of [['invalid', 'ORDER_INVALID_ID'], [example._id, 'ORDER_NOT_FOUND']]) {
    const response = await request(app).get('/api/orders/' + path);
    assert.deepEqual(response.body, dereference(detail.responses[response.status]).content['application/json'].examples[code].value);
  }
  for (const [field, code] of [['status', 'ORDER_INVALID_STATUS'], ['priority', 'ORDER_INVALID_PRIORITY']]) {
    const response = await request(app).post('/api/orders').send({ ...media.examples.minimal.value, [field]: 'invalid' }).expect(400);
    assert.deepEqual(response.body, dereference(collection.post.responses[400]).content['application/json'].examples[code].value);
  }
  t.mock.method(User, 'findById', () => ({ select: async () => null }));
  const missing = await request(app).post('/api/orders').send(media.examples.minimal.value).expect(404);
  assert.deepEqual(missing.body, dereference(collection.post.responses[404]).content['application/json'].examples.ORDER_USER_NOT_FOUND.value);
  assert.equal(mongoose.connection.readyState, 0);
});
