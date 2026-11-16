import UploadedFile from '../models/UploadedFile.js';

export function create(data) {
  return UploadedFile.create(data);
}

export function findByOwner({ ownerModel, ownerId }) {
  return UploadedFile.find({ ownerModel, ownerId });
}

export function findById(id) {
  return UploadedFile.findById(id);
}
