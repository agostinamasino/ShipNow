import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { LOG_LEVELS, DEFAULT_LOG_LEVELS } from './log-levels.js';

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  quiet: true,
});

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`La variable de entorno ${name} es obligatoria y no puede estar vacía.`);
  }
  return value;
}

const portValue = required('PORT');
const mongodbUri = required('MONGODB_URI');
const nodeEnv = required('NODE_ENV');
const port = Number(portValue);

if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('La variable PORT debe ser un número entero entre 1 y 65535.');
}

if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('La variable NODE_ENV debe ser development, test o production.');
}

if (!/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(mongodbUri)) {
  throw new Error('La variable MONGODB_URI debe utilizar un protocolo MongoDB válido (estándar o SRV).');
}

const logLevel = process.env.LOG_LEVEL === undefined
  ? DEFAULT_LOG_LEVELS[nodeEnv] : process.env.LOG_LEVEL.trim();
if (!Object.hasOwn(LOG_LEVELS, logLevel)) {
  throw new Error('La variable LOG_LEVEL debe ser fatal, error, warning, info, http o debug.');
}

const config = Object.freeze({ port, mongodbUri, nodeEnv, logLevel });

export default config;
