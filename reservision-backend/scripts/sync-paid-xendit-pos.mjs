/**
 * Sync POS transactions where Xendit invoice is PAID but local DB stayed PENDING (webhook missed).
 * Usage: node scripts/sync-paid-xendit-pos.mjs [receiptNo]
 */
import dotenv from 'dotenv';
import { syncPosTransactionByReceipt, syncRecentPendingPosTransactions } from '../services/posXenditSyncService.js';

dotenv.config();

const receiptNo = process.argv[2] ? String(process.argv[2]).trim() : null;

if (receiptNo) {
    const result = await syncPosTransactionByReceipt(receiptNo);
    console.log(`Receipt ${receiptNo}:`, result);
    process.exit(result.synced || result.reason === 'already_paid' ? 0 : 1);
}

const results = await syncRecentPendingPosTransactions(50);
if (!results.length) {
    console.log('No pending POS Xendit transactions to sync.');
    process.exit(0);
}

for (const row of results) {
    console.log(`Receipt ${row.receiptNo}:`, row);
}

const syncedCount = results.filter((row) => row.synced).length;
console.log(`Synced ${syncedCount} of ${results.length} pending transaction(s).`);
process.exit(syncedCount > 0 ? 0 : 1);
