import { getOperationalReadiness } from '../services/operationalReadinessService.js';

const result = await getOperationalReadiness();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ready ? 0 : 2);
