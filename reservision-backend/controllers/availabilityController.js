import { checkAvailability, getAvailabilityCalendar } from '../services/availabilityService.js';

export const checkAvailabilityController = async (req, res) => {
  try {
    const result = await checkAvailability(req.body || {});
    const statusCode = result.success === false ? 400 : 200;
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Availability check error:', error);
    return res.status(500).json({
      success: false,
      available: false,
      reason: 'SERVER_ERROR',
      message: 'Failed to check availability.'
    });
  }
};

export const getAvailabilityCalendarController = async (req, res) => {
  try {
    const result = await getAvailabilityCalendar({
      category_type: req.query.category_type,
      inventory_item_id: req.query.inventory_item_id,
      month: req.query.month,
      year: req.query.year,
    });

    if (result.success === false) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error('Availability calendar error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load availability calendar.',
    });
  }
};
