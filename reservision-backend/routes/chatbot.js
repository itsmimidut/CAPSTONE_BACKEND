import express from 'express';
import * as chatbotController from '../controllers/chatbotController.js';
import * as groqController from '../controllers/chatbotControllerGroq.js';
import { authenticateToken } from '../middleware/authenticateToken.js';
import { requireAdmin } from '../middleware/authorize.js';
import { chatbotChatLimiter, chatbotGroqLimiter } from '../middleware/rateLimiters.js';
import { handleValidationErrors } from '../middleware/validate.js';
import {
  chatMessageValidators,
  groqChatValidators,
} from '../middleware/validators/chatbotValidators.js';

const router = express.Router();

router.post(
  '/chat/groq',
  chatbotGroqLimiter,
  groqChatValidators,
  handleValidationErrors,
  groqController.chatWithGroq,
);

router.get(
  '/chat/groq/test',
  authenticateToken,
  requireAdmin,
  groqController.testGroq,
);

router.post(
  '/chat',
  chatbotChatLimiter,
  chatMessageValidators,
  handleValidationErrors,
  chatbotController.chat,
);

router.get('/stats', chatbotController.getStats);

export default router;
