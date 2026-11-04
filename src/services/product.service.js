import * as productRepository from '../repositories/product.repository.js';
import { PRODUCT_STATUS } from '../constants/index.js';

function validationError(message) {
  const error = new Error(message);
  error.name = 'ProductValidationError';
  return error;
}

export function normalizeProductStatus(status) {
  if (status === true || status === undefined) return PRODUCT_STATUS.AVAILABLE;
  if (status === false) return PRODUCT_STATUS.OUT_OF_STOCK;
  if (!Object.values(PRODUCT_STATUS).includes(status)) {
    throw validationError(`status debe ser uno de: ${Object.values(PRODUCT_STATUS).join(', ')}.`);
  }
  return status;
}

export async function getProducts() {
  const products = await productRepository.findAll();
  return products.map(product => ({ ...product, status: normalizeProductStatus(product.status) }));
}

export async function createProduct(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw validationError('Enviá un objeto JSON.');
  }

  // Solo se aceptan los campos de creación; el esquema conserva sus reglas y defaults.
  const { name, description, price, stock, status } = data;
  try {
    return await productRepository.create({
      name, description, price, stock, status: normalizeProductStatus(status),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const fields = ['name', 'description', 'price', 'stock', 'status']
        .filter(field => error.errors?.[field]);
      throw validationError(`Datos de producto inválidos. Revisá los campos: ${fields.join(', ') || 'name, description, price, stock, status'}.`);
    }
    throw error;
  }
}
