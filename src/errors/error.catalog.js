const entries = [
  ['INVALID_JSON', 'El cuerpo debe ser JSON válido.', 400],
  ['PAYLOAD_TOO_LARGE', 'El cuerpo de la solicitud supera el tamaño permitido.', 413],
  ['ROUTE_NOT_FOUND', 'La ruta solicitada no existe.', 404],
  ['PRODUCT_VALIDATION_FAILED', 'Revisá los campos del producto.', 400],
  ['PRODUCT_INVALID_STATUS', 'El estado del producto no es válido.', 400],
  ['USER_VALIDATION_FAILED', 'Revisá los campos del usuario.', 400],
  ['USER_INVALID_ROLE', 'El rol del usuario no es válido.', 400],
  ['USER_EMAIL_ALREADY_EXISTS', 'Ya existe un usuario con ese correo electrónico.', 409],
  ['ORDER_VALIDATION_FAILED', 'Revisá los campos del pedido.', 400],
  ['ORDER_INVALID_ID', 'El identificador del pedido no es válido.', 400],
  ['ORDER_INVALID_STATUS', 'El estado del pedido no es válido.', 400],
  ['ORDER_INVALID_PRIORITY', 'La prioridad del pedido no es válida.', 400],
  ['ORDER_INVALID_USER_ROLE', 'El pedido debe referenciar a un usuario con rol de cliente.', 400],
  ['ORDER_USER_NOT_FOUND', 'El usuario referenciado no existe.', 404],
  ['ORDER_NOT_FOUND', 'El pedido solicitado no existe.', 404],
  ['MOCK_INVALID_QTY', 'Revisá el rango de qty para esta operación.', 400],
  ['MOCK_INVALID_SEED_REQUEST', 'Revisá el formato y las cantidades del lote.', 400],
  ['MOCK_INVALID_SEED_RELATIONS', 'El lote no cumple las dependencias entre entidades.', 400],
  ['MOCK_SEED_UNAVAILABLE', 'El seed requiere una conexión MongoDB con soporte para transacciones.', 503],
  ['INTERNAL_ERROR', 'Error interno del servidor.', 500],
];

export const ERROR_CATALOG = Object.freeze(Object.fromEntries(
  entries.map(([code, message, status]) => [code, Object.freeze({ code, message, status })]),
));
