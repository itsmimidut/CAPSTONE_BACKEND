import db from '../config/db.js';
import { getForecastReadiness } from './predictionModelService.js';

const present = (value) => Boolean(String(value || '').trim());
const isPlaceholder = (value) => /your[-_ ]|change.?me|placeholder/i.test(String(value || ''));
const validJwtSecret = (value) => present(value)
  && !isPlaceholder(value)
  && !['secret', 'changeme'].includes(String(value).toLowerCase())
  && String(value).length >= 24;

export function assessProductionConfiguration(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const checks = {
    jwt: { configured: validJwtSecret(env.JWT_SECRET), required: true },
    frontend_origin: { configured: present(env.FRONTEND_URL || env.VITE_FRONTEND_URL), required: production },
    xendit_secret: { configured: present(env.XENDIT_SECRET_KEY) && !isPlaceholder(env.XENDIT_SECRET_KEY), required: production },
    xendit_webhook: { configured: present(env.XENDIT_WEBHOOK_TOKEN) && !isPlaceholder(env.XENDIT_WEBHOOK_TOKEN), required: production },
    email: { configured: Boolean((present(env.BREVO_API_KEY) && present(env.BREVO_FROM_EMAIL)) || (present(env.RESEND_API_KEY) && present(env.RESEND_FROM_EMAIL))), required: false },
  };
  const blocking = Object.entries(checks).filter(([, check]) => check.required && !check.configured).map(([key]) => key);
  return { ready: blocking.length === 0, environment: production ? 'production' : 'development', checks, blocking };
}

export async function getOperationalReadiness() {
  const configuration = assessProductionConfiguration();
  const components = {
    database: { ready: false },
    forecasting: { ready: false },
    configuration: { ready: configuration.ready },
  };
  try {
    await db.query('SELECT 1');
    components.database.ready = true;
  } catch (error) {
    components.database.code = error?.code || 'DATABASE_UNAVAILABLE';
  }
  try {
    const forecast = await getForecastReadiness();
    components.forecasting = {
      ready: forecast.safe_for_live_use === true,
      code: forecast.code,
      model_version: forecast.model?.model_version || null,
      freshness: forecast.model?.freshness || null,
      guest_mix_ready: forecast.model?.metadata?.guest_mix_ready === true,
    };
  } catch (error) {
    components.forecasting.code = error?.code || 'FORECAST_CHECK_FAILED';
  }
  const ready = Object.values(components).every((component) => component.ready);
  return {
    ready,
    status: ready ? 'ready' : 'not_ready',
    checked_at: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    components,
    configuration,
  };
}
