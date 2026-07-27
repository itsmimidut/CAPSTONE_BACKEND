/**
 * Returns the configured JWT secret.
 * Throws if the env var is missing or uses a known insecure placeholder.
 */
export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  const INSECURE_PLACEHOLDERS = [
    'your-secret-key',
    'your-jwt-secret-here',
    'change-this',
    'changeme',
    'secret',
  ];

  if (!secret || INSECURE_PLACEHOLDERS.some((p) => secret.toLowerCase().includes(p))) {
    throw new Error(
      'JWT_SECRET is not configured or is using an insecure placeholder. ' +
      'Set a strong random value in your .env file.'
    );
  }

  return secret;
};
