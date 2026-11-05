import { Router } from 'express';
import { getMockUsers, getMockCouriers, getMockOrders, getMockDeliveries, seedMocks } from '../controllers/mock.controller.js';

const router = Router();

router.get('/users', getMockUsers);
router.get('/couriers', getMockCouriers);
router.get('/orders', getMockOrders);
router.get('/deliveries', getMockDeliveries);
router.post('/seed', seedMocks);

export default router;
