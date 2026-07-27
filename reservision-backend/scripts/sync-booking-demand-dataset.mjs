import { syncBookingDemandDaily } from '../services/predictionTrainingService.js';
import { db } from '../config/db.js';

const includeConfirmedFallback = String(
  process.env.INCLUDE_CONFIRMED_FALLBACK || 'false'
).toLowerCase() === 'true';

try {
  const result = await syncBookingDemandDaily({ includeConfirmedFallback });
  console.log(JSON.stringify({ success: true, ...result }, null, 2));
  process.exitCode = 0;
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    code: error?.code || 'BOOKING_DEMAND_SYNC_FAILED',
    message: error?.message || 'Failed to build booking demand dataset',
    details: error?.details || null,
  }, null, 2));
  process.exitCode = 1;
} finally {
  await db.end();
}
