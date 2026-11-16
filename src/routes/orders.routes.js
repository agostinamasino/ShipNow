import { Router } from 'express';
import { getOrders, createOrder, getOrderById } from '../controllers/order.controller.js';

const router = Router();

router.get('/', getOrders);
router.post('/', createOrder);
router.get('/:id', getOrderById);

export default router;
