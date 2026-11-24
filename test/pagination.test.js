import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination, PAGINATION } from '../src/utils/pagination.js';
import * as products from '../src/repositories/product.repository.js';
import * as users from '../src/repositories/user.repository.js';
import * as orders from '../src/repositories/order.repository.js';
import * as files from '../src/repositories/file.repository.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';
import Order from '../src/models/Order.js';
import UploadedFile from '../src/models/UploadedFile.js';
import document from '../src/config/swagger.js';
import { mockList } from '../test-support/pagination.js';
import { getProducts } from '../src/services/product.service.js';

test('paginación centralizada: defaults, máximo, límite de skip e inmutabilidad', () => {
  assert.ok(Object.isFrozen(PAGINATION));
  assert.deepEqual(parsePagination(), { page: 1, limit: 10, skip: 0 });
  assert.deepEqual(parsePagination({ page: '101', limit: '100' }), { page: 101, limit: 100, skip: 10000 });
  assert.ok(Object.isFrozen(parsePagination()));
});

for (const value of ['', '0', '-1', '1.5', 'abc', '1e2', ' 1 ', '9007199254740992', ['1'], { a: '1' }, null]) {
  test(`validación directa rechaza page/limit ${JSON.stringify(value)}`, () => {
    for (const key of ['page', 'limit']) assert.throws(() => parsePagination({ [key]: value }), { code: 'INVALID_PAGINATION' });
  });
}

for (const [Model, repository, owner] of [
  [Product, products], [User, users], [Order, orders],
  [UploadedFile, files, { ownerModel: 'User', ownerId: '507f1f77bcf86cd799439011' }],
]) test(`${Model.modelName}: sort/skip/limit antes de ejecutar y conteo con el mismo filtro`, async t => {
  const events = [], rows = [{ _id: 'example' }];
  const query = {
    sort(value) { events.push(['sort', value]); return this; },
    skip(value) { events.push(['skip', value]); return this; },
    limit(value) { events.push(['limit', value]); return this; },
    lean() { events.push(['lean']); return this; },
    then(resolve, reject) { events.push(['execute']); return Promise.resolve(rows).then(resolve, reject); },
  };
  const find = t.mock.method(Model, 'find', () => query);
  const count = t.mock.method(Model, 'countDocuments', async () => 23);
  const options = parsePagination({ page: '2', limit: '4' });
  const result = owner ? await repository.findByOwner(owner, options) : await repository.findAll(options);
  assert.deepEqual(result, { data: rows, total: 23 });
  assert.deepEqual(events, [['sort', { _id: 1 }], ['skip', 4], ['limit', 4], ...(Model === Product ? [['lean']] : []), ['execute']]);
  assert.deepEqual(find.mock.calls[0].arguments, [owner ?? {}]);
  assert.deepEqual(count.mock.calls[0].arguments, [owner ?? {}]);
  assert.equal(find.mock.callCount(), 1);
  assert.equal(count.mock.callCount(), 1);
});

test('Products normaliza solo la página: un estado inválido fuera de ella no rompe la lectura', async t => {
  const stored = Array.from({ length: 11 }, (_, n) => ({ _id: String(n).padStart(24, '0'), status: n === 10 ? 'invalid' : true }));
  mockList(t.mock.method.bind(t.mock), Product, async () => stored);
  const result = await getProducts();
  assert.equal(result.data.length, 10);
  assert.ok(result.data.every(item => item.status === 'available'));
  assert.equal(result.pagination.total, 11);
  assert.equal(stored[0].status, true);
  await assert.rejects(getProducts({ page: '2' }), /Estado inválido/);
});

test('OpenAPI mantiene 19 operaciones, 29 schemas y contratos paginados en cinco GET', () => {
  assert.equal(Object.values(document.paths).reduce((sum, path) => sum + Object.keys(path).length, 0), 19);
  assert.equal(Object.keys(document.components.schemas).length, 29);
  for (const [path, schema] of [
    ['/api/products', 'ProductsPage'], ['/api/users', 'UsersPage'], ['/api/orders', 'OrdersPage'],
    ['/api/users/{id}/documents', 'UploadedFilesPage'], ['/api/orders/{id}/receipts', 'UploadedFilesPage'],
  ]) {
    const op = document.paths[path].get;
    const parameters = op.parameters.filter(p => p.in === 'query');
    assert.deepEqual(parameters.map(p => p.name), ['page', 'limit']);
    assert.deepEqual(parameters.map(p => p.schema.default), [1, 10]);
    assert.equal(parameters[1].schema.maximum, PAGINATION.maxLimit);
    const media = op.responses[200].content['application/json'];
    assert.equal(media.schema.$ref, `#/components/schemas/${schema}`);
    assert.deepEqual(media.examples.empty.value, { data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } });
    assert.equal(media.examples.populated.value.data.length, 1);
    const error = document.components.responses[op.responses[400].$ref.split('/').at(-1)];
    assert.equal(error.content['application/json'].examples.INVALID_PAGINATION.value.error.code, 'INVALID_PAGINATION');
  }
});
