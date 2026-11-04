import * as productRepository from '../repositories/product.repository.js';

function validationError(message) {
  const error = new Error(message);
  error.name = 'ProductValidationError';
  return error;
}

export function getProducts() {
  return productRepository.findAll();
}

export async function createProduct(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw validationError('Enviá un objeto JSON.');
  }

  // Solo se aceptan los campos de creación; el esquema conserva sus reglas y defaults.
  const { name, description, price, stock, status } = data;
  try {
    return await productRepository.create({ name, description, price, stock, status });
  } catch (error) {
    if (error.name === 'ValidationError') {
      throw validationError(error.message);
    }
    throw error;
  }
}
