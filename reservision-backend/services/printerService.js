// services/printerService.js
// ESC/POS raw binary — bypasses Windows text formatting completely.
// Writes .prn files to print-queue/; printer-service.js daemon sends them via
// Win32 WritePrinter with pDataType="RAW" (no page margins, no word-wrap).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRINT_QUEUE_DIR = process.env.PRINT_QUEUE_DIR
  ? path.resolve(process.env.PRINT_QUEUE_DIR)
  : path.resolve(__dirname, "..", "print-queue");

const COMPANY_NAME = process.env.RECEIPT_COMPANY || "Eduardo's Resort";
const RECEIPT_BOTTOM_FEED_LINES = Math.max(
  2,
  Number(process.env.RECEIPT_BOTTOM_FEED_LINES || 3)
);

// 58mm ≈ 32 chars; 80mm ≈ 48 chars at standard ESC/POS font.
function charsForPaper(paperWidth) {
  return String(paperWidth) === "80" ? 48 : 32;
}

// ── ESC/POS command bytes ─────────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD = {
  INIT: [ESC, 0x40],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  NORMAL_SIZE: [ESC, 0x21, 0x00],
  // ESC ! n — bit 4 = double height, bit 5 = double width
  SIZE_SMALL: [ESC, 0x21, 0x00],
  SIZE_NORMAL: [ESC, 0x21, 0x00],
  SIZE_LARGE: [ESC, 0x21, 0x30], // double width + height
  PARTIAL_CUT: [GS, 0x56, 0x42, 0x03], // feed 3mm + partial cut
  // ESC p m t1 t2 — pulse pin 2 (cash drawer)
  OPEN_DRAWER: [ESC, 0x70, 0x00, 0x19, 0xfa],
};

function alignCmd(alignment) {
  const a = String(alignment || "center").toLowerCase();
  if (a === "left") return CMD.ALIGN_LEFT;
  if (a === "right") return CMD.ALIGN_RIGHT;
  return CMD.ALIGN_CENTER;
}

function textSizeCmd(size) {
  const s = String(size || "normal").toLowerCase();
  if (s === "large") return CMD.SIZE_LARGE;
  return CMD.SIZE_NORMAL;
}

function normalizeSettings(settings = null, options = {}) {
  const s = settings && typeof settings === "object" ? settings : {};
  const paperWidth =
    options.paperWidth ||
    s.defaultPreviewPaperWidth ||
    s.paperWidth ||
    "58";
  return {
    storeName: s.storeName || COMPANY_NAME,
    printedLogo: s.printedLogo || null,
    headerText: s.headerText || "",
    footerText: s.footerText || "",
    logoAlignment: ["left", "center", "right"].includes(String(s.logoAlignment || "").toLowerCase())
      ? String(s.logoAlignment).toLowerCase()
      : "center",
    storeNameStyle: ["normal", "bold", "large"].includes(String(s.storeNameStyle || "").toLowerCase())
      ? String(s.storeNameStyle).toLowerCase()
      : "bold",
    showCustomerInfo: s.showCustomerInfo !== false,
    showComments: Boolean(s.showComments),
    showReceiptNumber: s.showReceiptNumber !== false,
    showDatetime: s.showDatetime !== false,
    showCashier: s.showCashier !== false,
    showStation: s.showStation !== false,
    showTerminal: Boolean(s.showTerminal),
    showPaymentMethod: s.showPaymentMethod !== false,
    showReferenceNumber: s.showReferenceNumber !== false,
    showDiscountLine: s.showDiscountLine !== false,
    showTaxLine: Boolean(s.showTaxLine),
    showChangeLine: s.showChangeLine !== false,
    itemLayout: String(s.itemLayout || "compact").toLowerCase() === "detailed" ? "detailed" : "compact",
    itemNameWrap: s.itemNameWrap !== false,
    textSize: ["small", "normal", "large"].includes(String(s.textSize || "").toLowerCase())
      ? String(s.textSize).toLowerCase()
      : "normal",
    dividerStyle: ["dashed", "solid", "none"].includes(String(s.dividerStyle || "").toLowerCase())
      ? String(s.dividerStyle).toLowerCase()
      : "dashed",
    paperWidth: String(paperWidth) === "80" ? "80" : "58",
    receiptCopies: Math.max(1, Math.min(5, Number(s.receiptCopies) || 1)),
    cutPaperAfterPrint: s.cutPaperAfterPrint !== false,
    openCashDrawerAfterPrint: Boolean(s.openCashDrawerAfterPrint),
  };
}

// ── Low-level buffer builder ──────────────────────────────────────────────────
class Receipt {
  constructor(width = 32) {
    this.width = Math.max(16, Number(width) || 32);
    this._parts = [Buffer.from(CMD.INIT)];
  }

  _cmd(cmdArray) {
    this._parts.push(Buffer.from(cmdArray));
    return this;
  }

  _line(text = "") {
    const encoded = Buffer.from(String(text).slice(0, this.width), "latin1");
    this._parts.push(encoded);
    this._parts.push(Buffer.from([LF]));
    return this;
  }

  _raw(bytes = []) {
    this._parts.push(Buffer.from(bytes));
    return this;
  }

  rawBuffer(buffer) {
    if (buffer && Buffer.isBuffer(buffer) && buffer.length) {
      this._parts.push(buffer);
    }
    return this;
  }

  setTextSize(size) {
    return this._cmd(textSizeCmd(size));
  }

  align(mode) {
    return this._cmd(alignCmd(mode));
  }

  center(text = "") {
    return this._cmd(CMD.ALIGN_CENTER)._line(text)._cmd(CMD.ALIGN_LEFT);
  }

  left(text = "") {
    return this._cmd(CMD.ALIGN_LEFT)._line(text);
  }

  leftRight(leftText, rightText) {
    leftText = String(leftText || "");
    rightText = String(rightText || "");
    const maxLeft = Math.max(1, this.width - rightText.length - 1);
    if (leftText.length > maxLeft) leftText = leftText.slice(0, maxLeft);
    const gap = this.width - leftText.length - rightText.length;
    return this._cmd(CMD.ALIGN_LEFT)
      ._line(leftText + " ".repeat(Math.max(1, gap)) + rightText);
  }

  divider(style = "dashed") {
    const s = String(style || "dashed").toLowerCase();
    if (s === "none") return this;
    const char = s === "solid" ? "=" : "-";
    return this.left(char.repeat(this.width));
  }

  bold(on) {
    return this._cmd(on ? CMD.BOLD_ON : CMD.BOLD_OFF);
  }

  feed(n = 1) {
    for (let i = 0; i < n; i++) this._line("");
    return this;
  }

  cut() {
    return this._cmd(CMD.PARTIAL_CUT);
  }

  openDrawer() {
    return this._cmd(CMD.OPEN_DRAWER);
  }

  qr(text = "") {
    const value = String(text || "").trim();
    if (!value) return this;

    const data = Buffer.from(value, "ascii");
    if (data.length === 0 || data.length > 700) return this;

    const len = data.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;

    return this
      ._cmd(CMD.ALIGN_CENTER)
      ._raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
      ._raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x08])
      ._raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31])
      ._raw([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30])
      ._raw(Array.from(data))
      ._raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
      ._cmd(CMD.ALIGN_LEFT);
  }

  build() {
    return Buffer.concat(this._parts);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function money(n) {
  return `PHP ${Number(n || 0).toFixed(2)}`;
}

function formatDate(date) {
  let d = String(date || "");
  if (d.includes("T")) d = d.split("T")[0];
  const p = d.split("-");
  return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : d;
}

function wrapText(text, width = 32) {
  const input = String(text || "").trim();
  if (!input) return [];
  const words = input.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);

    if (word.length <= width) {
      line = word;
      continue;
    }

    let start = 0;
    while (start < word.length) {
      lines.push(word.slice(start, start + width));
      start += width;
    }
    line = "";
  }

  if (line) lines.push(line);
  return lines;
}

function addPaymentPendingBanner(r) {
  const stars = "*".repeat(Math.min(24, r.width));
  r.bold(true).center(stars).bold(false);
  r.bold(true).center("PAYMENT PENDING").bold(false);
  r.bold(true).center(stars).bold(false);
  r.feed(1);
}

async function addReceiptBranding(r, settings, options = {}) {
  const logoPath = settings.printedLogo;
  if (logoPath) {
    try {
      const { buildEscPosLogoRaster, maxLogoWidthForPaper } = await import("./escposLogoService.js");
      const paperWidth = options.paperWidth || settings.paperWidth || "58";
      const logoBuffer = await buildEscPosLogoRaster(logoPath, {
        paperWidth,
        maxWidth: maxLogoWidthForPaper(paperWidth),
        alignment: settings.logoAlignment || "center",
      });
      if (logoBuffer) {
        r.rawBuffer(logoBuffer);
      }
    } catch (error) {
      console.warn("[printerService] Logo raster skipped:", error.message);
    }
  }

  const storeName = String(settings.storeName || COMPANY_NAME).slice(0, r.width);
  const style = settings.storeNameStyle || "bold";
  r.align(settings.logoAlignment || "center");
  if (style === "large") {
    r.setTextSize("large").bold(true)._line(storeName).bold(false).setTextSize("normal");
  } else if (style === "bold") {
    r.bold(true)._line(storeName).bold(false);
  } else {
    r._line(storeName);
  }
  r._cmd(CMD.ALIGN_LEFT);
  r.setTextSize(settings.textSize || "normal");

  const headerText = String(settings.headerText || "").trim();
  if (headerText) {
    headerText.split(/\r?\n/).forEach((line) => {
      if (line.trim()) r.center(String(line).slice(0, r.width));
    });
  }
}

function addReceiptFooter(r, settings) {
  const footerText = String(settings.footerText || "").trim();
  if (footerText) {
    r.feed(1);
    footerText.split(/\r?\n/).forEach((line) => {
      if (line.trim()) r.center(String(line).slice(0, r.width));
    });
  }
}

function addReceiptComments(r, receipt, settings) {
  if (!settings.showComments) return;
  const comments = String(
    receipt?.comments || receipt?.comment || receipt?.notes || receipt?.specialRequest || ""
  ).trim();
  if (!comments) return;
  r.divider(settings.dividerStyle);
  r.left("Comments:");
  for (const line of wrapText(comments, r.width)) {
    r.left(line);
  }
}

function printReceiptItems(r, items, settings) {
  const list = Array.isArray(items) ? items : [];
  const detailed = settings.itemLayout === "detailed";
  const wrapNames = settings.itemNameWrap !== false;

  for (const it of list) {
    const qty = Number(it.quantity || 1);
    const price = Number(it.price || 0);
    const total = Number(it.total ?? price * qty);
    const name = String(it.name || "").trim() || "Item";
    const customization = it.customization && typeof it.customization === "object"
      ? it.customization
      : null;

    if (detailed) {
      if (wrapNames) {
        for (const line of wrapText(name, r.width)) r.left(line);
      } else {
        r.left(name.slice(0, r.width));
      }
      r.left(`  Qty: ${qty}`);
      r.left(`  Price: ${money(price)}`);
      r.left(`  Total: ${money(total)}`);
    } else {
      const qtyLabel = ` x${qty}`;
      const amount = money(total);
      const maxName = Math.max(1, r.width - amount.length - qtyLabel.length - 1);
      let displayName = name;
      if (wrapNames && name.length > maxName) {
        const lines = wrapText(name, r.width);
        lines.slice(0, -1).forEach((line) => r.left(line));
        displayName = lines[lines.length - 1] || name.slice(0, maxName);
        r.leftRight(`${displayName}${qtyLabel}`.slice(0, r.width - amount.length - 1), amount);
      } else {
        r.leftRight(`${name.slice(0, maxName)}${qtyLabel}`, amount);
      }
    }

    if (customization?.sizeLabel) {
      r.left(`  Size: ${String(customization.sizeLabel).slice(0, r.width - 8)}`);
    }

    const addOns = Array.isArray(customization?.addOns) ? customization.addOns : [];
    if (addOns.length > 0) {
      const addOnNames = addOns
        .map((addOn) => String(addOn?.name || "").trim())
        .filter(Boolean)
        .join(", ");
      for (const line of wrapText(`  Add-ons: ${addOnNames}`, r.width)) {
        r.left(line);
      }
    }

    if (customization?.specialRequest) {
      for (const line of wrapText(`  Note: ${String(customization.specialRequest)}`, r.width)) {
        r.left(line);
      }
    }
  }
}

function addMetaHeader(r, receipt, settings, title) {
  r.center(title);
  if (receipt.serviceOrderNumber) {
    r.bold(true).setTextSize("large").center(`ORDER NO. ${receipt.serviceOrderNumber}`).setTextSize("normal").bold(false);
    const orderType = String(receipt.orderType || "").replaceAll("_", " ").toUpperCase();
    const location = receipt.locationNumber ? ` - ROOM ${receipt.locationNumber}` : "";
    if (orderType) r.center(`${orderType}${location}`);
  }
  r.divider(settings.dividerStyle);

  if (settings.showReceiptNumber) {
    r.left(`Rcpt : ${receipt.receiptNo || ""}`);
  }
  if (settings.showDatetime) {
    r.left(`Date : ${formatDate(receipt.date)}`);
    r.left(`Time : ${receipt.time || ""}`);
  }
  if (settings.showCashier && receipt.cashier) {
    r.left(`Cashier: ${String(receipt.cashier).slice(0, r.width - 9)}`);
  }
  if (settings.showStation && (receipt.stationName || receipt.station)) {
    r.left(`Station: ${String(receipt.stationName || receipt.station).slice(0, r.width - 9)}`);
  }
  if (settings.showTerminal && (receipt.terminalName || receipt.terminal)) {
    r.left(`Terminal: ${String(receipt.terminalName || receipt.terminal).slice(0, r.width - 10)}`);
  }
}

function addTotalsAndPayment(r, receipt, settings, {
  totalAmount,
  paidAmount,
  changeAmount,
  paymentPending,
  paymentMethod,
}) {
  const discount = Number(
    receipt.discount ?? receipt.discountAmount ?? receipt.discount_amount ?? 0
  );
  const tax = Number(
    receipt.tax ?? receipt.taxAmount ?? receipt.vat ?? receipt.vatAmount ?? NaN
  );
  const hasTax = Number.isFinite(tax) && tax > 0;

  if (settings.showDiscountLine && discount > 0) {
    r.leftRight("Discount", `-${money(discount)}`);
  }
  // Only print tax when setting is on AND transaction actually has tax.
  if (settings.showTaxLine && hasTax) {
    r.leftRight("Tax/VAT", money(tax));
  }

  r.bold(true).leftRight("TOTAL", money(totalAmount)).bold(false);
  r.divider(settings.dividerStyle);

  const pm = String(paymentMethod || "Cash");
  if (!paymentPending) {
    if (settings.showPaymentMethod) {
      r.leftRight(pm.slice(0, 14), money(totalAmount));
    }
    r.feed(1);
    r.leftRight("Paid", money(paidAmount));
    if (settings.showChangeLine) {
      r.leftRight("Change", money(changeAmount));
    }
  } else {
    if (settings.showPaymentMethod) {
      r.leftRight(pm.slice(0, 14), money(totalAmount));
    }
    r.feed(1);
    r.left("Status: AWAITING PAYMENT");
  }
}

function finalizeReceiptBuffer(r, settings) {
  if (settings.openCashDrawerAfterPrint) {
    try {
      r.openDrawer();
    } catch {
      // Drawer pulse is best-effort; never fail the print.
    }
  }
  if (settings.cutPaperAfterPrint !== false) {
    r.cut();
  }

  const single = r.build();
  const copies = Math.max(1, Math.min(5, Number(settings.receiptCopies) || 1));
  if (copies <= 1) return single;

  const parts = [];
  for (let i = 0; i < copies; i++) parts.push(single);
  return Buffer.concat(parts);
}

function createReceipt(settings) {
  const r = new Receipt(charsForPaper(settings.paperWidth));
  r.setTextSize(settings.textSize);
  return r;
}

// ── Receipt builders ──────────────────────────────────────────────────────────
async function buildRegularESCPOS(receipt, receiptSettings = null, options = {}) {
  const settings = normalizeSettings(receiptSettings, options);
  const r = createReceipt(settings);
  const totalAmount = Number(receipt.total || 0);
  const paidAmount = Number(
    receipt.paidAmount ??
    receipt.paid_amount ??
    receipt.cashReceived ??
    receipt.cash_received ??
    totalAmount
  );
  const changeAmount = Number(
    receipt.changeAmount ??
    receipt.change_amount ??
    Math.max(0, paidAmount - totalAmount)
  );
  const paymentPending = Boolean(receipt.paymentPending);
  const paymentMethod = String(receipt.paymentMethod || receipt.payment || "Cash");
  const isGcash = paymentMethod.toLowerCase() === "gcash";

  await addReceiptBranding(r, settings, options);
  if (paymentPending) {
    addPaymentPendingBanner(r);
  }
  addMetaHeader(r, receipt, settings, paymentPending ? "PAYMENT REQUEST" : "POS RECEIPT");

  if (settings.showCustomerInfo) {
    const customerName = String(receipt.customerName || receipt.guestName || "").trim();
    const customerPhone = String(receipt.customerPhone || receipt.phone || "").trim();
    if (customerName) r.left(`Guest : ${customerName.slice(0, r.width - 8)}`);
    if (customerPhone) r.left(`Phone : ${customerPhone.slice(0, r.width - 8)}`);
  }
  r.divider(settings.dividerStyle);

  printReceiptItems(r, receipt.items, settings);

  if (settings.showReferenceNumber && receipt.bookingReference) {
    r.divider(settings.dividerStyle);
    r.left(`Ref  : ${String(receipt.bookingReference).slice(0, r.width - 7)}`);
  }

  r.divider(settings.dividerStyle);
  addTotalsAndPayment(r, receipt, settings, {
    totalAmount,
    paidAmount,
    changeAmount,
    paymentPending,
    paymentMethod,
  });

  if (isGcash && paymentPending && receipt.paymentUrl) {
    r.feed(1);
    r.center("Scan to pay");
    r.qr(receipt.paymentUrl);
  }

  r.feed(1);
  addReceiptComments(r, receipt, settings);
  addReceiptFooter(r, settings);
  r.bold(true).center(paymentPending ? "Awaiting payment" : "Thank you!").bold(false);
  r.feed(RECEIPT_BOTTOM_FEED_LINES);

  return finalizeReceiptBuffer(r, settings);
}

async function buildBookingESCPOS(receipt, receiptSettings = null, options = {}) {
  const settings = normalizeSettings(receiptSettings, options);
  const r = createReceipt(settings);
  const totalAmount = Number(receipt.total || 0);
  const paidAmount = Number(
    receipt.paidAmount ??
    receipt.paid_amount ??
    receipt.cashReceived ??
    receipt.cash_received ??
    totalAmount
  );
  const changeAmount = Number(
    receipt.changeAmount ??
    receipt.change_amount ??
    Math.max(0, paidAmount - totalAmount)
  );
  const paymentPending = Boolean(receipt.paymentPending);
  const paymentMethod = String(receipt.paymentMethod || "Cash");
  const isGcash = paymentMethod.toLowerCase() === "gcash";

  await addReceiptBranding(r, settings, options);
  if (paymentPending) {
    addPaymentPendingBanner(r);
  }
  addMetaHeader(
    r,
    receipt,
    settings,
    paymentPending ? "BOOKING - PAYMENT REQUEST" : "BOOKING RECEIPT"
  );
  r.divider(settings.dividerStyle);

  if (settings.showCustomerInfo) {
    r.left(`Guest: ${String(receipt.guestName || "N/A").slice(0, r.width - 7)}`);
    r.left(`Phone: ${String(receipt.phone || "N/A").slice(0, r.width - 7)}`);
    r.left(`Email: ${String(receipt.email || "N/A").slice(0, r.width - 7)}`);
    r.divider(settings.dividerStyle);
  }

  r.left(`Room : ${String(receipt.roomName || "N/A").slice(0, r.width - 7)}`);
  r.left(`In   : ${receipt.checkInDate || "N/A"}`);
  r.left(`Out  : ${receipt.checkOutDate || "N/A"}`);
  r.left(`Nights  : ${receipt.nights || 0}`);
  r.left(`Adults  : ${receipt.adults || 0}  Children: ${receipt.children || 0}`);
  r.divider(settings.dividerStyle);

  if (settings.showReferenceNumber && receipt.bookingReference) {
    r.left(`Ref  : ${String(receipt.bookingReference).slice(0, r.width - 7)}`);
    r.divider(settings.dividerStyle);
  }

  addTotalsAndPayment(r, receipt, settings, {
    totalAmount,
    paidAmount,
    changeAmount,
    paymentPending,
    paymentMethod,
  });

  if (isGcash && paymentPending && receipt.paymentUrl) {
    r.feed(1);
    r.center("Scan to pay");
    r.qr(receipt.paymentUrl);
  }

  r.feed(1);
  addReceiptComments(r, receipt, settings);
  addReceiptFooter(r, settings);
  r.bold(true).center(paymentPending ? "Awaiting payment" : "Thank you!").bold(false);
  r.feed(RECEIPT_BOTTOM_FEED_LINES);

  return finalizeReceiptBuffer(r, settings);
}

function formatCustomization(customization) {
  if (!customization) return "";
  const parts = [];
  if (customization.sizeName || customization.size) {
    parts.push(`Size: ${customization.sizeName || customization.size}`);
  }
  if (Array.isArray(customization.addOns) && customization.addOns.length) {
    parts.push(`Add: ${customization.addOns.map((a) => a.name || a).join(", ")}`);
  }
  if (customization.notes) parts.push(String(customization.notes));
  return parts.join(" | ");
}

function buildKitchenOrderESCPOS(orderData = {}) {
  const r = new Receipt(32);
  const title = orderData.jobType === "bar_order" ? "BAR ORDER" : "KITCHEN ORDER";

  r.bold(true).center(title).bold(false);
  if (orderData.serviceOrderNumber) {
    r.bold(true).setTextSize("large").center(`ORDER NO. ${orderData.serviceOrderNumber}`).setTextSize("normal").bold(false);
    const orderType = String(orderData.orderType || "").replaceAll("_", " ").toUpperCase();
    const location = orderData.locationNumber ? ` - ROOM ${orderData.locationNumber}` : "";
    if (orderType) r.center(`${orderType}${location}`);
  }
  r.divider();
  r.left(`Receipt: ${orderData.receiptNo || "N/A"}`);
  r.left(`Date : ${orderData.date || ""} ${orderData.time || ""}`.trim());
  if (orderData.stationName) r.left(`Station: ${orderData.stationName}`);
  if (orderData.cashier) r.left(`Cashier: ${orderData.cashier}`);
  r.divider();

  const items = Array.isArray(orderData.items) ? orderData.items : [];
  if (orderData.groupIdenticalItems !== false) {
    const grouped = new Map();
    for (const item of items) {
      const key = `${item.name}|${formatCustomization(item.customization)}`;
      const existing = grouped.get(key) || { ...item, quantity: 0 };
      existing.quantity += Number(item.quantity || 1);
      grouped.set(key, existing);
    }
    for (const item of grouped.values()) {
      r.bold(true).left(`${item.quantity}x ${item.name}`).bold(false);
      const note = formatCustomization(item.customization);
      if (note) r.left(`  ${note}`);
    }
  } else {
    for (const item of items) {
      r.bold(true).left(`${item.quantity || 1}x ${item.name}`).bold(false);
      const note = formatCustomization(item.customization);
      if (note) r.left(`  ${note}`);
    }
  }

  r.divider();
  r.center("--- END ORDER ---");
  r.feed(RECEIPT_BOTTOM_FEED_LINES);
  r.cut();
  return r.build();
}

async function buildTestESCPOS(receiptSettings = null, options = {}) {
  const settings = normalizeSettings(receiptSettings, options);
  const r = createReceipt(settings);
  await addReceiptBranding(r, settings, options);
  r.center("PRINTER TEST");
  r.divider(settings.dividerStyle);
  r.left("This is a test receipt.");
  r.left(`Printed: ${new Date().toLocaleString("en-PH")}`);
  r.divider(settings.dividerStyle);

  const sampleItems = [
    { name: "Burger", quantity: 1, price: 150, total: 150 },
    { name: "Coke", quantity: 1, price: 30, total: 30 },
  ];
  printReceiptItems(r, sampleItems, settings);

  r.divider(settings.dividerStyle);
  r.bold(true).leftRight("TOTAL", money(180)).bold(false);
  r.feed(1);
  addReceiptFooter(r, settings);
  r.bold(true).center("Test successful").bold(false);
  r.feed(RECEIPT_BOTTOM_FEED_LINES);

  return finalizeReceiptBuffer(r, settings);
}

// ── Queue file management ─────────────────────────────────────────────────────
function ensureQueueDir() {
  if (!fs.existsSync(PRINT_QUEUE_DIR))
    fs.mkdirSync(PRINT_QUEUE_DIR, { recursive: true });
}

function queueFileName(prefix = "receipt", jobId = null) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.floor(Math.random() * 10000);
  if (jobId) {
    return `pj-${jobId}-${prefix}-${ts}-${suffix}.prn`;
  }
  return `${prefix}-${ts}-${suffix}.prn`;
}

function writePrnFile(buffer, filename) {
  ensureQueueDir();
  const filePath = path.join(PRINT_QUEUE_DIR, filename);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function printRegularReceipt(receiptData, options = {}) {
  try {
    const { jobId = null, receiptSettings = null, paperWidth = null } = options;
    let settings = receiptSettings;
    if (!settings) {
      const { getReceiptSettings } = await import("./receiptSettingsService.js");
      settings = await getReceiptSettings();
    }
    const buffer = await buildRegularESCPOS(receiptData, settings, {
      paperWidth: paperWidth || settings.defaultPreviewPaperWidth,
    });
    const filename = queueFileName("regular", jobId);
    const filePath = writePrnFile(buffer, filename);
    return { success: true, receiptNo: receiptData.receiptNo, filePath, jobFile: filename };
  } catch (e) {
    return { success: false, message: "Failed to queue regular receipt", error: e.message };
  }
}

export async function printBookingReceipt(receiptData, options = {}) {
  try {
    const { jobId = null, receiptSettings = null, paperWidth = null } = options;
    let settings = receiptSettings;
    if (!settings) {
      const { getReceiptSettings } = await import("./receiptSettingsService.js");
      settings = await getReceiptSettings();
    }
    const buffer = await buildBookingESCPOS(receiptData, settings, {
      paperWidth: paperWidth || settings.defaultPreviewPaperWidth,
    });
    const filename = queueFileName("booking", jobId);
    const filePath = writePrnFile(buffer, filename);
    return { success: true, receiptNo: receiptData.receiptNo, filePath, jobFile: filename };
  } catch (e) {
    return { success: false, message: "Failed to queue booking receipt", error: e.message };
  }
}

export async function printKitchenOrder(orderData, options = {}) {
  try {
    const { jobId = null } = options;
    const buffer = buildKitchenOrderESCPOS(orderData);
    const prefix = orderData.jobType === "bar_order" ? "bar-order" : "kitchen-order";
    const filename = queueFileName(prefix, jobId);
    const filePath = writePrnFile(buffer, filename);
    return { success: true, receiptNo: orderData.receiptNo, filePath, jobFile: filename };
  } catch (e) {
    return { success: false, message: "Failed to queue kitchen order", error: e.message };
  }
}

export async function printTestReceipt(options = {}) {
  try {
    const { jobId = null, receiptSettings = null, paperWidth = null } = options;
    let settings = receiptSettings;
    if (!settings) {
      const { getReceiptSettings } = await import("./receiptSettingsService.js");
      settings = await getReceiptSettings();
    }
    const buffer = await buildTestESCPOS(settings, {
      paperWidth: paperWidth || settings.defaultPreviewPaperWidth,
    });
    const filename = queueFileName("test", jobId);
    const filePath = writePrnFile(buffer, filename);
    return { success: true, filePath, jobFile: filename };
  } catch (e) {
    return { success: false, message: "Failed to queue test receipt", error: e.message };
  }
}

export async function getPendingPrintJobs() {
  try {
    ensureQueueDir();
    const files = fs
      .readdirSync(PRINT_QUEUE_DIR)
      .filter((f) => /\.(prn|raw|bin|txt)$/i.test(f));
    return { success: true, queueDir: PRINT_QUEUE_DIR, count: files.length, files };
  } catch (e) {
    return { success: false, message: "Failed to read queue", error: e.message };
  }
}

export async function testPrinterConnection() {
  try {
    ensureQueueDir();
    return {
      connected: true,
      method: "ESC/POS raw binary (.prn) via Win32 WritePrinter RAW",
      message: "printerService writes .prn ESC/POS binary files; printer-service.js sends them as RAW data type (no Windows formatting).",
      queueDir: PRINT_QUEUE_DIR,
      width: 32,
    };
  } catch (e) {
    return { connected: false, message: "Queue directory not accessible", error: e.message };
  }
}
