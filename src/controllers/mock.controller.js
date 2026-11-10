import * as mockService from '../services/mock.service.js';

function preview(generate) {
  return (req, res) => res.json(generate(req.query.qty));
}

export const getMockUsers = preview(mockService.getMockUsers);
export const getMockCouriers = preview(mockService.getMockCouriers);
export const getMockOrders = preview(mockService.getMockOrders);
export const getMockDeliveries = preview(mockService.getMockDeliveries);

export async function seedMocks(req, res) {
  const batch = await mockService.seedMocks(req.query.qty, req.body);
  return res.status(201).json(batch);
}
