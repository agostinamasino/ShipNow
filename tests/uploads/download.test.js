import { expect } from 'chai';
import request from 'supertest';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, rename, symlink, open } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createApp } from '../../src/app.js';
import UploadedFile from '../../src/models/UploadedFile.js';
import User from '../../src/models/User.js';
import Order from '../../src/models/Order.js';
import logger from '../../src/config/logger.js';
import { FILE_OWNERS, FILE_MIME_TYPES, DOCUMENT_TYPES } from '../../src/constants/index.js';
import { expectError, stubs, secret } from '../support/helpers.js';

const pdf = Buffer.from('%PDF-1.7\nDownload fixture');
const fileId = '507f1f77bcf86cd799439051';
const ownerId = '507f1f77bcf86cd799439011';
const endpoint = `/api/files/${fileId}/download`;
function binary(response, callback) {
  const chunks = [];
  response.on('data', chunk => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

describe('Descarga controlada por HTTP con disco aislado y MongoDB simulado', () => {
  let temp, root, app, fixture, doubles, lookups, events, links, servers;
  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'shipnow-download-'));
    root = path.join(temp, 'storage');
    fixture = {
      _id: fileId, ownerId, ownerModel: FILE_OWNERS.USER,
      originalName: 'PRIVATE_TEST_VALUE.pdf', filename: '5de0805a-f569-4ee2-a2b5-ea567c767991.pdf',
      path: 'users/documents/5de0805a-f569-4ee2-a2b5-ea567c767991.pdf',
      mimeType: FILE_MIME_TYPES.PDF, size: pdf.length, documentType: DOCUMENT_TYPES.IDENTITY, uploadedAt: new Date(),
    };
    await mkdir(path.dirname(path.join(root, fixture.path)), { recursive: true });
    await writeFile(path.join(root, fixture.path), pdf);
    app = createApp({ uploadRoot: root });
    doubles = stubs(); lookups = []; events = []; links = []; servers = [];
    doubles.replace(UploadedFile, 'findById', async id => { lookups.push(id); return fixture; });
    doubles.replace(User, 'findById', () => ({ select: async () => ({ _id: ownerId }) }));
    doubles.replace(Order, 'findById', async () => ({ _id: ownerId }));
    for (const level of ['http', 'error', 'warning', 'info', 'debug']) {
      doubles.replace(logger, level, message => events.push({ level, message }));
    }
  });
  afterEach(async () => {
    doubles.restore();
    try {
      for (const sensitive of [temp, fileId, ownerId, fixture.filename, 'PRIVATE_TEST_VALUE', 'mongodb://']) {
        if (sensitive) expect(JSON.stringify(events)).not.to.include(sensitive);
      }
    } finally {
      for (const server of servers) {
        server.closeAllConnections();
        if (server.listening) await new Promise(resolve => server.close(resolve));
      }
      for (const link of links) await unlink(link).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (path.dirname(path.resolve(temp)) !== path.resolve(tmpdir()) || !path.basename(temp).startsWith('shipnow-download-')) throw new Error('Raíz de pruebas inesperada');
      await rm(temp, { recursive: true, force: true });
    }
  });

  for (const [mime, extension, bytes] of [
    [FILE_MIME_TYPES.PDF, 'pdf', pdf],
    [FILE_MIME_TYPES.JPEG, 'jpg', Buffer.from([255, 216, 255, 1, 2])],
    [FILE_MIME_TYPES.PNG, 'png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])],
  ]) it(`200 ${mime}: bytes exactos, attachment seguro y nosniff`, async () => {
    fixture.filename = fixture.filename.replace(/pdf$/, extension);
    fixture.path = 'users/documents/' + fixture.filename;
    fixture.mimeType = mime;
    await writeFile(path.join(root, fixture.path), bytes);
    const response = await request(app).get(endpoint).buffer(true).parse(binary).expect(200);
    expect(response.body).to.deep.equal(bytes);
    expect(response.headers['content-type']).to.equal(mime);
    expect(response.headers['content-disposition']).to.equal(`attachment; filename="${fixture.filename}"`);
    expect(response.headers['x-content-type-options']).to.equal('nosniff');
    expect(+response.headers['content-length']).to.equal(bytes.length); // Usa stat, no size declarado.
    expect(lookups).to.deep.equal([fileId]);
    expect(events.filter(event => event.message.startsWith('HTTP_REQUEST'))).to.have.lengthOf(1);
    expect(events.find(event => event.message.startsWith('HTTP_REQUEST')).message).to.include('route=/api/files/:fileId/download status=200');
  });
  it('descarga un comprobante asociado a Order', async () => {
    fixture.ownerModel = FILE_OWNERS.ORDER;
    fixture.documentType = DOCUMENT_TYPES.DELIVERY_PROOF;
    fixture.path = 'orders/receipts/' + fixture.filename;
    await mkdir(path.dirname(path.join(root, fixture.path)), { recursive: true });
    await writeFile(path.join(root, fixture.path), pdf);
    expect((await request(app).get(endpoint).buffer(true).parse(binary).expect(200)).body).to.deep.equal(pdf);
  });
  for (const id of ['invalid', 'zzzzzzzzzzzzzzzzzzzzzzzz', '507f1f77bcf86cd79943905']) it(`400 para ID ${id} antes de consultar`, async () => {
    expectError(await request(app).get(`/api/files/${id}/download`), 'FILE_INVALID_ID');
    expect(lookups).to.deep.equal([]);
  });
  it('404 cuando no existen metadatos', async () => {
    doubles.replace(UploadedFile, 'findById', async () => null);
    expectError(await request(app).get(endpoint), 'FILE_NOT_FOUND');
  });
  for (const ownerModel of [FILE_OWNERS.USER, FILE_OWNERS.ORDER]) it(`404 para entidad ${ownerModel} eliminada`, async () => {
    fixture.ownerModel = ownerModel;
    doubles.replace(User, 'findById', () => ({ select: async () => null }));
    doubles.replace(Order, 'findById', async () => null);
    expectError(await request(app).get(endpoint), 'FILE_ENTITY_NOT_FOUND');
  });
  it('404 cuando el archivo físico no existe', async () => {
    await unlink(path.join(root, fixture.path));
    expectError(await request(app).get(endpoint), 'FILE_NOT_FOUND');
  });
  for (const kind of ['traversal', 'absolute', 'windows', 'wrong-folder']) it(`500 seguro para ruta almacenada ${kind}`, async () => {
    const outside = path.join(temp, 'outside.pdf');
    await writeFile(outside, Buffer.from('PRIVATE_TEST_VALUE'));
    fixture.path = kind === 'traversal' ? '../../outside.pdf' : kind === 'absolute' ? outside
      : kind === 'windows' ? 'C:\\private\\outside.pdf' : 'orders/receipts/' + fixture.filename;
    expectError(await request(app).get(endpoint), 'FILE_STORAGE_FAILED');
    expect(await readFile(outside, 'utf8')).to.equal('PRIVATE_TEST_VALUE');
  });
  it('rechaza junction/symlink de carpeta aunque apunte a un archivo existente', async () => {
    const directory = path.join(root, 'users/documents');
    const target = path.join(temp, 'elsewhere');
    await rename(directory, target);
    await symlink(target, directory, 'junction');
    links.push(directory);
    expectError(await request(app).get(endpoint), 'FILE_STORAGE_FAILED');
  });
  it('rechaza una carpeta en lugar de un archivo regular', async () => {
    await unlink(path.join(root, fixture.path));
    await mkdir(path.join(root, fixture.path));
    expectError(await request(app).get(endpoint), 'FILE_STORAGE_FAILED');
  });
  it('rechaza MIME manipulado en los metadatos con 500', async () => {
    fixture.mimeType = 'text/html';
    expectError(await request(app).get(endpoint), 'FILE_STORAGE_FAILED');
  });
  it('500 seguro ante fallo inesperado de consulta', async () => {
    doubles.replace(UploadedFile, 'findById', async () => { throw new Error(secret); });
    expectError(await request(app).get(endpoint), 'INTERNAL_ERROR');
  });
  async function handlePrototype() {
    const probe = await open(path.join(temp, 'probe'), 'w');
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    return prototype;
  }
  it('fallo de primera lectura: 500 JSON seguro y descriptor cerrado', async () => {
    const prototype = await handlePrototype();
    let observed;
    doubles.replace(prototype, 'read', async function () { observed = this; throw Object.assign(new Error(secret), { code: 'EIO' }); });
    const response = await request(app).get(endpoint);
    expectError(response, 'FILE_STORAGE_FAILED');
    expect(response.headers['content-disposition']).to.equal(undefined);
    expect(observed.fd).to.equal(-1);
  });
  it('fallo después de headers interrumpe el binario sin agregar JSON y cierra el descriptor', async () => {
    const bytes = Buffer.alloc(256 * 1024, 32);
    pdf.copy(bytes);
    await writeFile(path.join(root, fixture.path), bytes);
    const prototype = await handlePrototype();
    const read = prototype.read;
    let reads = 0, observed;
    doubles.replace(prototype, 'read', async function (...args) {
      observed = this;
      if (++reads > 1) { await new Promise(resolve => setTimeout(resolve, 30)); throw new Error(secret); }
      return read.apply(this, args);
    });
    const chunks = [];
    let failed;
    try {
      await request(app).get(endpoint).buffer(true).parse((res, callback) => {
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    } catch (error) { failed = error; }
    expect(failed).not.to.equal(undefined);
    const received = Buffer.concat(chunks);
    expect(received.length).to.be.greaterThan(0).and.lessThan(bytes.length);
    expect(received.toString()).not.to.include('"success":false');
    expect(events.filter(event => event.message === 'FILE_DOWNLOAD_STREAM_FAILED')).to.deep.equal([
      { level: 'error', message: 'FILE_DOWNLOAD_STREAM_FAILED' },
    ]);
    expect(observed.fd).to.equal(-1);
  });
  it('cancelación del cliente cierra el descriptor sin borrar el archivo asociado', async () => {
    const bytes = Buffer.alloc(1024 * 1024, 32);
    pdf.copy(bytes);
    await writeFile(path.join(root, fixture.path), bytes);
    const prototype = await handlePrototype();
    const read = prototype.read;
    let observed;
    doubles.replace(prototype, 'read', async function (...args) {
      observed = this;
      await new Promise(resolve => setTimeout(resolve, 10));
      return read.apply(this, args);
    });
    const server = createServer(app);
    servers.push(server);
    const operation = request(server).get(endpoint);
    let cancelled;
    try {
      await operation.buffer(true).parse((res, callback) => {
        res.once('data', () => operation.abort());
        res.on('end', () => callback(null, Buffer.alloc(0)));
      });
    } catch (error) { cancelled = error; }
    expect(cancelled).not.to.equal(undefined);
    for (let attempt = 0; attempt < 50 && observed.fd !== -1; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(observed.fd).to.equal(-1);
    expect(await readFile(path.join(root, fixture.path))).to.deep.equal(bytes);
  });
  it('no recibe rutas por query ni publica uploads mediante express.static', async () => {
    const response = await request(app).get(endpoint).query({ path: '../../private.pdf', filename: 'private.pdf' }).buffer(true).parse(binary).expect(200);
    expect(response.body).to.deep.equal(pdf);
    expectError(await request(app).get('/uploads/' + fixture.path), 'ROUTE_NOT_FOUND');
  });
  it('cancelación durante consulta cierra el archivo abierto después de desconectar', async () => {
    let release, observed;
    doubles.replace(UploadedFile, 'findById', () => new Promise(resolve => { release = resolve; }));
    const prototype = await handlePrototype();
    const read = prototype.read;
    doubles.replace(prototype, 'read', async function (...args) { observed = this; return read.apply(this, args); });
    const server = createServer(app);
    servers.push(server);
    const operation = request(server).get(endpoint);
    const completed = operation.then(() => undefined, error => error);
    for (let attempt = 0; attempt < 50 && !release; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(release).to.be.a('function');
    operation.abort();
    expect(await completed).not.to.equal(undefined);
    await new Promise(resolve => setTimeout(resolve, 20));
    release(fixture);
    for (let attempt = 0; attempt < 50 && observed?.fd !== -1; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(observed?.fd).to.equal(-1);
    expect(await readFile(path.join(root, fixture.path))).to.deep.equal(pdf);
  });
  it('dos raíces de almacenamiento no mezclan archivos con los mismos metadatos', async () => {
    const otherRoot = path.join(temp, 'other-storage');
    const otherApp = createApp({ uploadRoot: otherRoot });
    expectError(await request(otherApp).get(endpoint), 'FILE_NOT_FOUND');
    await mkdir(path.join(otherRoot, 'users/documents'), { recursive: true });
    const otherBytes = Buffer.from('%PDF-1.7\nOther root');
    await writeFile(path.join(otherRoot, fixture.path), otherBytes);
    expect((await request(otherApp).get(endpoint).buffer(true).parse(binary).expect(200)).body).to.deep.equal(otherBytes);
    expect((await request(app).get(endpoint).buffer(true).parse(binary).expect(200)).body).to.deep.equal(pdf);
  });
});
