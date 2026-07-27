/**
 * Sync bookings_daily from live bookings and optionally retrain the Prophet model.
 *
 * Usage:
 *   node scripts/sync-bookings-daily.mjs
 *   node scripts/sync-bookings-daily.mjs --no-retrain
 */
import { syncAndRetrainModel } from '../services/predictionTrainingService.js';

const retrain = !process.argv.includes('--no-retrain');

try {
  const result = await syncAndRetrainModel({ retrain });
  console.log('✅ bookings_daily sync complete');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  const detail = error?.message || error?.code || String(error);
  console.error('❌ Sync failed:', detail);
  process.exit(1);
}
