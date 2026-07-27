import { webhookHandler } from '../controllers/xenditController.js';

/**
 * Phase 2 webhook entrypoint alias.
 * Delegates to the verified Xendit handler which routes POS vs booking invoices.
 */
export const handleXenditPaymentWebhook = async (req, res) => webhookHandler(req, res);
