import { PAGINATION } from '../utils/pagination.js';
export const paginationParameters = [
  { name: 'page', in: 'query', description: 'Entero positivo, sin repeticiones ni arrays. (page - 1) × limit no puede superar 10000.', schema: { type: 'integer', minimum: 1, maximum: PAGINATION.maxSkip + 1, default: PAGINATION.page } },
  { name: 'limit', in: 'query', description: 'Cantidad máxima por página, sin repeticiones ni arrays.', schema: { type: 'integer', minimum: 1, maximum: PAGINATION.maxLimit, default: PAGINATION.limit } },
];
export function paginationMedia(schema, example) {
  const page = data => ({ data, pagination: { page: PAGINATION.page, limit: PAGINATION.limit, total: data.length, totalPages: Math.ceil(data.length / PAGINATION.limit) } });
  return { schema: { $ref: `#/components/schemas/${schema}` }, examples: { populated: { value: page([example]) }, empty: { value: page([]) } } };
}
export const paginationSchemas = {
  Pagination: { type: 'object', additionalProperties: false, required: ['page', 'limit', 'total', 'totalPages'], properties: {
    page: { type: 'integer', minimum: 1, maximum: PAGINATION.maxSkip + 1 }, limit: { type: 'integer', minimum: 1, maximum: PAGINATION.maxLimit }, total: { type: 'integer', minimum: 0 }, totalPages: { type: 'integer', minimum: 0 },
  } },
  ...Object.fromEntries([['ProductsPage', 'Product'], ['UsersPage', 'User'], ['OrdersPage', 'Order'], ['UploadedFilesPage', 'UploadedFile']].map(([name, item]) => [name, {
    type: 'object', additionalProperties: false, required: ['data', 'pagination'], properties: {
      data: { type: 'array', items: { $ref: `#/components/schemas/${item}` } }, pagination: { $ref: '#/components/schemas/Pagination' },
    },
  }])),
};
