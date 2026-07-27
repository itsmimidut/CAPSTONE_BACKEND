import express from 'express'
import {
    getAdminNotifications
} from '../controllers/adminNotificationController.js'
import { adminNotificationsLimiter } from '../middleware/rateLimiters.js'

const router = express.Router()

router.get('/notifications', adminNotificationsLimiter, getAdminNotifications)

export default router
