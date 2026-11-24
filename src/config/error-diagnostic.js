import { fileURLToPath } from 'node:url';

export const DIAGNOSTIC_LIMITS = Object.freeze({ message: 512, stack: 4096, frames: 12, depth: 3, nodes: 5, total: 12000 });
const trusted = new WeakSet();
const rootUrl = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(rootUrl).replaceAll('\\', '/');

function redact(value) {
  return value
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s)]+/gi, '[URI omitida]')
    .replace(/\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/gi, '[correo omitido]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [omitido]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token omitido]')
    .replace(/\b(password|passwd|pwd|contraseña|secret|token|authorization|api[_-]?key)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi, '$1=[omitido]')
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, '[valor omitido]')
    .replace(/[\x00-\x1f\x7f\x1b]/g, ' ');
}

function messageFor(error) {
  const value = typeof error.message === 'string' ? error.message.slice(0, 32768) : '';
  // No intentar serializar consultas, documentos, valores de validación o nombres de archivos.
  if (/[\[{]|validation failed|Cast to |duplicate key|\.(pdf|jpe?g|png)\b/i.test(value)) return 'Detalle de datos omitido.';
  if (/^[A-Z0-9_=-]{12,}$/.test(value)) return 'Valor opaco omitido.';
  return redact(value).replace(/\b[A-Za-z]:[\\/][^\s]+|(?<![\w>])\/[^\s]+/g, '[ruta omitida]') || 'Sin mensaje disponible.';
}

export function diagnosticMetadata(error) {
  const visited = new WeakSet();
  let remainingNodes = DIAGNOSTIC_LIMITS.nodes;
  let remainingText = DIAGNOSTIC_LIMITS.total;
  function bounded(text, max) {
    const result = text.slice(0, Math.min(max, remainingText));
    remainingText -= result.length;
    return result;
  }
  function build(current, depth) {
    if (!(current instanceof Error)) return undefined;
    if (visited.has(current) || depth >= DIAGNOSTIC_LIMITS.depth || remainingNodes-- <= 0 || remainingText <= 0) {
      return Object.freeze({ truncated: true });
    }
    visited.add(current);
    const candidate = current.constructor?.name;
    const name = typeof candidate === 'string' && /^[A-Za-z][A-Za-z0-9.]{0,63}$/.test(candidate) ? candidate : 'Error';
    const message = bounded(messageFor(current), DIAGNOSTIC_LIMITS.message);
    const rawStack = typeof current.stack === 'string' ? current.stack.slice(0, 32768) : '';
    const frames = rawStack.split(/\r?\n/).slice(1).filter(line => /^\s+at\s/.test(line)).slice(0, DIAGNOSTIC_LIMITS.frames)
      .map(line => redact(line.replaceAll('\\', '/').replaceAll(rootUrl.href, '<app>/').replaceAll(rootPath, '<app>/'))
        .replace(/\b[A-Za-z]:\/[^\s)]+|(?<![\w>])\/[^\s)]+/g, '[ruta omitida]'));
    const node = { name, message, stack: bounded([`${name}: ${message}`, ...frames].join('\n'), DIAGNOSTIC_LIMITS.stack) };
    // Solo códigos de sistema reconocibles o códigos numéricos; nunca campos arbitrarios.
    if (typeof current.code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(current.code)) node.code = current.code;
    else if (Number.isSafeInteger(current.code)) node.code = current.code;
    const cause = build(current.cause, depth + 1);
    if (cause) node.cause = cause;
    if (current instanceof AggregateError && Array.isArray(current.errors)) {
      node.errors = Object.freeze(current.errors.slice(0, DIAGNOSTIC_LIMITS.nodes).map(item => build(item, depth + 1)).filter(Boolean));
    }
    return Object.freeze(node);
  }
  const diagnostic = build(error, 0);
  if (!diagnostic) return {};
  trusted.add(diagnostic);
  return { diagnostic };
}

export function privateDiagnostic(value) {
  return value && trusted.has(value) ? value : undefined;
}
