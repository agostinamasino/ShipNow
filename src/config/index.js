import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

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

const config = Object.freeze({ port, mongodbUri, nodeEnv });

export default config;
