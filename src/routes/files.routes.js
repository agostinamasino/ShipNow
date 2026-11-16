import { Router } from 'express';
import { createUpload } from '../config/multer.js';
import { createFileController } from '../controllers/file.controller.js';
import { receiveUpload } from '../middlewares/upload.middleware.js';
import { FILE_OWNERS } from '../constants/index.js';

export function createFilesRouter({ root } = {}) {
  const router = Router();
  const upload = createUpload({ root });
  const controller = createFileController(upload.storage);
  const receive = receiveUpload(upload);
  router.post('/users/:id/documents', controller.validateEntity(FILE_OWNERS.USER), receive, controller.create);
  router.get('/users/:id/documents', controller.validateEntity(FILE_OWNERS.USER), controller.list);
  router.post('/orders/:id/receipts', controller.validateEntity(FILE_OWNERS.ORDER), receive, controller.create);
  router.get('/orders/:id/receipts', controller.validateEntity(FILE_OWNERS.ORDER), controller.list);
  router.get('/files/:fileId/download', controller.download);
  return router;
}
