import { getSalesReportTransactions } from './salesReportTransactionService.js';
import { approximatelyEqual, SALES_CHANNELS } from '../utils/salesReportConstants.js';

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const periodKey = (value, period) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  if (period === 'year') return `${parts.year}-${parts.month}`;
  if (period === 'day') return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00`;
  if (period === 'week') {
    const localDate = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
    const mondayOffset = (localDate.getUTCDay() + 6) % 7;
    localDate.setUTCDate(localDate.getUTCDate() - mondayOffset);
    return localDate.toISOString().slice(0, 10);
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const addGroup = (map, key, amount, count = 1) => {
  const normalized = key || 'Unknown';
  const current = map.get(normalized) || { amount: 0, count: 0 };
  current.amount = roundMoney(current.amount + Number(amount || 0));
  current.count += count;
  map.set(normalized, current);
};

export const summarizeSalesLedger = (transactions, {
  period = 'month',
  categoryItemRevenue = 0,
  unclassifiedItemAmount = 0,
  unclassifiedItemCount = 0,
} = {}) => {
  const channelMap = new Map();
  const paymentMap = new Map();
  const trendMap = new Map();
  const sourceMap = new Map();
  let grossSales = 0;
  let refundedAmount = 0;
  let ledgerNet = 0;
  let refundCount = 0;

  for (const row of transactions) {
    const gross = Number(row.gross_revenue || 0);
    const refund = Number(row.refunded_amount || 0);
    grossSales += gross;
    refundedAmount += refund;
    ledgerNet += Number(row.net_revenue ?? (gross - refund));
    if (refund > 0) refundCount += 1;
    addGroup(channelMap, row.sales_channel, gross);
    addGroup(paymentMap, row.payment_method || 'Unknown', gross);
    addGroup(sourceMap, row.record_source || 'unknown', gross);
    const key = periodKey(row.transaction_date, period);
    if (key) addGroup(trendMap, key, gross, 0);
  }

  grossSales = roundMoney(grossSales);
  refundedAmount = roundMoney(refundedAmount);
  const netSales = roundMoney(grossSales - refundedAmount);
  ledgerNet = roundMoney(ledgerNet);
  const channelSummary = [...channelMap.entries()].map(([channel, value]) => ({
    channel, revenue: value.amount, count: value.count,
    percent: grossSales ? Number(((value.amount / grossSales) * 100).toFixed(1)) : 0,
  }));
  const paymentSummary = [...paymentMap.entries()].map(([payment_method, value]) => ({
    payment_method, amount: value.amount, count: value.count,
  })).sort((a, b) => b.amount - a.amount);
  const salesOverTime = [...trendMap.entries()].map(([periodValue, value]) => ({ period: periodValue, sales: value.amount })).sort((a, b) => a.period.localeCompare(b.period));
  const sourceSummary = [...sourceMap.entries()].map(([source, value]) => ({ source, amount: value.amount, count: value.count }));
  const counts = Object.values(SALES_CHANNELS).reduce((out, channel) => ({ ...out, [channel]: channelMap.get(channel)?.count || 0 }), {});
  const channelTotal = roundMoney(channelSummary.reduce((sum, row) => sum + row.revenue, 0));
  const paymentMethodTotal = roundMoney(paymentSummary.reduce((sum, row) => sum + row.amount, 0));
  const transactionCount = transactions.length;
  const channelTransactionCount = channelSummary.reduce((sum, row) => sum + row.count, 0);
  const classifiedItemRevenue = roundMoney(categoryItemRevenue);
  const unknownItemRevenue = roundMoney(unclassifiedItemAmount);
  const totalItemRevenue = roundMoney(classifiedItemRevenue + unknownItemRevenue);
  const feesAndAdjustmentsAmount = roundMoney(grossSales - totalItemRevenue);

  return {
    transactions,
    summary: { grossSales, refundedAmount, netSales, totalTransactions: transactionCount, refundCount },
    transactionCounts: { ...counts, total: transactionCount },
    salesOverTime,
    channelSummary,
    paymentSummary,
    sourceSummary,
    reconciliation: {
      grossSales, channelTotal, paymentMethodTotal, ledgerGross: grossSales,
      categoryItemRevenue: classifiedItemRevenue,
      totalItemRevenue,
      unclassifiedAmount: unknownItemRevenue,
      unclassifiedCount: Number(unclassifiedItemCount || 0),
      unclassifiedItemAmount: unknownItemRevenue,
      unclassifiedItemCount: Number(unclassifiedItemCount || 0),
      feesAndAdjustmentsAmount,
      refundedAmount, netSales, ledgerNet, netDifference: roundMoney(netSales - ledgerNet), transactionCount, channelTransactionCount,
      isGrossReconciled: approximatelyEqual(grossSales, channelTotal),
      isPaymentReconciled: approximatelyEqual(grossSales, paymentMethodTotal),
      isTransactionCountReconciled: transactionCount === channelTransactionCount,
      isNetReconciled: approximatelyEqual(netSales, ledgerNet),
    },
  };
};

export const buildSalesReportLedger = async (filters, options = {}) => summarizeSalesLedger(
  await getSalesReportTransactions(filters),
  { period: filters.period, ...options },
);
