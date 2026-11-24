import * as orderService from '../services/order.service.js';

export async function getOrders(req, res) {
  const orders = await orderService.getOrders(req.query);
  return res.json(orders);
}

export async function createOrder(req, res) {
  const order = await orderService.createOrder(req.body);
  return res.status(201).json(order);
}

export async function getOrderById(req, res) {
  const order = await orderService.getOrderById(req.params.id);
  return res.json(order);
}
