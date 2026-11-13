import { fileURLToPath } from 'node:url';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import config from './index.js';

export const LOG_LEVELS = Object.freeze({
  fatal: 0,
  error: 1,
  warning: 2,
  info: 3,
  http: 4,
  debug: 5,
});

const colors = {
  fatal: 'bold red', error: 'red', warning: 'yellow',
  info: 'green', http: 'cyan', debug: 'blue',
};
const defaultLogDirectory = fileURLToPath(new URL('../../logs/', import.meta.url));

function safeMessage(message) {
  if (typeof message !== 'string') return 'Evento sin mensaje público.';
  // Los documentos serializados, trazas y mensajes de errores se omiten completos.
  if (/^\s*[\[{]|\bat\s+.+\(.+:\d+:\d+\)|(?:Error|Exception):/.test(message)) {
    return 'Detalle interno omitido.';
  }
  return message
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s]+/gi, '[URI omitida]')
    .replace(/\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/gi, '[correo omitido]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [omitido]')
    .replace(/\b(password|passwd|pwd|contraseña|secret|token|authorization|api[_-]?key)\b\s*[:=]\s*.*$/gi, '$1=[omitido]')
    .replace(/[\r\n\x00-\x1f\x7f\x1b]/g, ' ')
    .slice(0, 1000);
}

// Reconstruye cada evento para descartar metadata, documentos, causas y símbolos crudos.
const publicRecord = winston.format(info => ({
  level: info.level,
  message: safeMessage(info instanceof Error || typeof info.stack === 'string' ? undefined : info.message),
  [Symbol.for('level')]: info[Symbol.for('level')],
}));

const importantOnly = winston.format(info =>
  ['error', 'fatal'].includes(info[Symbol.for('level')]) ? info : false);

export function createAppLogger({ nodeEnv = config.nodeEnv, logDirectory, consoleTransport } = {}) {
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new TypeError('Entorno del logger inválido.');
  }

  let failureReported = false;
  function transportFailure() {
    if (failureReported) return;
    failureReported = true;
    // Salida independiente del logger para evitar recursión y mensajes del sistema.
    process.stderr.write('ShipNow: no se pudo escribir en un transporte de logging.\n');
  }

  const consoleOutput = consoleTransport ?? new winston.transports.Console();
  consoleOutput.level = nodeEnv === 'production' ? 'http' : 'debug';
  consoleOutput.format = nodeEnv === 'development'
    ? winston.format.combine(
      winston.format.colorize({ colors }),
      winston.format.printf(info => `${info.timestamp} ${info.level} ${info.message}`),
    )
    : winston.format.json();
  const transports = [consoleOutput];

  // En test solo se habilita el archivo si se proporciona una carpeta aislada.
  if (nodeEnv !== 'test' || logDirectory !== undefined) {
    try {
      transports.push(new DailyRotateFile({
        dirname: logDirectory ?? defaultLogDirectory,
        filename: 'errors-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '14d',
        level: 'error',
        format: winston.format.combine(importantOnly(), winston.format.json()),
      }));
    } catch {
      transportFailure();
    }
  }

  const logger = winston.createLogger({
    levels: LOG_LEVELS,
    level: nodeEnv === 'production' ? 'http' : 'debug',
    silent: nodeEnv === 'test' && !consoleTransport && logDirectory === undefined,
    format: winston.format.combine(publicRecord(), winston.format.timestamp()),
    transports,
    exitOnError: false,
  });
  logger.on('error', transportFailure);
  for (const transport of transports) transport.on('error', transportFailure);
  return logger;
}

export default createAppLogger();
