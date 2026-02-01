import express from 'express';
import * as chatbotController from '../controllers/chatbotController.js';
import * as groqController from '../controllers/chatbotControllerGroq.js';

const router = express.Router();

// Groq AI with Llama 3.3 (FAST & FREE!)
// Get API key: https://console.groq.com/keys
router.post('/chat/groq', groqController.chatWithGroq);
router.get('/chat/groq/test', groqController.testGroq);

// Pattern matching fallback (works without internet)
router.post('/chat', chatbotController.chat);
router.get('/stats', chatbotController.getStats);

export default router;
 