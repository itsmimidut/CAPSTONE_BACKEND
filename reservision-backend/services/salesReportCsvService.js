const HEADERS = [
  'Transaction Date', 'Reference Number', 'Sales Channel', 'Customer Name', 'Description',
  'Payment Method', 'Transaction Status', 'Payment Status', 'Transaction Amount',
  'Gross Revenue', 'Refunded Amount', 'Net Revenue',
];

const protectFormula = (value) => {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

export const escapeCsvValue = (value) => `"${protectFormula(value).replace(/"/g, '""')}"`;

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-CA', { timeZone: 'Asia/Manila', hour12: false }).replace(',', '');
};

const money = (value) => Number(value || 0).toFixed(2);

export const buildTransactionCsv = (rows) => {
  const records = rows.map((row) => [
    formatDateTime(row.transaction_date), row.reference_number, row.sales_channel, row.customer_name,
    row.description, row.payment_method, row.transaction_status, row.payment_status,
    money(row.transaction_amount), money(row.gross_revenue), money(row.refunded_amount), money(row.net_revenue),
  ]);
  return `\uFEFF${[HEADERS, ...records].map((record) => record.map(escapeCsvValue).join(',')).join('\r\n')}`;
};
