import { calculateBookingTotal } from '../services/reservationPricingService.js';
import { computeEntranceFeeForBookingItems } from '../services/entranceFeeService.js';
import { computeExtraPersonFeeForBookingItems } from '../services/extraPersonFeeService.js';

export const createPricingQuoteController = async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const entranceFeeResult = await computeEntranceFeeForBookingItems({
      items,
      defaultDate: items[0]?.check_in_date || items[0]?.booking_date || null,
    });

    if (!entranceFeeResult.success) {
      return res.status(400).json(entranceFeeResult);
    }
    const extraPersonFeeResult = await computeExtraPersonFeeForBookingItems({ items });

    const result = await calculateBookingTotal(items, {
      promo_id: body.promo_id,
      promo_code: body.promo_code,
      entrance_fee: entranceFeeResult.total,
      extra_person_fee: extraPersonFeeResult.total,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({
      success: true,
      data: {
        ...result.data,
        entrance_fee_breakdown: entranceFeeResult.breakdown,
        extra_person_fee_breakdown: extraPersonFeeResult.items,
      },
    });
  } catch (error) {
    console.error('Pricing quote error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate pricing quote.',
    });
  }
};
