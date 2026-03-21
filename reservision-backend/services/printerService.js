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
  Number(process.env.RECEIPT_BOTTOM_FEED_LINES || 5)
);

// 58mm paper at standard ESC/POS font = 32 chars per line (no Windows margins).
// Previously 22 was needed to work around Windows Out-Printer margins — not needed with RAW.
const WIDTH = 32;

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
  PARTIAL_CUT: [GS, 0x56, 0x42, 0x03], // feed 3mm + partial cut
};

// ── Low-level buffer builder ──────────────────────────────────────────────────
class Receipt {
  constructor() {
    this._parts = [Buffer.from(CMD.INIT)];
  }

  _cmd(cmdArray) {
    this._parts.push(Buffer.from(cmdArray));
    return this;
  }

  _line(text = "") {
    const encoded = Buffer.from(String(text).slice(0, WIDTH), "latin1");
    this._parts.push(encoded);
    this._parts.push(Buffer.from([LF]));
    return this;
  }

  _raw(bytes = []) {
    this._parts.push(Buffer.from(bytes));
    return this;
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
    const maxLeft = Math.max(1, WIDTH - rightText.length - 1);
    if (leftText.length > maxLeft) leftText = leftText.slice(0, maxLeft);
    const gap = WIDTH - leftText.length - rightText.length;
    return this._cmd(CMD.ALIGN_LEFT)
      ._line(leftText + " ".repeat(Math.max(1, gap)) + rightText);
  }

  divider() {
    return this.left("-".repeat(WIDTH));
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
      // Select QR model 2
      ._raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
      // Set module size
      ._raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06])
      // Set error correction level (M)
      ._raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31])
      // Store data in symbol storage area
      ._raw([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30])
      ._raw(Array.from(data))
      // Print the QR code
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

// ── Receipt builders ──────────────────────────────────────────────────────────
function buildRegularESCPOS(receipt) {
  const r = new Receipt();
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

  r.bold(true).center(COMPANY_NAME).bold(false);
  r.center("POS RECEIPT");
  r.divider();

  r.left(`Rcpt : ${receipt.receiptNo || ""}`);
  r.left(`Date : ${formatDate(receipt.date)}`);
  r.left(`Time : ${receipt.time || ""}`);
  r.divider();

  const items = Array.isArray(receipt.items) ? receipt.items : [];
  for (const it of items) {
    const qty = Number(it.quantity || 1);
    const price = Number(it.price || 0);
    const total = Number(it.total ?? price * qty);
    r.left(String(it.name || "").slice(0, WIDTH));
    r.leftRight(`  ${qty} x ${money(price)}`, money(total));
  }

  if (receipt.bookingReference) {
    r.divider();
    r.left(`Ref  : ${String(receipt.bookingReference).slice(0, WIDTH - 7)}`);
  }

  r.divider();
  r.bold(true).leftRight("TOTAL", money(totalAmount)).bold(false);
  r.divider();

  const pm = String(receipt.paymentMethod || receipt.payment || "Cash");
  r.leftRight(pm.slice(0, 14), money(totalAmount));
  r.feed(1);
  r.leftRight("Paid", money(paidAmount));
  r.leftRight("Change", money(changeAmount));
  r.feed(1);
  r.bold(true).center("Thank you!").bold(false);
  r.feed(RECEIPT_BOTTOM_FEED_LINES);
  r.cut();

  return r.build();
}

function buildBookingESCPOS(receipt) {
  const r = new Receipt();
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

  r.bold(true).center(COMPANY_NAME).bold(false);
  r.center("BOOKING RECEIPT");
  r.divider();

  r.left(`Rcpt : ${receipt.receiptNo || ""}`);
  r.left(`Date : ${formatDate(receipt.date)}`);
  r.left(`Time : ${receipt.time || ""}`);
  r.divider();

  r.left(`Guest: ${String(receipt.guestName || "N/A").slice(0, WIDTH - 7)}`);
  r.left(`Phone: ${String(receipt.phone || "N/A").slice(0, WIDTH - 7)}`);
  r.left(`Email: ${String(receipt.email || "N/A").slice(0, WIDTH - 7)}`);
  r.divider();

  r.left(`Room : ${String(receipt.roomName || "N/A").slice(0, WIDTH - 7)}`);
  r.left(`In   : ${receipt.checkInDate || "N/A"}`);
  r.left(`Out  : ${receipt.checkOutDate || "N/A"}`);
  r.left(`Nights  : ${receipt.nights || 0}`);
  r.left(`Adults  : ${receipt.adults || 0}  Children: ${receipt.children || 0}`);
  r.divider();

  if (receipt.bookingReference) {
    r.left(`Ref  : ${String(receipt.bookingReference).slice(0, WIDTH - 7)}`);
    r.divider();
  }

  r.bold(true).leftRight("TOTAL", money(totalAmount)).bold(false);
  r.divider();

  const pm = String(receipt.paymentMethod || "Cash");
  r.leftRight(pm.slice(0, 14), money(totalAmount));
  r.feed(1);
  r.leftRight("Paid", money(paidAmount));
  r.leftRight("Change", money(changeAmount));
  if (String(receipt.paymentMethod || "").toLowerCase() === "gcash" && receipt.paymentUrl) {
    r.feed(1);
    r.center("Scan to pay");
    r.qr(receipt.paymentUrl);
  }
  r.feed(1);
  r.bold(true).center("Thank you!").bold(false);
  r.feed(RECEIPT_BOTTOM_FEED_LINES);
  r.cut();

  return r.build();
}

// ── Queue file management ─────────────────────────────────────────────────────
function ensureQueueDir() {
  if (!fs.existsSync(PRINT_QUEUE_DIR))
    fs.mkdirSync(PRINT_QUEUE_DIR, { recursive: true });
}

function queueFileName(prefix = "receipt") {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${ts}-${Math.floor(Math.random() * 10000)}.prn`;
}

function writePrnFile(buffer, filename) {
  ensureQueueDir();
  const filePath = path.join(PRINT_QUEUE_DIR, filename);
  fs.writeFileSync(filePath, buffer); // binary write, no encoding conversion
  return filePath;
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function printRegularReceipt(receiptData) {
  try {
    const buffer = buildRegularESCPOS(receiptData);
    const filePath = writePrnFile(buffer, queueFileName("regular"));
    return { success: true, receiptNo: receiptData.receiptNo, filePath };
  } catch (e) {
    return { success: false, message: "Failed to queue regular receipt", error: e.message };
  }
}

export async function printBookingReceipt(receiptData) {
  try {
    const buffer = buildBookingESCPOS(receiptData);
    const filePath = writePrnFile(buffer, queueFileName("booking"));
    return { success: true, receiptNo: receiptData.receiptNo, filePath };
  } catch (e) {
    return { success: false, message: "Failed to queue booking receipt", error: e.message };
  }
}

export async function getPendingPrintJobs() {
  try {
    ensureQueueDir();
    const files = fs
      .readdirSync(PRINT_QUEUE_DIR)
      .filter(f => /\.(prn|raw|bin|txt)$/i.test(f));
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
      width: WIDTH,
    };
  } catch (e) {
    return { connected: false, message: "Queue directory not accessible", error: e.message };
  }
}