import User from '../models/User.js';

let emailIndexPromise;

function ensureEmailIndex() {
  if (!emailIndexPromise) {
    emailIndexPromise = User.collection.createIndex({ email: 1 }, { unique: true })
      .catch(() => {
        emailIndexPromise = undefined;
        // No confundir duplicados previos al crear el índice con el POST actual.
        throw new Error('No se pudo garantizar la unicidad del correo electrónico.');
      });
  }
  return emailIndexPromise;
}

export function findAll() {
  return User.find();
}

export function findByEmail(email) {
  return User.findOne({ email });
}

export async function create(data) {
  const user = new User(data);
  await user.validate();
  await ensureEmailIndex();
  return user.save();
}
