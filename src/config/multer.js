import multer from 'multer';
import { UPLOAD_POLICY } from '../constants/index.js';
import { createUploadStorage, validateFileHeaders } from '../utils/upload-storage.js';

export function createUpload({ root } = {}) {
  const storage = createUploadStorage({ root });
  const temporaryFiles = new WeakMap();
  const middleware = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        storage.prepareStaging().then(directory => callback(null, directory), callback);
      },
      filename(req, file, callback) {
        const filename = storage.createStagingName();
        const files = temporaryFiles.get(req) ?? [];
        files.push(filename);
        temporaryFiles.set(req, files);
        callback(null, filename);
      },
    }),
    limits: {
      fileSize: UPLOAD_POLICY.maxSize, files: UPLOAD_POLICY.files,
      fields: UPLOAD_POLICY.fields, parts: UPLOAD_POLICY.parts,
      fieldSize: UPLOAD_POLICY.fieldSize, fieldNameSize: UPLOAD_POLICY.fieldNameSize,
    },
    preservePath: false,
    fileFilter(req, file, callback) {
      try { validateFileHeaders(file.originalname, file.mimetype); callback(null, true); }
      catch (error) { callback(error); }
    },
  }).single(UPLOAD_POLICY.fieldName);
  return Object.freeze({ middleware, storage, temporaryFiles: req => temporaryFiles.get(req) ?? [] });
}
