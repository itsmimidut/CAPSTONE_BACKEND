import { body } from 'express-validator';

export const CHAT_MESSAGE_MAX_LENGTH = 1000;
export const CHAT_HISTORY_MAX_ITEMS = 5;
export const CHAT_HISTORY_CONTENT_MAX_LENGTH = 1000;

export const chatMessageValidators = [
  body('message')
    .exists({ checkNull: true })
    .withMessage('Message is required')
    .bail()
    .isString()
    .withMessage('Message must be a string')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ max: CHAT_MESSAGE_MAX_LENGTH })
    .withMessage(`Message must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`),
];

export const groqChatValidators = [
  ...chatMessageValidators,
  body('conversationHistory')
    .optional()
    .isArray({ max: CHAT_HISTORY_MAX_ITEMS })
    .withMessage(`Conversation history is limited to ${CHAT_HISTORY_MAX_ITEMS} messages`),
  body('conversationHistory.*.role')
    .optional()
    .isIn(['user', 'assistant'])
    .withMessage('Invalid conversation role'),
  body('conversationHistory.*.content')
    .optional()
    .isString()
    .withMessage('History message content must be a string')
    .isLength({ max: CHAT_HISTORY_CONTENT_MAX_LENGTH })
    .withMessage(`History messages must be at most ${CHAT_HISTORY_CONTENT_MAX_LENGTH} characters`),
];
