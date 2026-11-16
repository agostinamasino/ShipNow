import { AppError } from '../errors/app-error.js';
import { toUploadParserError } from '../errors/file-error.js';
import { cleanupFile } from '../services/file.service.js';

export function receiveUpload(upload) {
  return async (req, res, next) => {
    if (!req.is('multipart/form-data')) throw new AppError('FILE_INVALID_REQUEST');
    try {
      await new Promise((resolve, reject) => {
        upload.middleware(req, res, error => error ? reject(error) : resolve());
      });
    } catch (error) {
      // Multer puede retirar filename/path de req.file durante su propia limpieza.
      // Los nombres generados se conservan separados de los campos del cliente.
      for (const filename of upload.temporaryFiles(req)) {
        await cleanupFile(upload.storage, `staging/${filename}`);
      }
      return next(toUploadParserError(error));
    }
    return next();
  };
}
