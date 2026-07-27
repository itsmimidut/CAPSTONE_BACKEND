import {
  resolveCustomerIdForUser,
  getAddressesForCustomer,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getNotificationPreferences,
  upsertNotificationPreferences,
  getViewedOrders,
  markOrderViewed,
  getCustomerNotificationCounts,
} from '../services/customerProfileService.js';

const resolveAuthenticatedCustomer = async (req, res) => {
  const userId = Number(req.user?.id);
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }

  const customerId = await resolveCustomerIdForUser(userId);
  if (!customerId) {
    res.status(404).json({ success: false, error: 'Customer profile not found' });
    return null;
  }

  return { userId, customerId };
};

const handleServiceError = (res, error, fallbackMessage) => {
  const statusCode = error?.statusCode || 500;
  if (statusCode >= 500) {
    console.error(fallbackMessage, error);
  }
  return res.status(statusCode).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
};

export const listAddresses = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const addresses = await getAddressesForCustomer(auth.customerId, auth.userId);
    return res.json({ success: true, addresses });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to load addresses');
  }
};

export const addAddress = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const address = await createAddress(auth.customerId, req.body || {});
    return res.status(201).json({ success: true, address });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to create address');
  }
};

export const updateAddressById = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const addressId = Number(req.params.id);
    if (!addressId) {
      return res.status(400).json({ success: false, error: 'Invalid address id' });
    }

    const address = await updateAddress(auth.customerId, addressId, req.body || {});
    return res.json({ success: true, address });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to update address');
  }
};

export const removeAddress = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const addressId = Number(req.params.id);
    if (!addressId) {
      return res.status(400).json({ success: false, error: 'Invalid address id' });
    }

    await deleteAddress(auth.customerId, addressId);
    return res.json({ success: true });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to delete address');
  }
};

export const setAddressDefault = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const addressId = Number(req.params.id);
    if (!addressId) {
      return res.status(400).json({ success: false, error: 'Invalid address id' });
    }

    await setDefaultAddress(auth.customerId, addressId);
    return res.json({ success: true });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to set default address');
  }
};

export const getNotificationPreferencesHandler = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const preferences = await getNotificationPreferences(auth.customerId);
    return res.json({ success: true, preferences });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to load notification preferences');
  }
};

export const updateNotificationPreferencesHandler = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const preferences = await upsertNotificationPreferences(auth.customerId, req.body || {});
    return res.json({ success: true, preferences });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to update notification preferences');
  }
};

export const listViewedOrders = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const viewedOrders = await getViewedOrders(auth.customerId);
    return res.json({
      success: true,
      viewedOrders: viewedOrders.map((item) => item.orderReference),
      items: viewedOrders,
    });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to load viewed orders');
  }
};

export const addViewedOrder = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const result = await markOrderViewed(auth.customerId, req.body?.orderReference);
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to mark order as viewed');
  }
};

export const getNotificationCounts = async (req, res) => {
  try {
    const auth = await resolveAuthenticatedCustomer(req, res);
    if (!auth) return;

    const counts = await getCustomerNotificationCounts(auth.customerId, auth.userId);
    return res.json({ success: true, counts });
  } catch (error) {
    return handleServiceError(res, error, 'Failed to load notification counts');
  }
};
