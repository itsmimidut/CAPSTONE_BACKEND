const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const average = (values) => (
  values.length
    ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length
    : 0
);

const daysUntil = (date, now) => Math.ceil(
  (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000,
);

const recommendation = ({
  code,
  title,
  description,
  reason,
  priority,
  applicableDates = [],
}) => ({
  code,
  title,
  description,
  reason,
  priority,
  applicable_dates: applicableDates,
});

export function computeForecastSummary(forecasts = []) {
  const rows = Array.isArray(forecasts) ? forecasts : [];
  if (!rows.length) {
    return {
      total_predicted_bookings: 0,
      total_predicted_guests: 0,
      average_daily_bookings: 0,
      average_daily_guests: 0,
      peak_date: null,
      peak_predicted_bookings: 0,
      peak_predicted_guests: 0,
    };
  }

  const totalBookings = rows.reduce(
    (sum, row) => sum + Number(row.predicted_bookings || 0),
    0,
  );
  const totalGuests = rows.reduce(
    (sum, row) => sum + Number(row.predicted_total_guests || 0),
    0,
  );
  const peak = rows.reduce((current, row) => {
    if (!current) return row;
    const rowBookings = Number(row.predicted_bookings || 0);
    const currentBookings = Number(current.predicted_bookings || 0);
    if (rowBookings !== currentBookings) {
      return rowBookings > currentBookings ? row : current;
    }
    return Number(row.predicted_total_guests || 0)
      > Number(current.predicted_total_guests || 0)
      ? row
      : current;
  }, null);

  return {
    total_predicted_bookings: Math.round(totalBookings),
    total_predicted_guests: Math.round(totalGuests),
    average_daily_bookings: round(totalBookings / rows.length),
    average_daily_guests: round(totalGuests / rows.length),
    peak_date: peak?.date || null,
    peak_predicted_bookings: Math.round(Number(peak?.predicted_bookings || 0)),
    peak_predicted_guests: Math.round(Number(peak?.predicted_total_guests || 0)),
  };
}

function aggregateGuestMix(forecasts) {
  const totals = {
    adults: 0,
    children: 0,
    seniors: 0,
    infants: 0,
    unknown_guests: 0,
  };
  let found = false;

  for (const row of forecasts) {
    const mix = row?.estimated_guest_mix;
    if (!mix || typeof mix !== 'object') continue;
    found = true;
    for (const key of Object.keys(totals)) {
      totals[key] += Number(mix[key] || 0);
    }
  }

  return found ? totals : null;
}

export function buildForecastRecommendations({
  forecasts = [],
  guestMix = {},
  recentBaselineAverage = 0,
  now = new Date().toISOString().slice(0, 10),
  lowRatio = 0.85,
  highRatio = 1.15,
  minimumLeadDays = 3,
  childrenShareThreshold = 0.3,
  childrenCountThreshold = 8,
  seniorShareThreshold = 0.25,
  seniorCountThreshold = 6,
} = {}) {
  const rows = (Array.isArray(forecasts) ? forecasts : [])
    .filter((row) => row?.date && row.date >= now);
  const result = {
    operations: [],
    promotions: [],
    activities: [],
    monitoring: [],
  };
  if (!rows.length) return result;

  const summary = computeForecastSummary(rows);
  const baseline = Math.max(0, Number(recentBaselineAverage || 0));
  const leadTimeDays = Math.max(0, daysUntil(rows[0].date, now));
  const ratio = baseline > 0
    ? summary.average_daily_bookings / baseline
    : null;
  const lowDates = rows
    .filter((row) => Number(row.predicted_bookings || 0) < baseline)
    .map((row) => row.date);
  const peakDates = rows
    .filter((row) => Number(row.predicted_bookings || 0) === summary.peak_predicted_bookings)
    .map((row) => row.date);
  const commonReason = {
    forecast_average_bookings: summary.average_daily_bookings,
    recent_baseline_average: round(baseline),
    lead_time_days: leadTimeDays,
    capacity_accounted_for: false,
  };

  if (baseline > 0 && ratio < lowRatio && leadTimeDays >= minimumLeadDays) {
    result.promotions.push(recommendation({
      code: 'LOW_DEMAND_RECOVERY',
      title: 'Review low-demand recovery offers',
      description: 'Expected bookings remain materially below the recent baseline.',
      reason: { ...commonReason, demand_ratio: round(ratio) },
      priority: 'medium',
      applicableDates: lowDates,
    }));
    result.operations.push(recommendation({
      code: 'LOW_DEMAND_STAFFING_REVIEW',
      title: 'Review staffing for quieter dates',
      description: 'Avoid overstaffing while preserving service coverage.',
      reason: { ...commonReason, demand_ratio: round(ratio) },
      priority: 'medium',
      applicableDates: lowDates,
    }));
  } else if (
    baseline > 0
    && (ratio > highRatio || summary.peak_predicted_bookings > baseline * 1.5)
  ) {
    result.operations.push(recommendation({
      code: 'HIGH_DEMAND_CAPACITY_REVIEW',
      title: 'Review staffing and operational capacity',
      description: 'Demand is forecast above the recent booking baseline.',
      reason: {
        ...commonReason,
        demand_ratio: round(ratio),
        peak_predicted_bookings: summary.peak_predicted_bookings,
        peak_predicted_guests: summary.peak_predicted_guests,
      },
      priority: 'high',
      applicableDates: peakDates,
    }));
    result.promotions.push(recommendation({
      code: 'HIGH_DEMAND_PROMOTION_HOLD',
      title: 'Avoid demand-driving promotions on peak dates',
      description: 'Review existing campaigns before adding demand to forecast peak dates.',
      reason: {
        ...commonReason,
        demand_ratio: round(ratio),
        peak_predicted_bookings: summary.peak_predicted_bookings,
      },
      priority: 'high',
      applicableDates: peakDates,
    }));
  } else {
    result.operations.push(recommendation({
      code: 'MODERATE_DEMAND_MONITOR',
      title: 'Maintain normal operating plans',
      description: baseline > 0
        ? 'Forecast demand is near the recent booking baseline.'
        : 'No reliable recent baseline is available for a high/low comparison.',
      reason: {
        ...commonReason,
        demand_ratio: ratio == null ? null : round(ratio),
        peak_predicted_bookings: summary.peak_predicted_bookings,
      },
      priority: 'low',
      applicableDates: peakDates,
    }));
  }

  if (guestMix?.ready === true) {
    const mix = aggregateGuestMix(rows);
    const knownTotal = mix
      ? mix.adults + mix.children + mix.seniors + mix.infants
      : 0;
    if (mix && knownTotal > 0 && leadTimeDays >= minimumLeadDays) {
      const childrenShare = mix.children / knownTotal;
      const seniorShare = mix.seniors / knownTotal;

      if (
        childrenShare >= childrenShareThreshold
        && mix.children >= childrenCountThreshold
      ) {
        result.activities.push(recommendation({
          code: 'FAMILY_ACTIVITY_REVIEW',
          title: 'Review family-friendly activity packages',
          description: 'Both the expected child share and absolute child count meet the configured thresholds.',
          reason: {
            predicted_children: Math.round(mix.children),
            children_share: round(childrenShare),
            required_count: childrenCountThreshold,
            required_share: childrenShareThreshold,
            lead_time_days: leadTimeDays,
          },
          priority: 'medium',
          applicableDates: rows.map((row) => row.date),
        }));
      }

      if (
        seniorShare >= seniorShareThreshold
        && mix.seniors >= seniorCountThreshold
      ) {
        result.activities.push(recommendation({
          code: 'SENIOR_ACCESSIBILITY_REVIEW',
          title: 'Review senior-friendly activities and accessibility',
          description: 'Both the expected senior share and absolute senior count meet the configured thresholds.',
          reason: {
            predicted_seniors: Math.round(mix.seniors),
            senior_share: round(seniorShare),
            required_count: seniorCountThreshold,
            required_share: seniorShareThreshold,
            lead_time_days: leadTimeDays,
          },
          priority: 'medium',
          applicableDates: rows.map((row) => row.date),
        }));
      }
    }
  } else {
    result.monitoring.push(recommendation({
      code: 'GUEST_MIX_UNAVAILABLE',
      title: 'Continue collecting reliable guest breakdowns',
      description: 'Demographic activity recommendations are disabled until guest-mix coverage is sufficient.',
      reason: {
        coverage_pct: Number(guestMix?.coverage_pct || 0),
        minimum_coverage_pct: Number(guestMix?.minimum_coverage_pct || 70),
      },
      priority: 'medium',
    }));
  }

  result.monitoring.push(recommendation({
    code: 'CAPACITY_NOT_INTEGRATED',
    title: 'Validate recommendations against live capacity',
    description: 'No verified room, pool, activity, or restaurant capacity was supplied to this recommendation run.',
    reason: { capacity_accounted_for: false },
    priority: 'medium',
    applicableDates: peakDates,
  }));

  return result;
}

export function toLegacyPromoSuggestion(recommendations = {}) {
  const ordered = [
    ...(recommendations.promotions || []),
    ...(recommendations.operations || []),
    ...(recommendations.activities || []),
    ...(recommendations.monitoring || []),
  ];
  const primary = ordered[0];
  if (!primary) {
    return {
      demand_level: 'N/A',
      headline: 'No suggestions available',
      description: 'No forecast recommendations were generated.',
      actions: [],
    };
  }

  const demandLevel = primary.code.startsWith('HIGH_')
    ? 'High'
    : primary.code.startsWith('LOW_')
      ? 'Low'
      : 'Medium';

  return {
    demand_level: demandLevel,
    headline: primary.title,
    description: primary.description,
    actions: ordered.slice(0, 5).map((item) => item.title),
  };
}
