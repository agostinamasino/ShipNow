import * as mockService from '../services/mock.service.js';

function preview(generate) {
  return (req, res) => {
    try {
      return res.json(generate(req.query.qty));
    } catch (error) {
      if (error.name === 'MockValidationError') {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'No se pudieron generar los datos simulados.' });
    }
  };
}

export const getMockUsers = preview(mockService.getMockUsers);
export const getMockCouriers = preview(mockService.getMockCouriers);
export const getMockOrders = preview(mockService.getMockOrders);
export const getMockDeliveries = preview(mockService.getMockDeliveries);
