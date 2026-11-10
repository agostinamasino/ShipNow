import * as productRepository from '../repositories/product.repository.js';
import { PRODUCT_STATUS } from '../constants/index.js';
import { AppError } from '../errors/app-error.js';

export function normalizeProductStatus(status) {
  if (status === true || status === undefined) return PRODUCT_STATUS.AVAILABLE;
  if (status === false) return PRODUCT_STATUS.OUT_OF_STOCK;
  if (!Object.values(PRODUCT_STATUS).includes(status)) {
    throw new AppError('PRODUCT_INVALID_STATUS');
  }
  return status;
}

export async function getProducts() {
  const products = await productRepository.findAll();
  return products.map(product => {
    try {
      return { ...product, status: normalizeProductStatus(product.status) };
    } catch (cause) {
      if (cause instanceof AppError && cause.code === 'PRODUCT_INVALID_STATUS') {
        throw new Error('Estado inválido en un producto almacenado.', { cause });
      }
      throw cause;
    }
  });
}

export async function createProduct(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('PRODUCT_VALIDATION_FAILED');
  }

  // Solo se aceptan los campos de creación; el esquema conserva sus reglas y defaults.
  const { name, description, price, stock, status } = data;
  try {
    return await productRepository.create({
      name, description, price, stock, status: normalizeProductStatus(status),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      throw new AppError('PRODUCT_VALIDATION_FAILED', {
        cause: error,
        details: { fields: Object.keys(error.errors ?? {}) },
      });
    }
    throw error;
  }
}
