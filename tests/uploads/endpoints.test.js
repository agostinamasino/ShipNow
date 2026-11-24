import { mockList, pageOf } from '../../test-support/pagination.js';
import { expect } from 'chai';
import request from 'supertest';
import { mkdtemp, readdir, readFile, writeFile, mkdir, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import User from '../../src/models/User.js';
import Order from '../../src/models/Order.js';
import UploadedFile from '../../src/models/UploadedFile.js';
import logger from '../../src/config/logger.js';
import { DOCUMENT_TYPES, FILE_OWNERS, FILE_MIME_TYPES, UPLOAD_POLICY } from '../../src/constants/index.js';
import { stubs, expectError, secret } from '../support/helpers.js';
import { toUploadParserError } from '../../src/errors/file-error.js';

const users = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
const orders = ['507f1f77bcf86cd799439021', '507f1f77bcf86cd799439022'];
const missing = '507f1f77bcf86cd799439099';
const pdf = Buffer.from('%PDF-1.7\nAcademic test');

describe('Documentos y comprobantes por HTTP, MongoDB simulado y disco temporal', () => {
  let root, app, doubles, saved, filters, logs, creations, lookups;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'shipnow-file-api-'));
    app = createApp({ uploadRoot: root });
    doubles = stubs(); saved = []; filters = []; logs = []; creations = 0; lookups = [];
    for (const level of ['debug', 'http', 'info', 'warning', 'error', 'fatal']) {
      doubles.replace(logger, level, message => logs.push({ level, message }));
    }
    doubles.replace(User, 'findById', id => {
      lookups.push(id);
      return { select: async projection => {
        expect(projection).to.equal('_id');
        return users.includes(id) ? { _id: id } : null;
      } };
    });
    doubles.replace(Order, 'findById', async id => { lookups.push(id); return orders.includes(id) ? { _id: id } : null; });
    doubles.replace(UploadedFile, 'create', async data => {
      creations++;
      const doc = new UploadedFile({ ...data, _id: (100 + creations).toString(16).padStart(24, '0'), __v: 0 });
      await doc.validate();
      saved.push(doc);
      return doc;
    });
    mockList(doubles.replace.bind(doubles), UploadedFile, async filter => {
      filters.push(filter);
      return saved.filter(file => file.ownerModel === filter.ownerModel && String(file.ownerId) === filter.ownerId);
    });
  });
  afterEach(async () => {
    doubles.restore();
    try {
      const serialized = JSON.stringify(logs);
      for (const sensitive of [...users, ...orders, missing, 'PRIVATE_TEST_VALUE', root, 'mongodb://']) {
        expect(serialized).not.to.include(sensitive);
      }
    } finally {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('shipnow-file-api-')) {
        throw new Error('Directorio de pruebas inesperado');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });

  const route = (entity = 'users', id = entity === 'users' ? users[0] : orders[0]) =>
    `/api/${entity}/${id}/${entity === 'users' ? 'documents' : 'receipts'}`;
  function post({ entity = 'users', id, type = entity === 'users' ? DOCUMENT_TYPES.IDENTITY : DOCUMENT_TYPES.DELIVERY_PROOF,
    buffer = pdf, filename = 'PRIVATE_TEST_VALUE.pdf', mime = FILE_MIME_TYPES.PDF, field = 'file', fileFirst = false } = {}) {
    const operation = request(app).post(route(entity, id));
    if (!fileFirst && type !== undefined) operation.field('documentType', type);
    operation.attach(field, buffer, { filename, contentType: mime });
    if (fileFirst && type !== undefined) operation.field('documentType', type);
    return operation;
  }
  async function files(relative = '') {
    const result = [];
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const item = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) result.push(...await files(item));
      else result.push(item);
    }
    return result.sort();
  }
  function classification(code, level) {
    const events = logs.filter(event => event.message.startsWith('HTTP_ERROR'));
    expect(events).to.have.lengthOf(1);
    expect(events[0].level).to.equal(level);
    expect(events[0].message).to.include(`code=${code}`);
    expect(logs.filter(event => event.message.startsWith('FILE_UPLOAD_COMPLETED'))).to.have.lengthOf(0);
  }

  for (const entity of ['users', 'orders']) {
    it(`POST ${entity}: 201, disco y metadatos asociados exclusivamente a la ruta`, async () => {
      const response = await post({ entity }).expect(201).expect('Content-Type', /json/);
      const ownerModel = entity === 'users' ? FILE_OWNERS.USER : FILE_OWNERS.ORDER;
      const ownerId = entity === 'users' ? users[0] : orders[0];
      expect(response.body).to.have.all.keys('_id', '__v', 'ownerModel', 'ownerId', 'originalName', 'filename', 'path', 'mimeType', 'size', 'documentType', 'uploadedAt');
      expect(response.body).to.include({ ownerModel, ownerId, originalName: 'PRIVATE_TEST_VALUE.pdf', size: pdf.length, mimeType: FILE_MIME_TYPES.PDF });
      expect(response.body.path).to.equal(`${entity === 'users' ? 'users/documents' : 'orders/receipts'}/${response.body.filename}`);
      expect(response.body.filename).to.match(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.pdf$/);
      expect(new Date(response.body.uploadedAt).toISOString()).to.equal(response.body.uploadedAt);
      expect(await readFile(path.join(root, response.body.path))).to.deep.equal(pdf);
      expect(await files()).to.deep.equal([response.body.path]);
      expect(saved).to.have.lengthOf(1);
      expect(logs.filter(event => event.message.startsWith('FILE_UPLOAD_COMPLETED'))).to.have.lengthOf(1);
      expect(logs.find(event => event.message.startsWith('FILE_UPLOAD_COMPLETED')).level).to.equal('info');
      const listed = await request(app).get(route(entity)).expect(200);
      expect(listed.body).to.deep.equal(pageOf([response.body]));
      expect(filters).to.deep.equal([{ ownerModel, ownerId }]);
      expect(logs.filter(event => event.message.startsWith('FILES_LISTED'))).to.deep.equal([
        { level: 'debug', message: `FILES_LISTED entity=${ownerModel} count=1` },
      ]);
      expect(logs.filter(event => event.message.startsWith('HTTP_ERROR'))).to.deep.equal([]);
      const template = entity === 'users' ? '/api/users/:id/documents' : '/api/orders/:id/receipts';
      const summaries = logs.filter(event => event.message.startsWith('HTTP_REQUEST'));
      expect(summaries).to.have.lengthOf(2);
      expect(summaries[0].message).to.include(`method=POST route=${template} status=201`);
      expect(summaries[1].message).to.include(`method=GET route=${template} status=200`);
    });
    it(`GET ${entity} existente sin archivos: 200 y []`, async () => {
      expect((await request(app).get(route(entity)).expect(200)).body).to.deep.equal(pageOf([]));
      expect(await files()).to.deep.equal([]);
    });
    for (const method of ['get', 'post']) {
      it(`${method} ${entity}: ID inválido antes de consultar o crear carpetas`, async () => {
        expectError(await request(app)[method](route(entity, 'invalid')), 'FILE_INVALID_ENTITY_ID');
        expect(lookups).to.deep.equal([]);
        expect(await readdir(root)).to.deep.equal([]);
        expect(creations).to.equal(0);
      });
      it(`${method} ${entity}: entidad inexistente devuelve 404 sin escribir`, async () => {
        expectError(await request(app)[method](route(entity, missing)), 'FILE_ENTITY_NOT_FOUND');
        expect(creations).to.equal(0);
        expect(await readdir(root)).to.deep.equal([]);
      });
    }
  }
  it('GET filtra entre dos usuarios y dos pedidos sin mezclar archivos', async () => {
    for (const entity of ['users', 'orders']) {
      for (const id of entity === 'users' ? users : orders) await post({ entity, id }).expect(201);
    }
    for (const entity of ['users', 'orders']) {
      for (const id of entity === 'users' ? users : orders) {
        const response = await request(app).get(route(entity, id)).expect(200);
        expect(response.body.data).to.have.lengthOf(1);
        expect(response.body.data[0].ownerId).to.equal(id);
        expect(response.body.data[0].ownerModel).to.equal(entity === 'users' ? FILE_OWNERS.USER : FILE_OWNERS.ORDER);
      }
    }
  });
  it('acepta address_proof y archivo antes del campo de texto', async () => {
    const response = await post({ type: DOCUMENT_TYPES.ADDRESS_PROOF, fileFirst: true }).expect(201);
    expect(response.body.documentType).to.equal(DOCUMENT_TYPES.ADDRESS_PROOF);
  });
  for (const [mime, filename, buffer] of [
    [FILE_MIME_TYPES.PNG, 'image.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])],
    [FILE_MIME_TYPES.JPEG, 'image.jpeg', Buffer.from([0xff, 0xd8, 0xff, 1])],
  ]) it(`acepta ${mime} y conserva sus bytes`, async () => {
    const response = await post({ mime, filename, buffer }).expect(201);
    expect(await readFile(path.join(root, response.body.path))).to.deep.equal(buffer);
  });
  it('archivo faltante: FILE_REQUIRED sin persistir', async () => {
    expectError(await request(app).post(route()).field('documentType', DOCUMENT_TYPES.IDENTITY), 'FILE_REQUIRED');
    classification('FILE_REQUIRED', 'warning');
    expect(creations).to.equal(0);
    expect(await files()).to.deep.equal([]);
  });
  it('campo de archivo incorrecto: FILE_INVALID_FIELD', async () => {
    expectError(await post({ field: 'other' }), 'FILE_INVALID_FIELD');
    expect(await files()).to.deep.equal([]);
  });
  for (const options of [
    { filename: 'bad.exe', mime: 'application/octet-stream' },
    { filename: 'bad.png', mime: FILE_MIME_TYPES.PDF },
    { buffer: Buffer.from('PRIVATE_TEST_VALUE') },
    { buffer: Buffer.alloc(0) },
  ]) it(`rechaza tipo/contenido ${JSON.stringify(options)} con 415 y sin residuos`, async () => {
    expectError(await post(options), 'FILE_INVALID_TYPE');
    classification('FILE_INVALID_TYPE', 'warning');
    expect(creations).to.equal(0);
    expect(await files()).to.deep.equal([]);
  });
  it('rechaza más de 5 MiB con 413 y limpia Multer', async () => {
    const buffer = Buffer.alloc(UPLOAD_POLICY.maxSize + 1, 32);
    pdf.copy(buffer);
    expectError(await post({ buffer }), 'FILE_TOO_LARGE');
    classification('FILE_TOO_LARGE', 'warning');
    expect(await files()).to.deep.equal([]);
    expect(creations).to.equal(0);
  });
  for (const options of [{ type: 'invalid' }, { type: '' }, { type: DOCUMENT_TYPES.DELIVERY_PROOF }, { entity: 'orders', type: DOCUMENT_TYPES.IDENTITY }]) {
    it(`documentType incompatible ${JSON.stringify(options)} limpia staging`, async () => {
      expectError(await post(options), 'FILE_INVALID_DOCUMENT_TYPE');
      expect(await files()).to.deep.equal([]);
      expect(creations).to.equal(0);
    });
  }
  it('documentType ausente limpia el archivo temporal', async () => {
    expectError(await request(app).post(route()).attach('file', pdf, { filename: 'file.pdf', contentType: FILE_MIME_TYPES.PDF }), 'FILE_INVALID_DOCUMENT_TYPE');
    expect(await files()).to.deep.equal([]);
    expect(creations).to.equal(0);
  });
  for (const field of ['unknown', 'ownerModel', 'ownerId']) it(`no acepta ${field} desde el body`, async () => {
    expectError(await post().field(field, 'PRIVATE_TEST_VALUE'), 'FILE_INVALID_REQUEST');
    expect(await files()).to.deep.equal([]);
    expect(creations).to.equal(0);
  });
  it('rechaza documentType repetido', async () => {
    expectError(await post().field('documentType', DOCUMENT_TYPES.IDENTITY), 'FILE_INVALID_REQUEST');
    expect(await files()).to.deep.equal([]);
    expect(creations).to.equal(0);
  });
  it('rechaza segundo archivo sin residuos', async () => {
    expectError(await post().attach('file', pdf, { filename: 'second.pdf', contentType: FILE_MIME_TYPES.PDF }), 'FILE_INVALID_FIELD');
    expect(await files()).to.deep.equal([]);
  });
  it('rechaza formato no multipart sin crear carpetas', async () => {
    expectError(await request(app).post(route()).send({ documentType: DOCUMENT_TYPES.IDENTITY }), 'FILE_INVALID_REQUEST');
    expect(await readdir(root)).to.deep.equal([]);
  });
  it('rechaza multipart sin boundary con error controlado', async () => {
    expectError(await request(app).post(route()).set('Content-Type', 'multipart/form-data').send('broken'), 'FILE_INVALID_REQUEST');
    expect(await files()).to.deep.equal([]);
  });
  it('fallo al almacenar staging: 500, una clasificación error y ninguna asociación', async () => {
    await writeFile(path.join(root, 'staging'), 'obstruction');
    expectError(await post(), 'FILE_STORAGE_FAILED');
    classification('FILE_STORAGE_FAILED', 'error');
    expect(creations).to.equal(0);
    expect(await files()).to.deep.equal(['staging']);
  });
  it('fallo al mover al destino: 500 y temporal eliminado', async () => {
    await writeFile(path.join(root, 'users'), 'obstruction');
    expectError(await post(), 'FILE_STORAGE_FAILED');
    classification('FILE_STORAGE_FAILED', 'error');
    expect(creations).to.equal(0);
    expect(await files()).to.deep.equal(['users']);
  });
  it('fallo de metadatos: elimina definitivo y no anuncia éxito', async () => {
    doubles.replace(UploadedFile, 'create', async () => { throw new Error(secret); });
    expectError(await post(), 'FILE_METADATA_PERSISTENCE_FAILED');
    classification('FILE_METADATA_PERSISTENCE_FAILED', 'error');
    expect(await files()).to.deep.equal([]);
    expect(saved).to.deep.equal([]);
  });
  it('fallo de limpieza se registra sin ocultar el error de persistencia', async () => {
    let occupied;
    doubles.replace(UploadedFile, 'create', async metadata => {
      occupied = path.join(root, metadata.path);
      await unlink(occupied);
      await mkdir(occupied); // Fuerza unlink a fallar; el hook elimina esta fixture.
      throw new Error(secret);
    });
    expectError(await post(), 'FILE_METADATA_PERSISTENCE_FAILED');
    classification('FILE_METADATA_PERSISTENCE_FAILED', 'error');
    expect(logs.filter(event => event.message === 'FILE_CLEANUP_FAILED')).to.deep.equal([{ level: 'error', message: 'FILE_CLEANUP_FAILED' }]);
    expect(existsSync(occupied)).to.equal(true);
  });
  it('no elimina un archivo confirmado si falla después la serialización HTTP', async () => {
    doubles.replace(UploadedFile, 'create', async metadata => {
      const doc = new UploadedFile(metadata);
      await doc.validate();
      saved.push(doc);
      return { toJSON() { throw new Error(secret); } };
    });
    expectError(await post(), 'INTERNAL_ERROR');
    expect(saved).to.have.lengthOf(1);
    expect(existsSync(path.join(root, saved[0].path))).to.equal(true);
    expect(logs.filter(event => event.message.startsWith('FILE_UPLOAD_COMPLETED'))).to.have.lengthOf(1);
  });
  it('fallo inesperado al consultar metadatos sigue siendo 500 seguro', async () => {
    mockList(doubles.replace.bind(doubles), UploadedFile, async () => { throw new Error(secret); });
    expectError(await request(app).get(route()), 'INTERNAL_ERROR');
    classification('INTERNAL_ERROR', 'error');
    expect(logs.some(event => event.message.startsWith('FILES_LISTED'))).to.equal(false);
  });
  it('fallo inesperado al consultar entidad no se transforma en 400', async () => {
    doubles.replace(Order, 'findById', async () => { throw new Error(secret); });
    expectError(await request(app).post(route('orders')), 'INTERNAL_ERROR');
    expect(await readdir(root)).to.deep.equal([]);
  });
  it('traductor no convierte errores desconocidos del parser indiscriminadamente en 400', () => {
    const error = new Error(secret);
    expect(toUploadParserError(error)).to.equal(error);
  });
});
