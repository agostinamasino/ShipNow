import mongoose from 'mongoose';
import { DOCUMENT_TYPES, FILE_MIME_TYPES, FILE_OWNERS, UPLOAD_POLICY } from '../constants/index.js';

const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';

const uploadedFileSchema = new mongoose.Schema({
  ownerModel: { type: String, enum: Object.values(FILE_OWNERS), required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, refPath: 'ownerModel', required: true },
  originalName: { type: String, required: true, maxlength: 255 },
  filename: { type: String, required: true, match: new RegExp(`^${uuid}\\.(pdf|jpg|png)$`) },
  path: {
    type: String, required: true,
    match: new RegExp(`^(users/documents|orders/receipts)/${uuid}\\.(pdf|jpg|png)$`),
  },
  mimeType: { type: String, enum: Object.values(FILE_MIME_TYPES), required: true },
  size: { type: Number, required: true, min: 1, max: UPLOAD_POLICY.maxSize, validate: Number.isInteger },
  documentType: { type: String, enum: Object.values(DOCUMENT_TYPES), required: true },
  uploadedAt: { type: Date, default: Date.now, required: true },
});

uploadedFileSchema.pre('validate', function () {
  const allowed = this.ownerModel === FILE_OWNERS.USER
    ? [DOCUMENT_TYPES.IDENTITY, DOCUMENT_TYPES.ADDRESS_PROOF]
    : [DOCUMENT_TYPES.DELIVERY_PROOF];
  if (!allowed.includes(this.documentType)) this.invalidate('documentType', 'Tipo incompatible con la entidad.');
  const folder = this.ownerModel === FILE_OWNERS.USER ? 'users/documents' : 'orders/receipts';
  if (this.path !== `${folder}/${this.filename}`) this.invalidate('path', 'Ruta de archivo incompatible.');
  const extension = {
    [FILE_MIME_TYPES.PDF]: '.pdf', [FILE_MIME_TYPES.JPEG]: '.jpg', [FILE_MIME_TYPES.PNG]: '.png',
  }[this.mimeType];
  if (extension && !this.filename?.endsWith(extension)) this.invalidate('filename', 'Formato de archivo incompatible.');
});

uploadedFileSchema.index({ ownerModel: 1, ownerId: 1 });

export default mongoose.model('UploadedFile', uploadedFileSchema);
