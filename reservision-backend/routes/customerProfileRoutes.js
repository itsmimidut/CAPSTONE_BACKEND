import express from 'express';
import {
  listAddresses,
  addAddress,
  updateAddressById,
  removeAddress,
  setAddressDefault,
  getNotificationPreferencesHandler,
  updateNotificationPreferencesHandler,
  listViewedOrders,
  addViewedOrder,
  getNotificationCounts,
} from '../controllers/customerProfileController.js';

const router = express.Router();

router.get('/addresses', listAddresses);
router.post('/addresses', addAddress);
router.put('/addresses/:id', updateAddressById);
router.delete('/addresses/:id', removeAddress);
router.patch('/addresses/:id/default', setAddressDefault);

router.get('/notification-preferences', getNotificationPreferencesHandler);
router.put('/notification-preferences', updateNotificationPreferencesHandler);

router.get('/viewed-orders', listViewedOrders);
router.post('/viewed-orders', addViewedOrder);

router.get('/notification-counts', getNotificationCounts);

export default router;
