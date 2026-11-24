import UploadedFile from '../models/UploadedFile.js';

export function create(data) {
  return UploadedFile.create(data);
}

export async function findByOwner({ ownerModel, ownerId }, { skip, limit }) {
  const filter = { ownerModel, ownerId };
  const [data, total] = await Promise.all([
    UploadedFile.find(filter).sort({ _id: 1 }).skip(skip).limit(limit),
    UploadedFile.countDocuments(filter),
  ]);
  return { data, total };
}

export function findById(id) {
  return UploadedFile.findById(id);
}
