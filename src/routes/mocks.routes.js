import { Router } from 'express';
import { getMockUsers, getMockCouriers, getMockOrders, getMockDeliveries } from '../controllers/mock.controller.js';

const router = Router();

router.get('/users', getMockUsers);
router.get('/couriers', getMockCouriers);
router.get('/orders', getMockOrders);
router.get('/deliveries', getMockDeliveries);

export default router;
