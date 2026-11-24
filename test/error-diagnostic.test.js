import { mockList } from '../test-support/pagination.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import request from 'supertest';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import logger, { createAppLogger } from '../src/config/logger.js';
import { diagnosticMetadata, DIAGNOSTIC_LIMITS } from '../src/config/error-diagnostic.js';
import { AppError } from '../src/errors/app-error.js';
import app from '../src/app.js';
import Product from '../src/models/Product.js';

async function isolated(t, nodeEnv = 'test') {
  const directory = await mkdtemp(path.join(tmpdir(), 'shipnow-diagnostic-'));
  const hadLogs = existsSync(new URL('../logs/', import.meta.url));
  const stream = new PassThrough();
  let output = '';
  stream.on('data', chunk => { output += chunk; });
  const instance = createAppLogger({ nodeEnv, logDirectory: directory, consoleTransport: new winston.transports.Stream({ stream }) });
  let closed = false;
  async function flush() {
    if (!closed) {
      closed = true;
      const done = finished(instance, { readable: false });
      instance.end(); await done; instance.close();
    }
    const records = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      records.length = 0;
      for (const file of (await readdir(directory)).filter(name => /^errors-.*\.log/.test(name))) {
        records.push(...(await readFile(path.join(directory, file), 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
      }
      if (records.length) return records;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return records;
  }
  t.after(async () => {
    await flush(); stream.destroy();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('shipnow-diagnostic-'));
    await rm(directory, { recursive: true, force: true });
    assert.equal(existsSync(new URL('../logs/', import.meta.url)), hadLogs);
  });
  return { instance, flush, output: () => output, directory };
}

test('diagnóstico conserva tipo, mensaje útil y frames originales relativos al proyecto', () => {
  const error = new TypeError('Fallo de lectura controlado');
  const { diagnostic } = diagnosticMetadata(error);
  assert.equal(diagnostic.name, 'TypeError');
  assert.equal(diagnostic.message, error.message);
  assert.match(diagnostic.stack, /<app>\/test\/error-diagnostic\.test\.js:\d+:\d+/);
  assert.ok(!diagnostic.stack.includes('file:///'));
  assert.ok(Object.isFrozen(diagnostic));
});

test('AppError conserva mensaje y stack de la causa sin copiar propiedades arbitrarias', () => {
  const cause = Object.assign(new Error('Fallo al confirmar la escritura'), { body: { password: 'SENSITIVE_BODY' }, document: Buffer.from('SENSITIVE_BYTES') });
  const error = new AppError('FILE_METADATA_PERSISTENCE_FAILED', { cause });
  const { diagnostic } = diagnosticMetadata(error);
  assert.equal(diagnostic.name, 'AppError');
  assert.equal(diagnostic.cause.message, cause.message);
  assert.match(diagnostic.cause.stack, /error-diagnostic\.test\.js/);
  assert.ok(!JSON.stringify(diagnostic).includes('SENSITIVE_'));
});

test('mensajes y stacks redactan credenciales, URI, tokens, correos, documentos y archivos', () => {
  const secrets = ['CREDENTIAL_VALUE', 'mail.person', 'FILE_PERSON', 'JWT_VALUE'];
  for (const message of [
    'Conexión mongodb+srv://user:CREDENTIAL_VALUE@private.example/db',
    'Fallo password="CREDENTIAL_VALUE with spaces"',
    'Fallo authorization=Bearer CREDENTIAL_VALUE',
    'Fallo Bearer CREDENTIAL_VALUE',
    'Fallo correo mail.person@example.com',
    'Fallo token=JWT_VALUE',
    'Validation failed: name: "FILE_PERSON"',
    'Fallo al abrir /private/FILE_PERSON.pdf',
    'Fallo {"body":{"secret":"CREDENTIAL_VALUE"}}',
  ]) {
    const error = new Error(message);
    const result = JSON.stringify(diagnosticMetadata(error));
    for (const secret of secrets) assert.ok(!result.includes(secret), message);
    assert.ok(!result.includes('mongodb+srv://'));
    assert.ok(!result.includes('@example.com'));
  }
});

test('causas cíclicas y AggregateError respetan límites de profundidad, nodos y longitud', () => {
  const base = new Error('Texto controlado '.repeat(10000));
  base.cause = base;
  const aggregate = new AggregateError(Array.from({ length: 20 }, () => new Error('Causa ' + 'x'.repeat(10000))), 'Fallaron varias operaciones', { cause: base });
  const { diagnostic } = diagnosticMetadata(aggregate);
  let text = 0, expanded = 0;
  function inspect(node, depth = 0) {
    if (node.truncated) return;
    expanded++;
    assert.ok(depth < DIAGNOSTIC_LIMITS.depth);
    assert.ok(node.message.length <= DIAGNOSTIC_LIMITS.message);
    assert.ok(node.stack.length <= DIAGNOSTIC_LIMITS.stack);
    text += node.message.length + node.stack.length;
    if (node.cause) inspect(node.cause, depth + 1);
    for (const item of node.errors ?? []) inspect(item, depth + 1);
  }
  inspect(diagnostic);
  assert.ok(expanded <= DIAGNOSTIC_LIMITS.nodes);
  assert.ok(text <= DIAGNOSTIC_LIMITS.total);
  assert.equal(diagnostic.cause.cause.truncated, true);
});

test('error y fatal persisten diagnósticos JSON útiles con mensaje y stack', async t => {
  const { instance, flush } = await isolated(t);
  instance.error('ERROR_DE_PRUEBA', diagnosticMetadata(new Error('Fallo de escritura controlado')));
  instance.fatal('FATAL_DE_PRUEBA', diagnosticMetadata(new RangeError('El servidor no pudo escuchar')));
  const records = await flush();
  assert.deepEqual(records.map(record => record.level), ['error', 'fatal']);
  assert.equal(records[0].diagnostic.message, 'Fallo de escritura controlado');
  assert.equal(records[1].diagnostic.name, 'RangeError');
  for (const record of records) {
    assert.match(record.diagnostic.stack, /error-diagnostic\.test\.js/);
    assert.ok(Number.isFinite(Date.parse(record.timestamp)));
    assert.deepEqual(Object.keys(record).sort(), ['diagnostic', 'level', 'message', 'timestamp']);
  }
});

test('niveles inferiores y metadata no confiable no incorporan diagnósticos ni archivos adicionales', async t => {
  const { instance, flush, output } = await isolated(t);
  for (const level of ['warning', 'info', 'http', 'debug']) instance[level]('NIVEL_INFERIOR', diagnosticMetadata(new Error('No persistir diagnóstico')));
  instance.error('EVENTO_CONTROLADO', { diagnostic: { message: 'SENSITIVE_FORGED', stack: 'SENSITIVE_FORGED' }, body: { password: 'SENSITIVE_BODY' } });
  const records = await flush();
  assert.equal(records.length, 1);
  assert.equal(records[0].diagnostic, undefined);
  assert.ok(!output().includes('SENSITIVE_'));
  for (const record of output().trim().split(/\r?\n/).map(line => JSON.parse(line))) assert.equal(record.diagnostic, undefined);
});

test('desarrollo muestra el diagnóstico saneado y conserva la rotación y filtro de niveles', async t => {
  const { instance, flush, output } = await isolated(t, 'development');
  const transport = instance.transports.find(item => item instanceof DailyRotateFile);
  assert.equal(transport.options.maxSize, '10m');
  assert.equal(transport.options.maxFiles, '14d');
  assert.equal(transport.options.datePattern, 'YYYY-MM-DD');
  instance.error('ERROR_LEGIBLE', diagnosticMetadata(new Error('Fallo legible')));
  await flush();
  assert.ok(output().includes('Fallo legible'));
  assert.ok(output().includes('<app>/test/error-diagnostic.test.js'));
});

test('un 500 conserva diagnóstico privado y un solo evento, sin modificar ni filtrar el JSON HTTP', async t => {
  const { instance, flush } = await isolated(t);
  const error = new Error('Fallo de almacenamiento controlado password=FAKE_PASSWORD');
  const failures = [], summaries = [];
  mockList(t.mock.method.bind(t.mock), Product, () => ({ lean: async () => { throw error; } }));
  t.mock.method(logger, 'error', (event, metadata) => { failures.push(event); instance.error(event, metadata); });
  t.mock.method(logger, 'http', event => summaries.push(event));
  const response = await request(app).get('/api/products').expect(500);
  assert.deepEqual(response.body, { success: false, error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' } });
  const records = await flush();
  assert.equal(failures.length, 1);
  assert.equal(summaries.length, 1);
  assert.equal(records.length, 1);
  assert.ok(records[0].diagnostic.message.includes('Fallo de almacenamiento controlado'));
  assert.match(records[0].diagnostic.stack, /error-diagnostic\.test\.js/);
  assert.ok(!JSON.stringify(records).includes('FAKE_PASSWORD'));
  assert.ok(!JSON.stringify(response.body).includes('stack'));
});

test('mensaje y stack de causa MongoDB permanecen útiles sin su URI ni credenciales', () => {
  class MongoNetworkError extends Error {}
  const cause = new MongoNetworkError('No se pudo conectar a mongodb://user:FAKE_PASSWORD@host/db');
  const diagnostic = diagnosticMetadata(new AppError('INTERNAL_ERROR', { cause })).diagnostic;
  assert.equal(diagnostic.cause.name, 'MongoNetworkError');
  assert.ok(diagnostic.cause.message.includes('No se pudo conectar'));
  assert.ok(diagnostic.cause.stack.includes('at '));
  assert.ok(!JSON.stringify(diagnostic).includes('FAKE_PASSWORD'));
});

test('causas no Error se omiten sin invocar serializadores de documentos o buffers', () => {
  let called = false;
  const error = new Error('Error controlado', { cause: { toJSON() { called = true; throw new Error('No serializar'); } } });
  const metadata = diagnosticMetadata(error);
  assert.equal(metadata.diagnostic.cause, undefined);
  assert.equal(diagnosticMetadata(Buffer.from('PRIVATE_DATA')).diagnostic, undefined);
  JSON.stringify(metadata);
  assert.equal(called, false);
});
