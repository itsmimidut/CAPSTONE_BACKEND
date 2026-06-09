import express from 'express'
import {
    getAdminNotifications
} from '../controllers/adminNotificationController.js'

const router = express.Router()

router.get('/notifications', getAdminNotifications)

export default router
