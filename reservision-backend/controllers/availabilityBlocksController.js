import {
  createAvailabilityBlock,
  deleteAvailabilityBlock,
  getAvailabilityBlockById,
  listAvailabilityBlocks,
  updateAvailabilityBlock,
} from '../services/availabilityBlockService.js';
import { AVAILABILITY_BLOCK_TYPES } from '../constants/availabilityBlockTypes.js';

export const listBlocksController = async (req, res) => {
  try {
    const data = await listAvailabilityBlocks({
      inventory_item_id: req.query.inventory_item_id,
      category_type: req.query.category_type,
      status: req.query.status,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('List availability blocks error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load availability blocks.' });
  }
};

export const getBlockController = async (req, res) => {
  try {
    const block = await getAvailabilityBlockById(Number(req.params.id));
    if (!block) {
      return res.status(404).json({ success: false, message: 'Block not found.' });
    }
    return res.json({ success: true, data: block });
  } catch (error) {
    console.error('Get availability block error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load availability block.' });
  }
};

export const createBlockController = async (req, res) => {
  try {
    const result = await createAvailabilityBlock(req.body || {}, req.user?.user_id || null);
    if (!result.success) {
      const status = ['BOOKING_CONFLICT', 'BLOCK_CONFLICT'].includes(result.reason) ? 409 : 400;
      return res.status(status).json(result);
    }
    return res.status(201).json(result);
  } catch (error) {
    console.error('Create availability block error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create availability block.' });
  }
};

export const updateBlockController = async (req, res) => {
  try {
    const result = await updateAvailabilityBlock(Number(req.params.id), req.body || {});
    if (!result.success) {
      const status = result.message === 'Block not found.' ? 404
        : ['BOOKING_CONFLICT', 'BLOCK_CONFLICT'].includes(result.reason) ? 409
          : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('Update availability block error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update availability block.' });
  }
};

export const deleteBlockController = async (req, res) => {
  try {
    const result = await deleteAvailabilityBlock(Number(req.params.id));
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('Delete availability block error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete availability block.' });
  }
};

export const getBlockTypesController = async (_req, res) => {
  return res.json({
    success: true,
    data: AVAILABILITY_BLOCK_TYPES,
  });
};
