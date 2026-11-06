import { ERROR_CATALOG } from './error.catalog.js';

const validationFields = {
  PRODUCT_VALIDATION_FAILED: ['name', 'description', 'price', 'stock', 'status'],
  USER_VALIDATION_FAILED: ['name', 'email', 'role'],
};

export class AppError extends Error {
  constructor(code, { details, cause } = {}) {
    if (typeof code !== 'string' || !Object.hasOwn(ERROR_CATALOG, code)) {
      throw new TypeError('Código de error fuera del catálogo.');
    }
    const entry = ERROR_CATALOG[code];
    super(entry.message, { cause });
    this.name = 'AppError';
    this.code = entry.code;
    this.status = entry.status;

    const fields = Array.isArray(details?.fields)
      ? validationFields[code]?.filter(field => details.fields.includes(field))
      : undefined;
    Object.defineProperty(this, 'details', {
      value: fields?.length ? Object.freeze({ fields: Object.freeze(fields) }) : undefined,
    });
  }
}
