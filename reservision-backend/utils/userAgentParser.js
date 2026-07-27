export const parseUserAgent = (userAgent = '') => {
  const ua = String(userAgent || '');

  let browser = 'Unknown Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let device = 'Desktop';
  if (/iPhone|iPad|iPod/i.test(ua)) device = 'iOS';
  else if (/Android/i.test(ua)) device = 'Android';
  else if (/Mobile/i.test(ua)) device = 'Mobile';

  return { device, browser };
};
