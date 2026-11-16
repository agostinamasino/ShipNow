import { expect } from 'chai';
import mongoose from 'mongoose';
import { existsSync, readdirSync } from 'node:fs';
import User from '../../src/models/User.js';
import Product from '../../src/models/Product.js';
import Order from '../../src/models/Order.js';
import Delivery from '../../src/models/Delivery.js';
import UploadedFile from '../../src/models/UploadedFile.js';
import { stubs } from './helpers.js';

const guards = stubs();
const logs = new URL('../../logs/', import.meta.url);
const snapshot = () => existsSync(logs) ? readdirSync(logs).sort() : null;
let beforeLogs;
let forbiddenAttempts = 0;
export const mochaHooks = {
  beforeAll() {
    beforeLogs = snapshot();
    const forbidden = () => {
      forbiddenAttempts++;
      throw new Error('Acceso real a MongoDB prohibido en pruebas funcionales');
    };
    guards.replace(mongoose, 'connect', forbidden);
    guards.replace(mongoose.Connection.prototype, 'openUri', forbidden);
    guards.replace(mongoose.connection, 'transaction', forbidden);
    for (const Model of [User, Product, Order, Delivery, UploadedFile]) {
      for (const method of ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'createIndex']) {
        guards.replace(Model.collection, method, forbidden);
      }
    }
  },
  afterAll() {
    guards.restore();
    expect(forbiddenAttempts).to.equal(0);
    expect(mongoose.connection.readyState).to.equal(0);
    expect(snapshot()).to.deep.equal(beforeLogs);
  },
};
