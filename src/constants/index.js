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
