import express from 'express'
import {
  applyConversion,
  getCounts,
  getDetail,
  listQueue,
  reopenConversion,
  revertConversion,
  saveDraft,
  skipConversion,
} from '../controllers/inventoryLegacyConversionController.js'

const router = express.Router()

router.get('/', listQueue)
router.get('/counts', getCounts)
router.get('/:itemId', getDetail)
router.put('/:itemId/draft', saveDraft)
router.post('/:itemId/apply', applyConversion)
router.post('/:itemId/skip', skipConversion)
router.post('/:itemId/reopen', reopenConversion)
router.post('/:itemId/revert', revertConversion)

export default router
