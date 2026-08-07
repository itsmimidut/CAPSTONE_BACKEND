export const ALLOWED_CHANNELS = [
  'all',
  'reservation',
  'restaurant_pos',
  'eshop'
]

export const ALLOWED_TRANSACTION_STATUSES = [
  'all',
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
  'voided'
]

export const ALLOWED_PAYMENT_STATUSES = [
  'revenue',
  'all',
  'paid',
  'partially_refunded',
  'refunded',
  'pending',
  'failed',
  'expired'
]

export const ALLOWED_PAYMENT_METHODS = [
  'all',
  'cash',
  'gcash',
  'card',
  'bank_transfer',
  'other'
]

export const MAX_REPORT_RANGE_DAYS = 366
export const MAX_REPORT_SEARCH_LENGTH = 150

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const isValidDateString = (value) => {
  if (!DATE_PATTERN.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
  )
}

export const getDaysBetween = (dateFrom, dateTo) => {
  const [startYear, startMonth, startDay] = dateFrom.split('-').map(Number)
  const [endYear, endMonth, endDay] = dateTo.split('-').map(Number)
  const start = new Date(startYear, startMonth - 1, startDay)
  const end = new Date(endYear, endMonth - 1, endDay)
  return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1
}

export const inferChartPeriod = (dateFrom, dateTo) => {
  const diffDays = getDaysBetween(dateFrom, dateTo)
  if (diffDays <= 1) return 'day'
  if (diffDays <= 7) return 'week'
  if (diffDays <= 31) return 'month'
  return 'year'
}

export const validateSalesReportQuery = (query = {}) => {
  const dateFrom = query.date_from || query.dateFrom || ''
  const dateTo = query.date_to || query.dateTo || ''
  const channel = (query.channel || 'all').toLowerCase()
  const transactionStatus = (query.transaction_status || query.transactionStatus || 'all').toLowerCase()
  const paymentStatus = (query.payment_status || query.paymentStatus || 'revenue').toLowerCase()
  const paymentMethod = (query.payment_method || query.paymentMethod || 'all').toLowerCase()
  const search = typeof query.search === 'string' ? query.search.trim() : ''

  if (search.length > MAX_REPORT_SEARCH_LENGTH) {
    return { valid: false, message: `Search must not exceed ${MAX_REPORT_SEARCH_LENGTH} characters.` }
  }

  if (!dateFrom || !dateTo) {
    return { valid: false, message: 'Both date_from and date_to are required.' }
  }

  if (!isValidDateString(dateFrom)) {
    return { valid: false, message: 'Invalid start date.' }
  }

  if (!isValidDateString(dateTo)) {
    return { valid: false, message: 'Invalid end date.' }
  }

  if (getDaysBetween(dateFrom, dateTo) < 1) {
    return { valid: false, message: 'The start date cannot be later than the end date.' }
  }

  if (getDaysBetween(dateFrom, dateTo) > MAX_REPORT_RANGE_DAYS) {
    return { valid: false, message: `Date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days.` }
  }

  if (!ALLOWED_CHANNELS.includes(channel)) {
    return { valid: false, message: 'Invalid sales channel filter.' }
  }

  if (!ALLOWED_TRANSACTION_STATUSES.includes(transactionStatus)) {
    return { valid: false, message: 'Invalid transaction status filter.' }
  }

  if (!ALLOWED_PAYMENT_STATUSES.includes(paymentStatus)) {
    return { valid: false, message: 'Invalid payment status filter.' }
  }

  if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
    return { valid: false, message: 'Invalid payment method filter.' }
  }

  return {
    valid: true,
    filters: {
      dateFrom,
      dateTo,
      channel,
      transactionStatus,
      paymentStatus,
      paymentMethod,
      search,
      period: inferChartPeriod(dateFrom, dateTo)
    }
  }
}
