import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { constants } from 'node:fs';
import { mkdir, lstat, open, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCUMENT_TYPES, FILE_MIME_TYPES, FILE_OWNERS, UPLOAD_POLICY } from '../constants/index.js';

// Errores internos de infraestructura. La futura capa HTTP los traducirá a AppError.
export class UploadInfrastructureError extends Error {
  constructor(code, cause) {
    super('No se pudo procesar el archivo.', { cause });
    this.code = code;
  }
}

const formats = Object.freeze({
  [FILE_MIME_TYPES.PDF]: Object.freeze({ extensions: Object.freeze(['.pdf']), extension: '.pdf', signature: Buffer.from('%PDF-') }),
  [FILE_MIME_TYPES.JPEG]: Object.freeze({ extensions: Object.freeze(['.jpg', '.jpeg']), extension: '.jpg', signature: Buffer.from([0xff, 0xd8, 0xff]) }),
  [FILE_MIME_TYPES.PNG]: Object.freeze({ extensions: Object.freeze(['.png']), extension: '.png', signature: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }),
});
const stagingNamePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.part$/;

export function normalizeOriginalName(value) {
  if (typeof value !== 'string') throw new UploadInfrastructureError('FILE_INVALID_TYPE');
  const name = path.posix.basename(value.replaceAll('\\', '/'))
    .normalize('NFC').replace(/[\x00-\x1f\x7f<>:"|?*]/g, '').trim();
  if (!name || name === '.' || name === '..' || name.length > 255) {
    throw new UploadInfrastructureError('FILE_INVALID_TYPE');
  }
  return name;
}

export function validateFileHeaders(originalName, mimeType) {
  const name = normalizeOriginalName(originalName);
  const format = Object.hasOwn(formats, mimeType) ? formats[mimeType] : undefined;
  if (!format || !format.extensions.includes(path.posix.extname(name).toLowerCase())) {
    throw new UploadInfrastructureError('FILE_INVALID_TYPE');
  }
  return { originalName: name, extension: format.extension };
}

export function createUploadStorage({ root = fileURLToPath(new URL('../../uploads/', import.meta.url)) } = {}) {
  const absoluteRoot = path.resolve(root);

  function absolute(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\')
      || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)
      || relative.split('/').some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..')) {
      throw new UploadInfrastructureError('FILE_UNSAFE_PATH');
    }
    const result = path.resolve(absoluteRoot, ...relative.split('/'));
    if (!result.startsWith(absoluteRoot + path.sep)) throw new UploadInfrastructureError('FILE_UNSAFE_PATH');
    return result;
  }

  async function check(relative) {
    const result = absolute(relative);
    // No seguir symlinks/junctions dentro de la raíz, incluso al eliminar.
    let current = absoluteRoot;
    for (const part of ['', ...relative.split('/')]) {
      if (part) current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink()) throw new UploadInfrastructureError('FILE_UNSAFE_PATH');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return result;
  }

  async function prepareDirectory(relative) {
    const target = await check(relative);
    await mkdir(target, { recursive: true });
    await check(relative);
    return target;
  }

  async function remove(relative) {
    const target = await check(relative);
    try { await unlink(target); }
    catch (cause) { if (cause.code !== 'ENOENT') throw new UploadInfrastructureError('FILE_CLEANUP_FAILED', cause); }
  }

  async function compensate(relative, operation) {
    try { return await operation(); }
    catch (cause) {
      try { await remove(relative); }
      catch (cleanup) { throw new UploadInfrastructureError('FILE_CLEANUP_FAILED', new AggregateError([cause, cleanup])); }
      throw cause;
    }
  }

  async function validate(file) {
    if (!file || !stagingNamePattern.test(file.filename)) throw new UploadInfrastructureError('FILE_UNSAFE_PATH');
    const relative = `staging/${file.filename}`;
    const { originalName, extension } = validateFileHeaders(file.originalname, file.mimetype);
    const target = await check(relative);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1) throw new UploadInfrastructureError('FILE_INVALID_TYPE');
      if (stat.size > UPLOAD_POLICY.maxSize) throw new UploadInfrastructureError('FILE_TOO_LARGE');
      const signature = formats[file.mimetype].signature;
      const bytes = Buffer.alloc(signature.length);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== signature.length || !bytes.equals(signature)) throw new UploadInfrastructureError('FILE_INVALID_TYPE');
      return { originalName, extension, size: stat.size, mimeType: file.mimetype };
    } finally { await handle.close(); }
  }

  async function promote(file, { ownerModel, documentType }) {
    if (!file || !stagingNamePattern.test(file.filename)) throw new UploadInfrastructureError('FILE_UNSAFE_PATH');
    const staged = `staging/${file.filename}`;
    try { return await compensate(staged, async () => {
      const allowed = ownerModel === FILE_OWNERS.USER
        ? [DOCUMENT_TYPES.IDENTITY, DOCUMENT_TYPES.ADDRESS_PROOF]
        : ownerModel === FILE_OWNERS.ORDER ? [DOCUMENT_TYPES.DELIVERY_PROOF] : [];
      if (!allowed.includes(documentType)) throw new UploadInfrastructureError('FILE_INVALID_DOCUMENT_TYPE');
      const metadata = await validate(file);
      const folder = ownerModel === FILE_OWNERS.USER ? 'users/documents' : 'orders/receipts';
      await prepareDirectory(folder);
      const filename = randomUUID() + metadata.extension;
      const relative = `${folder}/${filename}`;
      let linked = false;
      try {
        // En el mismo filesystem: publicación exclusiva, sin sobrescribir archivos.
        await link(await check(staged), await check(relative));
        linked = true;
        await remove(staged);
      } catch (cause) {
        if (linked) await remove(relative);
        throw new UploadInfrastructureError('FILE_STORAGE_FAILED', cause);
      }
      return {
        originalName: metadata.originalName, filename, path: relative,
        mimeType: metadata.mimeType, size: metadata.size, documentType, uploadedAt: new Date(),
      };
    }); } catch (cause) {
      if (cause instanceof UploadInfrastructureError) throw cause;
      throw new UploadInfrastructureError('FILE_STORAGE_FAILED', cause);
    }
  }

  async function openDownload(metadata) {
    let handle;
    try {
      const folder = metadata.ownerModel === FILE_OWNERS.USER ? 'users/documents'
        : metadata.ownerModel === FILE_OWNERS.ORDER ? 'orders/receipts' : undefined;
      if (!folder || typeof metadata.filename !== 'string'
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|jpg|png)$/.test(metadata.filename)
        || metadata.path !== `${folder}/${metadata.filename}`) {
        throw new UploadInfrastructureError('FILE_UNSAFE_PATH');
      }
      validateFileHeaders(metadata.filename, metadata.mimeType);
      handle = await open(await check(metadata.path), constants.O_RDONLY
        | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > UPLOAD_POLICY.maxSize) {
        throw new UploadInfrastructureError('FILE_STORAGE_FAILED');
      }
      const first = Buffer.alloc(Math.min(64 * 1024, stat.size));
      const { bytesRead } = await handle.read(first, 0, first.length, 0);
      if (!bytesRead) throw new UploadInfrastructureError('FILE_STORAGE_FAILED');
      // Primera lectura antes de enviar headers; el descriptor permanece abierto.
      const fileHandle = handle;
      let closed = false;
      async function close() {
        if (!closed) { closed = true; await fileHandle.close(); }
      }
      const stream = Readable.from((async function* () {
        try {
          yield first.subarray(0, bytesRead);
          let position = bytesRead;
          while (position < stat.size) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, stat.size - position));
            const result = await fileHandle.read(buffer, 0, buffer.length, position);
            if (!result.bytesRead) throw new UploadInfrastructureError('FILE_STORAGE_FAILED');
            position += result.bytesRead;
            yield buffer.subarray(0, result.bytesRead);
          }
        } finally { await close(); }
      })());
      // También cierra si la conexión termina antes de comenzar la iteración.
      stream.once('close', () => { close().catch(() => {}); });
      return { stream, size: stat.size, filename: metadata.filename, mimeType: metadata.mimeType };
    } catch (cause) {
      if (handle) await handle.close().catch(() => {});
      if (cause.code === 'ENOENT') throw new UploadInfrastructureError('FILE_NOT_FOUND', cause);
      throw new UploadInfrastructureError('FILE_STORAGE_FAILED', cause);
    }
  }

  return Object.freeze({
    prepareStaging: () => prepareDirectory('staging'),
    createStagingName: () => randomUUID() + '.part',
    validate, promote, remove, compensate, openDownload,
  });
}
