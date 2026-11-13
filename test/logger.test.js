import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const realLogDirectory = fileURLToPath(new URL('../logs/', import.meta.url));
const hadRealLogs = existsSync(realLogDirectory);
const realLogFiles = hadRealLogs ? await readdir(realLogDirectory) : [];
const originalConfig = dotenv.config;
const originalEnv = { PORT: process.env.PORT, NODE_ENV: process.env.NODE_ENV, MONGODB_URI: process.env.MONGODB_URI };
dotenv.config = () => {
  Object.assign(process.env, { PORT: '3000', NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused' });
  return {};
};
let loggerModule;
try {
  loggerModule = await import('../src/config/logger.js');
} finally {
  dotenv.config = originalConfig;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
const { default: singleton, createAppLogger, LOG_LEVELS } = loggerModule;

after(async () => {
  singleton.close();
  assert.equal(existsSync(realLogDirectory), hadRealLogs);
  if (hadRealLogs) assert.deepEqual(await readdir(realLogDirectory), realLogFiles);
});

async function closeLogger(logger) {
  const completion = finished(logger, { readable: false });
  logger.end();
  await completion;
  logger.close();
}

async function isolatedLogger(t, nodeEnv) {
  const directory = await mkdtemp(join(tmpdir(), 'shipnow-logger-'));
  const stream = new PassThrough();
  let output = '';
  stream.on('data', data => { output += data.toString(); });
  const consoleTransport = new winston.transports.Stream({ stream });
  const logger = createAppLogger({ nodeEnv, logDirectory: directory, consoleTransport });
  t.after(async () => {
    if (!logger.writableFinished) await closeLogger(logger);
    stream.destroy();
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir(), 'shipnow-logger-')));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { logger, directory, consoleTransport, output: () => output };
}

async function records(directory, minimum) {
  // Espera el vaciado del stream de archivo, independiente del buffer del logger.
  for (let attempt = 0; attempt < 100; attempt++) {
    const files = (await readdir(directory)).filter(name => /^errors-.*\.log/.test(name));
    const text = (await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))).join('\n');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length >= minimum) return lines.map(line => JSON.parse(line));
    await delay(20);
  }
  assert.fail('El transporte no terminó de escribir los registros esperados.');
}

test('los seis niveles tienen el orden exacto y métodos reutilizables', () => {
  assert.deepEqual(LOG_LEVELS, { fatal: 0, error: 1, warning: 2, info: 3, http: 4, debug: 5 });
  assert.ok(Object.isFrozen(LOG_LEVELS));
  for (const level of Object.keys(LOG_LEVELS)) assert.equal(typeof singleton[level], 'function');
  assert.throws(() => createAppLogger({ nodeEnv: 'invalid' }), TypeError);
});

test('test mantiene el singleton silencioso sin archivos de rotación', () => {
  assert.equal(singleton.silent, true);
  assert.ok(singleton.transports.every(transport => !(transport instanceof DailyRotateFile)));
  singleton.info('Prueba silenciosa');
  singleton.fatal('Prueba silenciosa');
});

test('development muestra seis niveles legibles con color y guarda JSON sin color', async (t) => {
  const { logger, directory, output } = await isolatedLogger(t, 'development');
  for (const level of Object.keys(LOG_LEVELS)) logger[level](`Evento ${level}`);
  await closeLogger(logger);
  const consoleText = output();
  for (const level of Object.keys(LOG_LEVELS)) assert.ok(consoleText.includes(`Evento ${level}`));
  assert.match(consoleText, /\x1b\[/);
  assert.match(consoleText, /\d{4}-\d{2}-\d{2}T/);
  const stored = await records(directory, 2);
  assert.deepEqual(stored.map(record => record.level).sort(), ['error', 'fatal']);
  for (const record of stored) {
    assert.deepEqual(Object.keys(record).sort(), ['level', 'message', 'timestamp']);
    assert.ok(Number.isFinite(Date.parse(record.timestamp)));
    assert.ok(!record.level.includes('\x1b'));
  }
});

test('production conserva cinco niveles JSON y excluye debug', async (t) => {
  const { logger, directory, output } = await isolatedLogger(t, 'production');
  for (const level of Object.keys(LOG_LEVELS)) logger[level](`Evento ${level}`);
  await closeLogger(logger);
  const messages = output().trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(messages.map(record => record.level), ['fatal', 'error', 'warning', 'info', 'http']);
  assert.ok(!output().includes('debug'));
  assert.deepEqual((await records(directory, 2)).map(record => record.level).sort(), ['error', 'fatal']);
});

test('el archivo filtra exclusivamente error y fatal incluso si se amplía su umbral', async (t) => {
  const { logger, directory } = await isolatedLogger(t, 'test');
  const file = logger.transports.find(transport => transport instanceof DailyRotateFile);
  file.level = 'debug';
  for (const level of Object.keys(LOG_LEVELS)) logger[level](`Filtro ${level}`);
  await closeLogger(logger);
  const stored = await records(directory, 2);
  assert.deepEqual(stored.map(record => record.level).sort(), ['error', 'fatal']);
});

test('la rotación configura fecha diaria, tamaño y retención', async (t) => {
  const { logger, directory } = await isolatedLogger(t, 'test');
  const transport = logger.transports.find(transport => transport instanceof DailyRotateFile);
  assert.equal(transport.dirname, directory);
  assert.equal(transport.filename, 'errors-%DATE%.log');
  assert.equal(transport.options.datePattern, 'YYYY-MM-DD');
  assert.equal(transport.options.maxSize, '10m');
  assert.equal(transport.options.maxFiles, '14d');
  assert.equal(transport.level, 'error');
});

test('consola y archivos omiten metadata, errores, URI, emails y credenciales reconocibles', async (t) => {
  const { logger, directory, output } = await isolatedLogger(t, 'test');
  const secret = 'PRIVATE_CREDENTIAL';
  logger.error('Evento controlado', { password: secret, body: { name: secret }, document: { secret } });
  logger.error(new Error(secret));
  logger.error('Fallo controlado', new Error(secret));
  logger.error(`Conexión mongodb+srv://user:${secret}@host/db`);
  logger.error(`Correo ana.${secret}@example.com`);
  logger.error(`password=${secret}`);
  logger.error(`Bearer ${secret}`);
  logger.error(JSON.stringify({ password: secret }));
  await closeLogger(logger);
  const stored = await records(directory, 8);
  const text = JSON.stringify(stored) + output();
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes('mongodb+srv://'));
  assert.ok(!text.includes('@example.com'));
  assert.ok(!text.includes('stack'));
  for (const record of stored) assert.deepEqual(Object.keys(record).sort(), ['level', 'message', 'timestamp']);
});

test('fallos de transporte se reportan una vez con un texto seguro sin recursión', async (t) => {
  const { logger, consoleTransport } = await isolatedLogger(t, 'test');
  const write = t.mock.method(process.stderr, 'write', () => true);
  consoleTransport.emit('error', new Error('PRIVATE_TRANSPORT_ERROR'));
  logger.emit('error', new Error('PRIVATE_TRANSPORT_ERROR'));
  assert.equal(write.mock.callCount(), 1);
  assert.deepEqual(write.mock.calls[0].arguments, [
    'ShipNow: no se pudo escribir en un transporte de logging.\n',
  ]);
});
