import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import { mkdtemp, readdir, readFile, writeFile, rm, symlink, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUpload } from '../../src/config/multer.js';
import { createUploadStorage, normalizeOriginalName } from '../../src/utils/upload-storage.js';
import UploadedFile from '../../src/models/UploadedFile.js';
import { DOCUMENT_TYPES, FILE_MIME_TYPES, FILE_OWNERS, UPLOAD_POLICY } from '../../src/constants/index.js';

const samples = [
  ['sample.pdf', FILE_MIME_TYPES.PDF, Buffer.from('%PDF-1.7\nTest'), '.pdf'],
  ['sample.jpeg', FILE_MIME_TYPES.JPEG, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]), '.jpg'],
  ['sample.png', FILE_MIME_TYPES.PNG, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), '.png'],
];

describe('Infraestructura de uploads (sin endpoints productivos ni MongoDB)', () => {
  let root, upload, app;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'shipnow-uploads-'));
    upload = createUpload({ root });
    // Aplicación exclusiva de pruebas para ejercitar el parser real de Multer.
    app = express();
    app.post('/receive', upload.middleware, (req, res) => res.json({
      filename: req.file?.filename, body: req.body, size: req.file?.size,
    }));
    app.use((err, req, res, next) => res.status(400).json({ code: err.code }));
  });
  afterEach(async () => {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('shipnow-uploads-')) {
      throw new Error('Directorio temporal inesperado');
    }
    await rm(resolved, { recursive: true, force: true });
  });

  async function staged(buffer = samples[0][2], originalname = samples[0][0], mimetype = samples[0][1]) {
    await upload.storage.prepareStaging();
    const filename = upload.storage.createStagingName();
    await writeFile(path.join(root, 'staging', filename), buffer);
    return { filename, originalname, mimetype, size: 99999 };
  }
  async function expectCode(operation, code) {
    let caught;
    try { await operation(); } catch (error) { caught = error; }
    expect(caught?.code).to.equal(code);
  }

  it('constantes congeladas y política exacta', () => {
    for (const object of [DOCUMENT_TYPES, FILE_MIME_TYPES, FILE_OWNERS, UPLOAD_POLICY]) expect(Object.isFrozen(object)).to.equal(true);
    expect(UPLOAD_POLICY.maxSize).to.equal(5 * 1024 * 1024);
    expect(UPLOAD_POLICY).to.include({ fieldName: 'file', files: 1, fields: 1, parts: 2 });
  });
  it('crear fábricas e importar app no prepara uploads ni la raíz configurada', async () => {
    const missing = path.join(root, 'not-created');
    createUpload({ root: missing });
    expect(existsSync(missing)).to.equal(false);
    const realUploads = new URL('../../uploads/', import.meta.url);
    const before = existsSync(realUploads);
    await import('../../src/app.js');
    expect(existsSync(realUploads)).to.equal(before);
  });
  for (const [originalname, mimetype, buffer, extension] of samples) {
    it(`acepta ${mimetype}, valida firma y publica con UUID${extension}`, async () => {
      const file = await staged(buffer, originalname, mimetype);
      const metadata = await upload.storage.promote(file, { ownerModel: FILE_OWNERS.USER, documentType: DOCUMENT_TYPES.IDENTITY });
      expect(metadata.filename).to.match(new RegExp('^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\' + extension + '$'));
      expect(metadata.path).to.equal('users/documents/' + metadata.filename);
      expect(path.isAbsolute(metadata.path)).to.equal(false);
      expect(metadata).to.include({ originalName: originalname, size: buffer.length, mimeType: mimetype });
      expect(metadata.uploadedAt).to.be.instanceOf(Date);
      expect(await readFile(path.join(root, metadata.path))).to.deep.equal(buffer);
      expect(await readdir(path.join(root, 'staging'))).to.deep.equal([]);
    });
  }
  it('publica comprobantes de Order en su carpeta y compensa fallo de metadatos', async () => {
    const metadata = await upload.storage.promote(await staged(), { ownerModel: FILE_OWNERS.ORDER, documentType: DOCUMENT_TYPES.DELIVERY_PROOF });
    expect(metadata.path).to.equal('orders/receipts/' + metadata.filename);
    const original = new Error('Simulación de persistencia');
    let caught;
    try { await upload.storage.compensate(metadata.path, async () => { throw original; }); } catch (error) { caught = error; }
    expect(caught).to.equal(original);
    expect(existsSync(path.join(root, metadata.path))).to.equal(false);
  });
  it('nombres originales se normalizan pero no intervienen en rutas', () => {
    expect(normalizeOriginalName('C:\\private\\..\\comprobante.pdf')).to.equal('comprobante.pdf');
    expect(normalizeOriginalName('../../compro\n bante.pdf')).to.equal('compro bante.pdf');
    const names = new Set(Array.from({ length: 50 }, () => upload.storage.createStagingName()));
    expect(names.size).to.equal(50);
    for (const name of names) expect(name).to.match(/^[a-f0-9-]{36}\.part$/);
  });
  for (const [original, mime, content] of [
    ['fake.pdf', FILE_MIME_TYPES.PDF, Buffer.from('not PDF')],
    ['fake.png', FILE_MIME_TYPES.PNG, samples[0][2]],
    ['fake.jpg', FILE_MIME_TYPES.JPEG, Buffer.from('not JPEG')],
    ['wrong.png', FILE_MIME_TYPES.PDF, samples[0][2]],
    ['wrong.pdf', 'text/plain', samples[0][2]],
    ['empty.pdf', FILE_MIME_TYPES.PDF, Buffer.alloc(0)],
  ]) it(`rechaza ${original}/${mime} y limpia staging`, async () => {
    const file = await staged(content, original, mime);
    await expectCode(() => upload.storage.promote(file, { ownerModel: FILE_OWNERS.USER, documentType: DOCUMENT_TYPES.IDENTITY }), 'FILE_INVALID_TYPE');
    expect(await readdir(path.join(root, 'staging'))).to.deep.equal([]);
  });
  it('rechaza tipo documental incompatible y limpia staging', async () => {
    const file = await staged();
    await expectCode(() => upload.storage.promote(file, { ownerModel: FILE_OWNERS.USER, documentType: DOCUMENT_TYPES.DELIVERY_PROOF }), 'FILE_INVALID_DOCUMENT_TYPE');
    expect(await readdir(path.join(root, 'staging'))).to.deep.equal([]);
  });
  it('Multer acepta exactamente 5 MiB y rechaza un byte adicional sin residuos', async () => {
    const buffer = Buffer.alloc(UPLOAD_POLICY.maxSize, 32);
    samples[0][2].copy(buffer);
    const response = await request(app).post('/receive').attach('file', buffer, { filename: 'limit.pdf', contentType: FILE_MIME_TYPES.PDF }).expect(200);
    expect(response.body.size).to.equal(UPLOAD_POLICY.maxSize);
    await upload.storage.remove('staging/' + response.body.filename);
    const rejected = await request(app).post('/receive').attach('file', Buffer.concat([buffer, Buffer.from('x')]), { filename: 'large.pdf', contentType: FILE_MIME_TYPES.PDF }).expect(400);
    expect(rejected.body.code).to.equal('LIMIT_FILE_SIZE');
    expect(await readdir(path.join(root, 'staging'))).to.deep.equal([]);
  });
  it('validación de disco usa tamaño real, no metadata declarada', async () => {
    const buffer = Buffer.alloc(UPLOAD_POLICY.maxSize + 1);
    samples[0][2].copy(buffer);
    const file = await staged(buffer);
    file.size = 1;
    await expectCode(() => upload.storage.promote(file, { ownerModel: FILE_OWNERS.USER, documentType: DOCUMENT_TYPES.IDENTITY }), 'FILE_TOO_LARGE');
    expect(await readdir(path.join(root, 'staging'))).to.deep.equal([]);
  });
  for (const fileFirst of [false, true]) it(`multipart independiente del orden: archivo primero=${fileFirst}`, async () => {
    const operation = request(app).post('/receive');
    if (!fileFirst) operation.field('documentType', DOCUMENT_TYPES.IDENTITY);
    operation.attach('file', samples[0][2], { filename: 'document.pdf', contentType: FILE_MIME_TYPES.PDF });
    if (fileFirst) operation.field('documentType', DOCUMENT_TYPES.IDENTITY);
    const response = await operation.expect(200);
    expect(response.body.body).to.deep.equal({ documentType: DOCUMENT_TYPES.IDENTITY });
  });
  for (const mode of ['wrong-field', 'two-files', 'two-fields', 'large-field']) it(`Multer limita ${mode}`, async () => {
    const operation = request(app).post('/receive');
    operation.attach(mode === 'wrong-field' ? 'other' : 'file', samples[0][2], { filename: 'sample.pdf', contentType: FILE_MIME_TYPES.PDF });
    if (mode === 'two-files') operation.attach('file', samples[0][2], 'second.pdf');
    if (mode === 'two-fields') operation.field('a', 'a').field('b', 'b');
    if (mode === 'large-field') operation.field('documentType', 'x'.repeat(65));
    const response = await operation.expect(400);
    expect(['LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_COUNT', 'LIMIT_PART_COUNT', 'LIMIT_FIELD_VALUE']).to.include(response.body.code);
    if (existsSync(path.join(root, 'staging'))) expect(await readdir(path.join(root, 'staging'))).to.deep.equal([]);
  });
  it('rechaza MIME/extensión antes de almacenar', async () => {
    const response = await request(app).post('/receive').attach('file', Buffer.from('bad'), { filename: 'bad.exe', contentType: 'application/octet-stream' }).expect(400);
    expect(response.body.code).to.equal('FILE_INVALID_TYPE');
    expect(existsSync(path.join(root, 'staging'))).to.equal(false);
  });
  it('bloquea traversal y rutas absolutas sin borrar archivos externos', async () => {
    for (const relative of ['../outside', '/outside', 'C:\\outside', 'staging/../../outside', 'staging\\outside']) {
      await expectCode(() => upload.storage.remove(relative), 'FILE_UNSAFE_PATH');
    }
    await upload.storage.remove('staging/missing.part'); // Limpieza idempotente.
  });
  it('rechaza symlinks/junctions dentro de la raíz', async () => {
    await mkdir(path.join(root, 'target'));
    await symlink(path.join(root, 'target'), path.join(root, 'escape'), 'junction');
    try { await expectCode(() => upload.storage.remove('escape/file.pdf'), 'FILE_UNSAFE_PATH'); }
    finally { await unlink(path.join(root, 'escape')); }
  });
  it('fallo al preparar destino elimina el archivo temporal', async () => {
    const file = await staged();
    await writeFile(path.join(root, 'users'), 'not a directory');
    await expectCode(() => upload.storage.promote(file, { ownerModel: FILE_OWNERS.USER, documentType: DOCUMENT_TYPES.IDENTITY }), 'FILE_STORAGE_FAILED');
    expect(await readdir(path.join(root, 'staging'))).to.deep.equal([]);
  });
  it('fallos de limpieza se reportan conservando la causa original', async () => {
    await upload.storage.prepareStaging();
    const primary = new Error('failure');
    let error;
    try { await upload.storage.compensate('staging', async () => { throw primary; }); } catch (caught) { error = caught; }
    expect(error.code).to.equal('FILE_CLEANUP_FAILED');
    expect(error.cause.errors[0]).to.equal(primary);
  });
  it('modelo independiente valida referencias, índice, campos y fecha, sin bytes', async () => {
    const metadata = await upload.storage.promote(await staged(), { ownerModel: FILE_OWNERS.USER, documentType: DOCUMENT_TYPES.IDENTITY });
    const doc = new UploadedFile({ ...metadata, ownerModel: FILE_OWNERS.USER, ownerId: '507f1f77bcf86cd799439012' });
    await doc.validate();
    expect(UploadedFile.schema.path('ownerId').options.refPath).to.equal('ownerModel');
    expect(UploadedFile.schema.indexes()[0][0]).to.deep.equal({ ownerModel: 1, ownerId: 1, _id: 1 });
    expect(Object.keys(UploadedFile.schema.paths)).not.to.include('buffer');
    expect(doc.uploadedAt).to.be.instanceOf(Date);
    for (const patch of [{ ownerModel: 'Other' }, { ownerId: 'invalid' }, { size: -1 }, { size: 1.5 }, { size: UPLOAD_POLICY.maxSize + 1 }, { mimeType: 'text/plain' }, { mimeType: FILE_MIME_TYPES.PNG }, { path: '../escape' }, { documentType: DOCUMENT_TYPES.DELIVERY_PROOF }]) {
      let invalid = false;
      try { await new UploadedFile({ ...doc.toObject(), ...patch }).validate(); } catch { invalid = true; }
      expect(invalid, JSON.stringify(patch)).to.equal(true);
    }
    const defaults = new UploadedFile();
    expect(defaults.uploadedAt).to.be.instanceOf(Date);
    expect(upload.storage.createStagingName()).not.to.include(metadata.originalName);
  });
});
