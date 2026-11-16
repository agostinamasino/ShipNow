import { expect } from 'chai';
import { ERROR_CATALOG } from '../../src/errors/error.catalog.js';

export const id = '507f1f77bcf86cd799439011';
export const secret = 'PRIVATE_TEST_VALUE mongodb://private:password@invalid/database';

export function stubs() {
  const restore = [];
  return {
    replace(target, key, value) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, { configurable: true, writable: true, value });
      restore.push(() => descriptor ? Object.defineProperty(target, key, descriptor) : delete target[key]);
    },
    restore() { while (restore.length) restore.pop()(); },
  };
}

export function expectError(response, code, fields) {
  const { status, message } = ERROR_CATALOG[code];
  expect(response.status).to.equal(status);
  expect(response.headers['content-type']).to.match(/application\/json/);
  const error = { code, message };
  if (fields) error.details = { fields };
  expect(response.body).to.deep.equal({ success: false, error });
  expect(JSON.stringify(response.body)).not.to.include('PRIVATE_TEST_VALUE');
}
