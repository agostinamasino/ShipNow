import { ERROR_CATALOG } from '../errors/error.catalog.js';

function errorResponse(codes) {
  return {
    description: codes.map(code => `${code}: ${ERROR_CATALOG[code].message}`).join(' '),
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        examples: Object.fromEntries(codes.map(code => {
          const error = { code, message: ERROR_CATALOG[code].message };
          if (code === 'PRODUCT_VALIDATION_FAILED') error.details = { fields: ['price'] };
          if (code === 'USER_VALIDATION_FAILED') error.details = { fields: ['email'] };
          if (code === 'ORDER_VALIDATION_FAILED') error.details = { fields: ['userId'] };
          return [code, { value: { success: false, error } }];
        })),
      },
    },
  };
}

export default {
  InvalidJson: errorResponse(['INVALID_JSON']),
  PayloadTooLarge: errorResponse(['PAYLOAD_TOO_LARGE']),
  InternalError: errorResponse(['INTERNAL_ERROR']),
  FileBadRequest: errorResponse(['FILE_REQUIRED', 'FILE_INVALID_FIELD', 'FILE_INVALID_DOCUMENT_TYPE', 'FILE_INVALID_ENTITY_ID', 'FILE_INVALID_REQUEST', 'INVALID_JSON']),
  FileReadBadRequest: errorResponse(['FILE_INVALID_ENTITY_ID', 'INVALID_JSON']),
  FileTooLarge: errorResponse(['FILE_TOO_LARGE', 'PAYLOAD_TOO_LARGE']),
  FileInvalidType: errorResponse(['FILE_INVALID_TYPE']),
  FileEntityNotFound: errorResponse(['FILE_ENTITY_NOT_FOUND']),
  FileServerError: errorResponse(['FILE_STORAGE_FAILED', 'FILE_METADATA_PERSISTENCE_FAILED', 'INTERNAL_ERROR']),
  FileDownloadBadRequest: errorResponse(['FILE_INVALID_ID', 'INVALID_JSON']),
  FileDownloadNotFound: errorResponse(['FILE_NOT_FOUND', 'FILE_ENTITY_NOT_FOUND']),
  FileDownloadServerError: errorResponse(['FILE_STORAGE_FAILED', 'INTERNAL_ERROR']),
  ProductBadRequest: errorResponse(['PRODUCT_VALIDATION_FAILED', 'PRODUCT_INVALID_STATUS', 'INVALID_JSON']),
  UserBadRequest: errorResponse(['USER_VALIDATION_FAILED', 'USER_INVALID_ROLE', 'INVALID_JSON']),
  UserEmailConflict: errorResponse(['USER_EMAIL_ALREADY_EXISTS']),
  OrderBadRequest: errorResponse([
    'ORDER_VALIDATION_FAILED', 'ORDER_INVALID_STATUS', 'ORDER_INVALID_PRIORITY', 'ORDER_INVALID_USER_ROLE', 'INVALID_JSON',
  ]),
  OrderIdBadRequest: errorResponse(['ORDER_INVALID_ID', 'INVALID_JSON']),
  OrderUserNotFound: errorResponse(['ORDER_USER_NOT_FOUND']),
  OrderNotFound: errorResponse(['ORDER_NOT_FOUND']),
  MockBadRequest: errorResponse(['MOCK_INVALID_QTY', 'INVALID_JSON']),
  SeedBadRequest: errorResponse([
    'MOCK_INVALID_QTY', 'MOCK_INVALID_SEED_REQUEST', 'MOCK_INVALID_SEED_RELATIONS', 'INVALID_JSON',
  ]),
  SeedUnavailable: errorResponse(['MOCK_SEED_UNAVAILABLE']),
  RouteNotFound: errorResponse(['ROUTE_NOT_FOUND']),
};
