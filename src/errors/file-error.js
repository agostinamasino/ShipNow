import multer from 'multer';
import { AppError } from './app-error.js';
import { UploadInfrastructureError } from '../utils/upload-storage.js';

export function toFileError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof UploadInfrastructureError) {
    const code = ['FILE_INVALID_TYPE', 'FILE_TOO_LARGE', 'FILE_INVALID_DOCUMENT_TYPE'].includes(error.code)
      ? error.code : 'FILE_STORAGE_FAILED';
    return new AppError(code, { cause: error });
  }
  if (error instanceof multer.MulterError) {
    const code = error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE'
      : ['LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT'].includes(error.code) ? 'FILE_INVALID_FIELD'
        : ['LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_FIELD_COUNT', 'LIMIT_PART_COUNT',
          'MISSING_FIELD_NAME', 'INVALID_FIELD_NAME', 'LIMIT_FIELD_NESTING', 'LIMIT_FIELD_ARRAY_INDEX'].includes(error.code)
          ? 'FILE_INVALID_REQUEST' : undefined;
    if (code) return new AppError(code, { cause: error });
  }
  return error;
}

// Solamente para errores ocurridos al recibir multipart, no para fallos del service.
export function toUploadParserError(error) {
  const translated = toFileError(error);
  if (translated !== error) return translated;
  if (['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ENOTDIR', 'EROFS', 'ENOENT', 'EEXIST', 'EMFILE', 'ENFILE'].includes(error.code)) {
    return new AppError('FILE_STORAGE_FAILED', { cause: error });
  }
  if (['Multipart: Boundary not found', 'Unexpected end of form', 'Unexpected end of file', 'Malformed part header', 'Malformed content type'].includes(error.message)) {
    return new AppError('FILE_INVALID_REQUEST', { cause: error });
  }
  return error;
}
