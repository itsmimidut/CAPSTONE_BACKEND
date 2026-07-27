import { db } from '../config/db.js';

export const DEFAULT_RECEIPT_SETTINGS = {
  id: 1,
  store_name: "Eduardo's Resort",
  printed_logo: null,
  emailed_logo: null,
  header_text: 'Brgy. Nag-Iba II, Calapan City\nSitio Labasan\nTel# 099956391671',
  footer_text: 'This receipt is for inventory purposes only!\nThank you for Coming!',
  show_customer_info: 1,
  show_comments: 0,
  receipt_language: 'English',
  logo_alignment: 'center',
  store_name_style: 'bold',
  show_receipt_number: 1,
  show_datetime: 1,
  show_cashier: 1,
  show_station: 1,
  show_terminal: 0,
  show_payment_method: 1,
  show_reference_number: 1,
  show_discount_line: 1,
  show_tax_line: 0,
  show_change_line: 1,
  item_layout: 'compact',
  item_name_wrap: 1,
  text_size: 'normal',
  divider_style: 'dashed',
  default_preview_paper_width: '58',
  receipt_copies: 1,
  cut_paper_after_print: 1,
  open_cash_drawer_after_print: 0,
};

const BOOLEAN_COLUMNS = new Set([
  'show_customer_info',
  'show_comments',
  'show_receipt_number',
  'show_datetime',
  'show_cashier',
  'show_station',
  'show_terminal',
  'show_payment_method',
  'show_reference_number',
  'show_discount_line',
  'show_tax_line',
  'show_change_line',
  'item_name_wrap',
  'cut_paper_after_print',
  'open_cash_drawer_after_print',
]);

const ADVANCED_COLUMNS = [
  { name: 'logo_alignment', definition: "ENUM('left', 'center', 'right') DEFAULT 'center'" },
  { name: 'store_name_style', definition: "ENUM('normal', 'bold', 'large') DEFAULT 'bold'" },
  { name: 'show_receipt_number', definition: 'TINYINT DEFAULT 1' },
  { name: 'show_datetime', definition: 'TINYINT DEFAULT 1' },
  { name: 'show_cashier', definition: 'TINYINT DEFAULT 1' },
  { name: 'show_station', definition: 'TINYINT DEFAULT 1' },
  { name: 'show_terminal', definition: 'TINYINT DEFAULT 0' },
  { name: 'show_payment_method', definition: 'TINYINT DEFAULT 1' },
  { name: 'show_reference_number', definition: 'TINYINT DEFAULT 1' },
  { name: 'show_discount_line', definition: 'TINYINT DEFAULT 1' },
  { name: 'show_tax_line', definition: 'TINYINT DEFAULT 0' },
  { name: 'show_change_line', definition: 'TINYINT DEFAULT 1' },
  { name: 'item_layout', definition: "ENUM('compact', 'detailed') DEFAULT 'compact'" },
  { name: 'item_name_wrap', definition: 'TINYINT DEFAULT 1' },
  { name: 'text_size', definition: "ENUM('small', 'normal', 'large') DEFAULT 'normal'" },
  { name: 'divider_style', definition: "ENUM('dashed', 'solid', 'none') DEFAULT 'dashed'" },
  { name: 'default_preview_paper_width', definition: "ENUM('58', '80') DEFAULT '58'" },
  { name: 'receipt_copies', definition: 'INT DEFAULT 1' },
  { name: 'cut_paper_after_print', definition: 'TINYINT DEFAULT 1' },
  { name: 'open_cash_drawer_after_print', definition: 'TINYINT DEFAULT 0' },
];

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return Boolean(Number(value));
}

function mapReceiptSettingsRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeName: row.store_name,
    printedLogo: row.printed_logo,
    emailedLogo: row.emailed_logo,
    headerText: row.header_text,
    footerText: row.footer_text,
    showCustomerInfo: bool(row.show_customer_info, true),
    showComments: bool(row.show_comments, false),
    receiptLanguage: row.receipt_language || 'English',
    logoAlignment: row.logo_alignment || 'center',
    storeNameStyle: row.store_name_style || 'bold',
    showReceiptNumber: bool(row.show_receipt_number, true),
    showDatetime: bool(row.show_datetime, true),
    showCashier: bool(row.show_cashier, true),
    showStation: bool(row.show_station, true),
    showTerminal: bool(row.show_terminal, false),
    showPaymentMethod: bool(row.show_payment_method, true),
    showReferenceNumber: bool(row.show_reference_number, true),
    showDiscountLine: bool(row.show_discount_line, true),
    showTaxLine: bool(row.show_tax_line, false),
    showChangeLine: bool(row.show_change_line, true),
    itemLayout: row.item_layout || 'compact',
    itemNameWrap: bool(row.item_name_wrap, true),
    textSize: row.text_size || 'normal',
    dividerStyle: row.divider_style || 'dashed',
    defaultPreviewPaperWidth: row.default_preview_paper_width || '58',
    receiptCopies: Math.max(1, Math.min(5, Number(row.receipt_copies) || 1)),
    cutPaperAfterPrint: bool(row.cut_paper_after_print, true),
    openCashDrawerAfterPrint: bool(row.open_cash_drawer_after_print, false),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureAdvancedColumns() {
  for (const column of ADVANCED_COLUMNS) {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'receipt_settings'
         AND COLUMN_NAME = ?`,
      [column.name]
    );
    if (!rows.length) {
      await db.query(
        `ALTER TABLE receipt_settings ADD COLUMN ${column.name} ${column.definition}`
      );
    }
  }
}

export async function ensureReceiptSettingsSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS receipt_settings (
      id INT PRIMARY KEY DEFAULT 1,
      store_name VARCHAR(150) DEFAULT 'Reservision',
      printed_logo VARCHAR(255) DEFAULT NULL,
      emailed_logo VARCHAR(255) DEFAULT NULL,
      header_text TEXT DEFAULT NULL,
      footer_text TEXT DEFAULT NULL,
      show_customer_info TINYINT DEFAULT 1,
      show_comments TINYINT DEFAULT 0,
      receipt_language VARCHAR(50) DEFAULT 'English',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await ensureAdvancedColumns();
  await ensureDefaultReceiptSettings();
}

export async function ensureDefaultReceiptSettings() {
  const [rows] = await db.query('SELECT id FROM receipt_settings WHERE id = 1 LIMIT 1');
  if (rows.length) return;

  await db.query(
    `INSERT INTO receipt_settings (
      id, store_name, header_text, footer_text, show_customer_info, show_comments, receipt_language
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      DEFAULT_RECEIPT_SETTINGS.store_name,
      DEFAULT_RECEIPT_SETTINGS.header_text,
      DEFAULT_RECEIPT_SETTINGS.footer_text,
      DEFAULT_RECEIPT_SETTINGS.show_customer_info,
      DEFAULT_RECEIPT_SETTINGS.show_comments,
      DEFAULT_RECEIPT_SETTINGS.receipt_language,
    ]
  );
}

export async function getReceiptSettings() {
  await ensureReceiptSettingsSchema();
  const [rows] = await db.query('SELECT * FROM receipt_settings WHERE id = 1 LIMIT 1');
  return mapReceiptSettingsRow(rows[0]) || mapReceiptSettingsRow({
    id: 1,
    ...DEFAULT_RECEIPT_SETTINGS,
  });
}

function normalizeEnum(value, allowed, fallback) {
  const v = String(value || '').toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

export async function updateReceiptSettings(data = {}) {
  await ensureReceiptSettingsSchema();

  const fields = [];
  const values = [];

  const mapping = {
    storeName: 'store_name',
    printedLogo: 'printed_logo',
    emailedLogo: 'emailed_logo',
    headerText: 'header_text',
    footerText: 'footer_text',
    showCustomerInfo: 'show_customer_info',
    showComments: 'show_comments',
    receiptLanguage: 'receipt_language',
    logoAlignment: 'logo_alignment',
    storeNameStyle: 'store_name_style',
    showReceiptNumber: 'show_receipt_number',
    showDatetime: 'show_datetime',
    showCashier: 'show_cashier',
    showStation: 'show_station',
    showTerminal: 'show_terminal',
    showPaymentMethod: 'show_payment_method',
    showReferenceNumber: 'show_reference_number',
    showDiscountLine: 'show_discount_line',
    showTaxLine: 'show_tax_line',
    showChangeLine: 'show_change_line',
    itemLayout: 'item_layout',
    itemNameWrap: 'item_name_wrap',
    textSize: 'text_size',
    dividerStyle: 'divider_style',
    defaultPreviewPaperWidth: 'default_preview_paper_width',
    receiptCopies: 'receipt_copies',
    cutPaperAfterPrint: 'cut_paper_after_print',
    openCashDrawerAfterPrint: 'open_cash_drawer_after_print',
  };

  Object.entries(mapping).forEach(([inputKey, column]) => {
    if (data[inputKey] === undefined) return;

    fields.push(`${column} = ?`);

    if (BOOLEAN_COLUMNS.has(column)) {
      values.push(data[inputKey] ? 1 : 0);
      return;
    }

    if (inputKey === 'printedLogo' || inputKey === 'emailedLogo') {
      values.push(data[inputKey] ? String(data[inputKey]).trim() : null);
      return;
    }

    if (inputKey === 'logoAlignment') {
      values.push(normalizeEnum(data[inputKey], ['left', 'center', 'right'], 'center'));
      return;
    }
    if (inputKey === 'storeNameStyle') {
      values.push(normalizeEnum(data[inputKey], ['normal', 'bold', 'large'], 'bold'));
      return;
    }
    if (inputKey === 'itemLayout') {
      values.push(normalizeEnum(data[inputKey], ['compact', 'detailed'], 'compact'));
      return;
    }
    if (inputKey === 'textSize') {
      values.push(normalizeEnum(data[inputKey], ['small', 'normal', 'large'], 'normal'));
      return;
    }
    if (inputKey === 'dividerStyle') {
      values.push(normalizeEnum(data[inputKey], ['dashed', 'solid', 'none'], 'dashed'));
      return;
    }
    if (inputKey === 'defaultPreviewPaperWidth') {
      values.push(normalizeEnum(data[inputKey], ['58', '80'], '58'));
      return;
    }
    if (inputKey === 'receiptCopies') {
      values.push(Math.max(1, Math.min(5, Number(data[inputKey]) || 1)));
      return;
    }

    values.push(data[inputKey]);
  });

  if (!fields.length) {
    return getReceiptSettings();
  }

  await db.query(`UPDATE receipt_settings SET ${fields.join(', ')} WHERE id = 1`, values);
  return getReceiptSettings();
}

export async function resetReceiptSettingsToDefault() {
  await ensureReceiptSettingsSchema();
  await db.query(
    `UPDATE receipt_settings SET
      store_name = ?,
      printed_logo = NULL,
      emailed_logo = NULL,
      header_text = ?,
      footer_text = ?,
      show_customer_info = ?,
      show_comments = ?,
      receipt_language = ?,
      logo_alignment = ?,
      store_name_style = ?,
      show_receipt_number = ?,
      show_datetime = ?,
      show_cashier = ?,
      show_station = ?,
      show_terminal = ?,
      show_payment_method = ?,
      show_reference_number = ?,
      show_discount_line = ?,
      show_tax_line = ?,
      show_change_line = ?,
      item_layout = ?,
      item_name_wrap = ?,
      text_size = ?,
      divider_style = ?,
      default_preview_paper_width = ?,
      receipt_copies = ?,
      cut_paper_after_print = ?,
      open_cash_drawer_after_print = ?
     WHERE id = 1`,
    [
      DEFAULT_RECEIPT_SETTINGS.store_name,
      DEFAULT_RECEIPT_SETTINGS.header_text,
      DEFAULT_RECEIPT_SETTINGS.footer_text,
      DEFAULT_RECEIPT_SETTINGS.show_customer_info,
      DEFAULT_RECEIPT_SETTINGS.show_comments,
      DEFAULT_RECEIPT_SETTINGS.receipt_language,
      DEFAULT_RECEIPT_SETTINGS.logo_alignment,
      DEFAULT_RECEIPT_SETTINGS.store_name_style,
      DEFAULT_RECEIPT_SETTINGS.show_receipt_number,
      DEFAULT_RECEIPT_SETTINGS.show_datetime,
      DEFAULT_RECEIPT_SETTINGS.show_cashier,
      DEFAULT_RECEIPT_SETTINGS.show_station,
      DEFAULT_RECEIPT_SETTINGS.show_terminal,
      DEFAULT_RECEIPT_SETTINGS.show_payment_method,
      DEFAULT_RECEIPT_SETTINGS.show_reference_number,
      DEFAULT_RECEIPT_SETTINGS.show_discount_line,
      DEFAULT_RECEIPT_SETTINGS.show_tax_line,
      DEFAULT_RECEIPT_SETTINGS.show_change_line,
      DEFAULT_RECEIPT_SETTINGS.item_layout,
      DEFAULT_RECEIPT_SETTINGS.item_name_wrap,
      DEFAULT_RECEIPT_SETTINGS.text_size,
      DEFAULT_RECEIPT_SETTINGS.divider_style,
      DEFAULT_RECEIPT_SETTINGS.default_preview_paper_width,
      DEFAULT_RECEIPT_SETTINGS.receipt_copies,
      DEFAULT_RECEIPT_SETTINGS.cut_paper_after_print,
      DEFAULT_RECEIPT_SETTINGS.open_cash_drawer_after_print,
    ]
  );
  return getReceiptSettings();
}

export async function setReceiptLogo(logoType, relativePath) {
  const column = logoType === 'emailed' ? 'emailed_logo' : 'printed_logo';
  await ensureReceiptSettingsSchema();
  await db.query(`UPDATE receipt_settings SET ${column} = ? WHERE id = 1`, [relativePath || null]);
  return getReceiptSettings();
}

export async function clearReceiptLogo(logoType) {
  return setReceiptLogo(logoType, null);
}
