import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../src/utils/server-lifecycle.js';
import { spawnSync } from 'node:child_process';
import { createAppLogger } from '../src/config/logger.js';

function fixture(t, { nodeEnv = 'production', connectError, disconnectError, closeError, pendingConnect, pendingClose, listenError, timeout = 1000 } = {}) {
  const events = [], calls = [];
  const runtime = new EventEmitter(); runtime.stderr = { write: text => calls.push(text) };
  runtime.exit = code => { calls.push(['exit', code]); runtime.exitCode = code; };
  const logger = new EventEmitter();
  for (const level of ['info', 'error', 'fatal']) logger[level] = (message, metadata) => events.push({ level, message, metadata });
  logger.end = () => { calls.push('end'); logger.writableEnded = true; queueMicrotask(() => { logger.writableFinished = true; logger.emit('finish'); }); };
  logger.close = () => calls.push('logger.close');
  const database = {
    async connect() { calls.push('connect'); if (pendingConnect) await pendingConnect; if (connectError) throw connectError; },
    async disconnect() { calls.push('disconnect'); if (disconnectError) throw disconnectError; },
  };
  const server = new EventEmitter();
  server.close = callback => { calls.push('server.close'); server.listening = false; if (pendingClose) pendingClose.then(() => callback(closeError)); else callback(closeError); };
  server.closeAllConnections = () => calls.push('force.close');
  const app = { listen(_port, callback) {
    calls.push('listen');
    queueMicrotask(() => { if (listenError) server.emit('error', listenError); else { server.listening = true; callback(); } });
    return server;
  } };
  const lifecycle = startServer({ app, database, logger, config: { nodeEnv, port: 3000, mongodbUri: 'mongodb://fake/unused' }, runtime, shutdownTimeoutMs: timeout });
  t.after(() => lifecycle.shutdown());
  return { ...lifecycle, calls, events, runtime, server, logger };
}

test('production espera MongoDB antes de escuchar', async t => {
  let release;
  const f = fixture(t, { pendingConnect: new Promise(resolve => { release = resolve; }) });
  await delay(0);
  assert.deepEqual(f.calls, ['connect']);
  release(); await f.ready;
  assert.deepEqual(f.calls, ['connect', 'listen']);
  assert.deepEqual(f.events.map(e => e.message), ['MONGODB_CONNECTED', 'SERVER_LISTENING']);
});

test('fallo inicial production: fatal privado, salida no cero y ningún listen', async t => {
  const f = fixture(t, { connectError: new TypeError('Falló conexión mongodb://u:FAKE_PASSWORD@host/db') });
  await f.ready;
  assert.equal(f.runtime.exitCode, 1);
  assert.ok(!f.calls.includes('listen'));
  assert.deepEqual(f.calls, ['connect', 'disconnect', 'end', 'logger.close']);
  assert.equal(f.events[0].level, 'fatal');
  assert.equal(f.events[0].metadata.diagnostic.name, 'TypeError');
  assert.match(f.events[0].metadata.diagnostic.stack, /server-lifecycle.test.js/);
  assert.ok(!JSON.stringify(f.events).includes('FAKE_PASSWORD'));
});

test('development escucha primero y continúa ante fallo inicial', async t => {
  const f = fixture(t, { nodeEnv: 'development', connectError: new Error('Conexión no disponible') });
  await f.ready; await delay(0);
  assert.deepEqual(f.calls, ['listen', 'connect']);
  assert.ok(f.server.listening);
  assert.deepEqual(f.events.map(e => [e.level, e.message]), [['info', 'SERVER_LISTENING'], ['error', 'MONGODB_CONNECTION_FAILED']]);
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal}: cierre único, recursos y listeners liberados`, async t => {
  const f = fixture(t); await f.ready;
  f.runtime.emit(signal); f.runtime.emit(signal);
  const closing = f.shutdown(); assert.equal(f.shutdown(), closing);
  await closing;
  assert.deepEqual(f.calls, ['connect', 'listen', 'server.close', 'disconnect', 'end', 'logger.close']);
  assert.equal(f.runtime.listenerCount('SIGINT'), 0);
  assert.equal(f.runtime.listenerCount('SIGTERM'), 0);
});

test('cierre espera solicitudes activas antes de desconectar MongoDB', async t => {
  let release;
  const f = fixture(t, { pendingClose: new Promise(resolve => { release = resolve; }) });
  await f.ready; const closing = f.shutdown(); await delay(0);
  assert.ok(f.calls.includes('server.close')); assert.ok(!f.calls.includes('disconnect'));
  release(); await closing;
});

test('SIGTERM durante conexión inicial no abre un puerto y cierra la conexión cuando termina', async t => {
  let release;
  const f = fixture(t, { pendingConnect: new Promise(resolve => { release = resolve; }) });
  await delay(0); f.runtime.emit('SIGTERM'); release();
  await f.ready; await f.shutdown();
  assert.ok(!f.calls.includes('listen'));
  assert.equal(f.calls.filter(c => c === 'disconnect').length, 1);
});

test('SIGINT durante listen pendiente cierra el servidor recién inicializado', async t => {
  const f = fixture(t, { nodeEnv: 'development' }); f.runtime.emit('SIGINT');
  await f.ready; await f.shutdown();
  assert.ok(!f.server.listening);
  assert.equal(f.calls.filter(c => c === 'server.close').length, 1);
});

test('fallos al cerrar servidor y MongoDB conservan diagnóstico y permiten cerrar logger', async t => {
  const f = fixture(t, { closeError: new Error('Fallo controlado de cierre'), disconnectError: new Error('Fallo de desconexión') });
  await f.ready; await f.shutdown();
  assert.equal(f.runtime.exitCode, 1);
  assert.ok(f.calls.includes('logger.close'));
  assert.deepEqual(f.events.filter(e => e.level === 'error').map(e => e.message), ['SERVER_CLOSE_FAILED', 'MONGODB_DISCONNECT_FAILED']);
  assert.ok(f.events.filter(e => e.level === 'error').every(e => e.metadata.diagnostic.stack));
});

test('fallo de listen conserva fatal y cierra recursos parciales', async t => {
  const f = fixture(t, { listenError: new Error('Puerto no disponible') }); await f.ready;
  assert.equal(f.runtime.exitCode, 1);
  assert.equal(f.events.filter(e => e.level === 'fatal').length, 1);
  assert.equal(f.events.find(e => e.level === 'fatal').message, 'SERVER_LISTEN_FAILED');
  assert.ok(f.calls.includes('disconnect'));
});

test('plazo máximo fuerza cierre y salida no cero sin bloquear indefinidamente', async t => {
  let release;
  const f = fixture(t, { timeout: 10, pendingClose: new Promise(resolve => { release = resolve; }) });
  await f.ready; const closing = f.shutdown(); await delay(30);
  assert.ok(f.calls.includes('force.close'));
  assert.ok(f.calls.some(c => Array.isArray(c) && c[0] === 'exit' && c[1] === 1));
  release(); await closing;
});

test('fallo al finalizar logger libera el transporte y marca salida no cero', async t => {
  const f = fixture(t); await f.ready;
  f.logger.end = () => { throw new Error('Fallo controlado del logger'); };
  await f.shutdown();
  assert.equal(f.runtime.exitCode, 1);
  assert.ok(f.calls.includes('logger.close'));
  assert.equal(f.events.filter(e => e.message === 'LOGGER_CLOSE_FAILED').length, 1);
});

test('configuración inválida impide escuchar y conectar en el punto de entrada', () => {
  const source = `
    import dotenv from 'dotenv'; import express from 'express'; import mongoose from 'mongoose';
    dotenv.config = () => ({});
    let listens = 0, connects = 0;
    express.application.listen = () => { listens++; throw new Error('No debe escuchar'); };
    mongoose.connect = () => { connects++; throw new Error('No debe conectar'); };
    try { await import('./src/server.js'); } catch (error) { console.log(JSON.stringify({ listens, connects, message: error.message })); process.exitCode = 1; }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, PORT: '0', NODE_ENV: 'production', MONGODB_URI: 'mongodb://fake/unused' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { listens: 0, connects: 0, message: 'La variable PORT debe ser un número entero entre 1 y 65535.' });
});

test('fallo productivo termina un proceso aislado con código 1 y fatal saneado', () => {
  const source = `
    import { EventEmitter } from 'node:events';
    import { startServer } from './src/utils/server-lifecycle.js';
    const events = [], logger = new EventEmitter();
    for (const level of ['info', 'error', 'fatal']) logger[level] = (message, metadata) => events.push({ level, message, metadata });
    logger.end = () => queueMicrotask(() => logger.emit('finish')); logger.close = () => {};
    const lifecycle = startServer({ app: { listen() { throw new Error('No debe escuchar'); } }, database: { async connect() { throw new Error('Conexión fallida mongodb://u:PRIVATE_PASSWORD@fake/db'); }, async disconnect() {} }, logger, config: { nodeEnv: 'production', port: 3000, mongodbUri: 'mongodb://fake/unused' } });
    await lifecycle.ready; console.log(JSON.stringify(events));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1, result.stderr);
  const events = JSON.parse(result.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].level, 'fatal');
  assert.ok(events[0].metadata.diagnostic.stack);
  assert.ok(!result.stdout.includes('PRIVATE_PASSWORD'));
});

test('cierre finaliza la instancia Winston real en test sin archivos', async () => {
  const logger = createAppLogger({ nodeEnv: 'test' });
  let finished = false;
  logger.once('finish', () => { finished = true; });
  const runtime = new EventEmitter(); runtime.exit = () => assert.fail('No debe agotar el plazo');
  const server = new EventEmitter(); server.listening = true;
  server.close = callback => { server.listening = false; callback(); };
  const lifecycle = startServer({ app: { listen(_port, callback) { queueMicrotask(callback); return server; } }, database: { async connect() {}, async disconnect() {} }, logger, runtime, config: { nodeEnv: 'production', port: 3000, mongodbUri: 'mongodb://fake/unused' } });
  await lifecycle.ready; await lifecycle.shutdown();
  assert.ok(finished);
  assert.equal(runtime.listenerCount('SIGTERM'), 0);
});
