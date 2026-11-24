import * as fileService from '../services/file.service.js';
import { AppError } from '../errors/app-error.js';
import logger from '../config/logger.js';
import { diagnosticMetadata } from '../config/error-diagnostic.js';

export function createFileController(storage) {
  return {
    validateEntity(ownerModel) {
      return async (req, res, next) => {
        res.locals.fileOwner = await fileService.validateOwner(ownerModel, req.params.id);
        next();
      };
    },
    async create(req, res) {
      const file = await fileService.createFile(storage, res.locals.fileOwner, req.body, req.file);
      return res.status(201).json(file);
    },
    async list(req, res) {
      const files = await fileService.getFiles(res.locals.fileOwner, req.query);
      return res.json(files);
    },
    async download(req, res, next) {
      const file = await fileService.getDownload(storage, req.params.fileId);
      const { stream } = file;
      if (req.aborted || res.destroyed) {
        stream.destroy();
        return;
      }
      res.set({
        'Content-Type': file.mimeType,
        'Content-Length': String(file.size),
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'X-Content-Type-Options': 'nosniff',
      });
      const disconnected = () => stream.destroy();
      res.once('close', disconnected);
      stream.once('close', () => res.off('close', disconnected));
      stream.once('error', cause => {
        if (res.headersSent) {
          logger.error('FILE_DOWNLOAD_STREAM_FAILED', diagnosticMetadata(cause));
          res.destroy(); // Nunca agregar JSON a una respuesta binaria parcial.
        } else {
          for (const header of ['Content-Type', 'Content-Length', 'Content-Disposition', 'X-Content-Type-Options']) res.removeHeader(header);
          next(new AppError('FILE_STORAGE_FAILED', { cause }));
        }
      });
      stream.pipe(res);
    },
  };
}
