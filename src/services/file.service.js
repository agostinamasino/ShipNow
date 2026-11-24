import * as userRepository from '../repositories/user.repository.js';
import * as orderRepository from '../repositories/order.repository.js';
import * as fileRepository from '../repositories/file.repository.js';
import { FILE_OWNERS } from '../constants/index.js';
import { AppError } from '../errors/app-error.js';
import { toFileError } from '../errors/file-error.js';
import logger from '../config/logger.js';
import { diagnosticMetadata } from '../config/error-diagnostic.js';

function isObjectId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
}

export async function validateOwner(ownerModel, id) {
  if (!isObjectId(id)) throw new AppError('FILE_INVALID_ENTITY_ID');
  const entity = ownerModel === FILE_OWNERS.USER ? await userRepository.findById(id)
    : ownerModel === FILE_OWNERS.ORDER ? await orderRepository.findById(id) : undefined;
  if (!entity) throw new AppError('FILE_ENTITY_NOT_FOUND');
  return Object.freeze({ ownerModel, ownerId: id.toLowerCase() });
}

export async function cleanupFile(storage, relative) {
  if (!relative) return;
  try { await storage.remove(relative); }
  catch (error) { logger.error('FILE_CLEANUP_FAILED', diagnosticMetadata(error)); }
}

export async function discardTemporary(storage, file) {
  if (file?.filename) await cleanupFile(storage, `staging/${file.filename}`);
}

export async function createFile(storage, owner, body, file) {
  let metadata;
  try {
    if (!file) throw new AppError('FILE_REQUIRED');
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(field => field !== 'documentType') || Array.isArray(body.documentType)) {
      throw new AppError('FILE_INVALID_REQUEST');
    }
    if (typeof body.documentType !== 'string' || !body.documentType) throw new AppError('FILE_INVALID_DOCUMENT_TYPE');
    metadata = await storage.promote(file, { ownerModel: owner.ownerModel, documentType: body.documentType });
  } catch (error) {
    if (error.code === 'FILE_CLEANUP_FAILED') logger.error('FILE_CLEANUP_FAILED', diagnosticMetadata(error));
    else await discardTemporary(storage, file);
    throw toFileError(error);
  }

  let result;
  try {
    result = await fileRepository.create({ ...metadata, ...owner });
  } catch (cause) {
    await cleanupFile(storage, metadata.path);
    throw new AppError('FILE_METADATA_PERSISTENCE_FAILED', { cause });
  }
  // La asociación ya fue confirmada: ningún fallo posterior debe eliminar el archivo.
  logger.info(`FILE_UPLOAD_COMPLETED entity=${owner.ownerModel} documentType=${metadata.documentType} size=${metadata.size}`);
  return result;
}

export async function getFiles(owner) {
  const files = await fileRepository.findByOwner(owner);
  logger.debug(`FILES_LISTED entity=${owner.ownerModel} count=${files.length}`);
  return files;
}

export async function getDownload(storage, id) {
  if (!isObjectId(id)) throw new AppError('FILE_INVALID_ID');
  const file = await fileRepository.findById(id);
  if (!file) throw new AppError('FILE_NOT_FOUND');
  const ownerId = String(file.ownerId);
  if (!Object.values(FILE_OWNERS).includes(file.ownerModel) || !isObjectId(ownerId)) {
    throw new AppError('FILE_STORAGE_FAILED');
  }
  await validateOwner(file.ownerModel, ownerId);
  try { return await storage.openDownload(file); }
  catch (cause) {
    throw new AppError(cause.code === 'FILE_NOT_FOUND' ? 'FILE_NOT_FOUND' : 'FILE_STORAGE_FAILED', { cause });
  }
}
