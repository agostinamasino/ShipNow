import { expect } from 'chai';
import request from 'supertest';
import app from '../../src/app.js';
import Product from '../../src/models/Product.js';
import User from '../../src/models/User.js';
import Order from '../../src/models/Order.js';
import UploadedFile from '../../src/models/UploadedFile.js';
import { FILE_OWNERS } from '../../src/constants/index.js';
import { stubs, expectError } from '../support/helpers.js';
import { mockList } from '../../test-support/pagination.js';

const ownerId = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
const routes = [
  ['/api/products', Product], ['/api/users', User], ['/api/orders', Order],
  [`/api/users/${ownerId}/documents`, UploadedFile, FILE_OWNERS.USER],
  [`/api/orders/${ownerId}/receipts`, UploadedFile, FILE_OWNERS.ORDER],
];

describe('Cinco listados paginados atravesando capas reales', () => {
  let doubles, stored, filters, count;
  beforeEach(() => {
    doubles = stubs(); filters = []; count = 23;
    stored = Array.from({ length: count }, (_, n) => ({ _id: (n + 1).toString(16).padStart(24, '0'), status: true }));
    doubles.replace(User, 'findById', () => ({ select: async () => ({ _id: ownerId }) }));
    doubles.replace(Order, 'findById', async () => ({ _id: ownerId }));
  });
  afterEach(() => doubles.restore());

  for (const [route, Model, ownerModel] of routes) describe(route, () => {
    beforeEach(() => {
      mockList(doubles.replace.bind(doubles), Model, async filter => {
        filters.push(filter);
        const rows = stored.slice(0, count);
        return rows.reverse(); // Orden de inserción deliberadamente distinto.
      });
    });
    for (const [label, query, page, limit, length] of [
      ['defaults', '', 1, 10, 10], ['primera', '?page=1', 1, 10, 10],
      ['segunda', '?page=2', 2, 10, 10], ['personalizada', '?page=2&limit=4', 2, 4, 4],
      ['máximo', '?limit=100', 1, 100, 23], ['última incompleta', '?page=3', 3, 10, 3],
      ['sin resultados', '?page=4', 4, 10, 0], ['skip máximo', '?page=101&limit=100', 101, 100, 0],
    ]) it(`200 ${label}: contenido, orden, total y totalPages`, async () => {
      const response = await request(app).get(route + query).expect(200).expect('Content-Type', /json/);
      expect(response.body).to.have.all.keys('data', 'pagination');
      expect(response.body.pagination).to.deep.equal({ page, limit, total: 23, totalPages: Math.ceil(23 / limit) });
      expect(response.body.data).to.have.lengthOf(length);
      expect(response.body.data.map(row => row._id)).to.deep.equal(stored.slice((page - 1) * limit, page * limit).map(row => row._id));
      expect(filters).to.deep.equal([ownerModel ? { ownerModel, ownerId } : {}]);
    });
    it('colección vacía: 200 con totalPages 0', async () => {
      count = 0;
      expect((await request(app).get(route).expect(200)).body).to.deep.equal({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } });
    });
    for (const query of ['page=-1', 'page=0', 'page=1.5', 'page=', 'page=text', 'page=1&page=2', 'page[]=1', 'page[x]=1', 'page=9007199254740992', 'page=10002&limit=1', 'page=9007199254740991&limit=100', 'limit=-1', 'limit=0', 'limit=1.5', 'limit=', 'limit=text', 'limit=101', 'limit=1&limit=2', 'limit[]=1', 'limit[x]=1', 'limit=9007199254740992']) {
      it(`400 INVALID_PAGINATION: ${query}, sin consulta del listado`, async () => {
        expectError(await request(app).get(route + '?' + query), 'INVALID_PAGINATION');
        expect(filters).to.deep.equal([]);
      });
    }
    it('fallo de conteo: 500 seguro', async () => {
      doubles.replace(Model, 'countDocuments', async () => { throw new Error('PRIVATE_COUNT_FAILURE'); });
      expectError(await request(app).get(route), 'INTERNAL_ERROR');
    });
  });

  for (const [entity, ownerModel] of [['users', FILE_OWNERS.USER], ['orders', FILE_OWNERS.ORDER]]) {
    it(`${entity}: filtra registros y total por ownerModel y ownerId`, async () => {
      const records = [ownerId, otherId].flatMap(id => Object.values(FILE_OWNERS).flatMap(model => Array.from({ length: 3 }, (_, n) => ({ _id: String(n).padStart(24, '0'), ownerId: id, ownerModel: model }))));
      mockList(doubles.replace.bind(doubles), UploadedFile, async filter => records.filter(row => row.ownerId === filter.ownerId && row.ownerModel === filter.ownerModel));
      const response = await request(app).get(`/api/${entity}/${ownerId}/${entity === 'users' ? 'documents' : 'receipts'}?page=2&limit=2`).expect(200);
      expect(response.body.pagination).to.deep.equal({ page: 2, limit: 2, total: 3, totalPages: 2 });
      expect(response.body.data).to.have.lengthOf(1);
      expect(response.body.data[0]).to.include({ ownerId, ownerModel });
    });
    it(`${entity}: entidad inexistente conserva 404`, async () => {
      doubles.replace(User, 'findById', () => ({ select: async () => null }));
      doubles.replace(Order, 'findById', async () => null);
      expectError(await request(app).get(`/api/${entity}/${ownerId}/${entity === 'users' ? 'documents' : 'receipts'}`), 'FILE_ENTITY_NOT_FOUND');
    });
  }
});
