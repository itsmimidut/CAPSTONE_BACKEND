import {
  applyLegacyConversion,
  getLegacyConversionCounts,
  getLegacyConversionDetail,
  listLegacyConversions,
  reopenLegacyConversion,
  revertLegacyConversion,
  saveLegacyConversionDraft,
  skipLegacyConversion,
} from '../services/inventoryLegacyConversionService.js'

const getReviewerId = (req) => Number(req?.user?.id ?? req?.user?.user_id ?? 0) || null

export const listQueue = async (req, res) => {
  try {
    const data = await listLegacyConversions({
      status: req.query.status || 'pending',
      category: req.query.category || '',
      search: req.query.search || '',
      page: req.query.page || 1,
      limit: req.query.limit || 20,
    })
    return res.json({ success: true, data })
  } catch (error) {
    console.error('legacy conversion list error:', error)
    return res.status(500).json({ success: false, message: 'Failed to load conversion queue.' })
  }
}

export const getCounts = async (_req, res) => {
  try {
    const data = await getLegacyConversionCounts()
    return res.json({ success: true, data })
  } catch (error) {
    console.error('legacy conversion counts error:', error)
    return res.status(500).json({ success: false, message: 'Failed to load conversion counts.' })
  }
}

export const getDetail = async (req, res) => {
  try {
    const data = await getLegacyConversionDetail(req.params.itemId)
    if (!data) return res.status(404).json({ success: false, message: 'Inventory item not found.' })
    return res.json({ success: true, data })
  } catch (error) {
    console.error('legacy conversion detail error:', error)
    return res.status(500).json({ success: false, message: 'Failed to load conversion preview.' })
  }
}

export const saveDraft = async (req, res) => {
  try {
    const result = await saveLegacyConversionDraft({
      itemId: req.params.itemId,
      sourceSnapshotHash: req.body?.source_snapshot_hash,
      reviewDraft: req.body?.review_draft || {},
      parserVersion: req.body?.parser_version,
      reviewerId: getReviewerId(req),
    })
    if (result.notFound) return res.status(404).json({ success: false, message: 'Inventory item not found.' })
    if (result.stale) {
      return res.status(409).json({
        success: false,
        code: 'CONVERSION_SOURCE_CHANGED',
        message: 'This item changed after the conversion preview was created. Refresh the preview before applying.',
      })
    }
    return res.json({ success: true, data: result })
  } catch (error) {
    console.error('legacy conversion draft error:', error)
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to save conversion draft.',
      errors: error.errors || undefined,
    })
  }
}

export const applyConversion = async (req, res) => {
  try {
    const result = await applyLegacyConversion({
      itemId: req.params.itemId,
      sourceSnapshotHash: req.body?.source_snapshot_hash,
      structuredDetails: req.body?.structured_details || {},
      description: req.body?.description || '',
      replaceDescription: Boolean(req.body?.replace_description),
      selectedFields: req.body?.selected_fields || {},
      notes: req.body?.notes || '',
      reviewerId: getReviewerId(req),
    })
    if (result.notFound) return res.status(404).json({ success: false, message: 'Inventory item not found.' })
    if (result.stale) {
      return res.status(409).json({
        success: false,
        code: 'CONVERSION_SOURCE_CHANGED',
        message: 'This item changed after the conversion preview was created. Refresh the preview before applying.',
      })
    }
    if (result.rejected) return res.status(422).json({ success: false, message: result.message })
    return res.json({ success: true, data: result })
  } catch (error) {
    console.error('legacy conversion apply error:', error)
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to apply conversion.',
      errors: error.errors || undefined,
    })
  }
}

export const skipConversion = async (req, res) => {
  try {
    await skipLegacyConversion({
      itemId: req.params.itemId,
      reason: req.body?.reason || '',
      reviewerId: getReviewerId(req),
    })
    return res.json({ success: true })
  } catch (error) {
    console.error('legacy conversion skip error:', error)
    return res.status(500).json({ success: false, message: 'Failed to skip conversion.' })
  }
}

export const reopenConversion = async (req, res) => {
  try {
    await reopenLegacyConversion({ itemId: req.params.itemId })
    return res.json({ success: true })
  } catch (error) {
    console.error('legacy conversion reopen error:', error)
    return res.status(500).json({ success: false, message: 'Failed to reopen conversion.' })
  }
}

export const revertConversion = async (req, res) => {
  try {
    const result = await revertLegacyConversion({
      itemId: req.params.itemId,
      reviewerId: getReviewerId(req),
    })
    if (result.notFound) return res.status(404).json({ success: false, message: 'Conversion record not found.' })
    if (result.conflict) return res.status(409).json({ success: false, code: result.code, message: result.message })
    return res.json({ success: true })
  } catch (error) {
    console.error('legacy conversion revert error:', error)
    return res.status(500).json({ success: false, message: 'Failed to revert conversion.' })
  }
}
