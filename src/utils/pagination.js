import { AppError } from '../errors/app-error.js';

export const PAGINATION = Object.freeze({ page: 1, limit: 10, maxLimit: 100, maxSkip: 10000 });

export function parsePagination(query = {}) {
  const invalid = () => { throw new AppError('INVALID_PAGINATION'); };
  // Express usa query strings simples: rechazar también sintaxis de arrays/objetos.
  if (!query || typeof query !== 'object' || Array.isArray(query)) invalid();
  if (Object.keys(query).some(key => /^(page|limit)\[/.test(key))) invalid();
  function integer(key, fallback) {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) invalid();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) invalid();
    return number;
  }
  const page = integer('page', PAGINATION.page);
  const limit = integer('limit', PAGINATION.limit);
  const skip = (page - 1) * limit;
  if (limit > PAGINATION.maxLimit || !Number.isSafeInteger(skip) || skip > PAGINATION.maxSkip) invalid();
  return Object.freeze({ page, limit, skip });
}

export function paginated(data, total, { page, limit }) {
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
