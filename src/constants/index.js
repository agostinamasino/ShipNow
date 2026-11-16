export const PRODUCT_STATUS = Object.freeze({
  AVAILABLE: 'available',
  OUT_OF_STOCK: 'out_of_stock',
});

export const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  USER: 'user',
  COURIER: 'courier',
});

export const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  DELIVERED: 'delivered',
});

export const DELIVERY_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
});

export const ORDER_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
});

export const DOCUMENT_TYPES = Object.freeze({
  IDENTITY: 'identity',
  ADDRESS_PROOF: 'address_proof',
  DELIVERY_PROOF: 'delivery_proof',
});

export const FILE_MIME_TYPES = Object.freeze({
  PDF: 'application/pdf', JPEG: 'image/jpeg', PNG: 'image/png',
});

export const FILE_OWNERS = Object.freeze({ USER: 'User', ORDER: 'Order' });

export const UPLOAD_POLICY = Object.freeze({
  maxSize: 5 * 1024 * 1024,
  fieldName: 'file',
  files: 1, fields: 1, parts: 2, fieldSize: 64, fieldNameSize: 64,
});
