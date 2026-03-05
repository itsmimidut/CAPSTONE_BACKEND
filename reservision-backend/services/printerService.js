// services/printerService.js
// Plain-text receipt builder — no ESC/POS binary codes, uses .txt via Out-Printer
import fs from "fs";
import path from "path";
import os from "os";

const PRINT_QUEUE_DIR = process.env.PRINT_QUEUE_DIR
  ? path.resolve(process.env.PRINT_QUEUE_DIR)
  : path.resolve(process.cwd(), "print-queue");

const COMPANY_NAME = process.env.RECEIPT_COMPANY || "ReserVision";
const PRINTER_WIDTH = Number(process.env.PRINTER_WIDTH || 42); // 42 chars fits 58mm nicely

function ensureQueueDir() {
  if (!fs.existsSync(PRINT_QUEUE_DIR))
    fs.mkdirSync(PRINT_QUEUE_DIR, { recursive: true });
}

function center(text, width = PRINTER_WIDTH) {
  text = String(text ?? "");
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return " ".repeat(pad) + text;
}

function leftRight(left, right, width = PRINTER_WIDTH) {
  left = String(left ?? "");
  right = String(right ?? "");
  const gap = width - left.length - right.length;
  return left + " ".repeat(Math.max(1, gap)) + right;
}

function divider(width = PRINTER_WIDTH) {
  return "-".repeat(width);
}

function money(n) {
  const num = Number(n ?? 0);
  return `PHP ${num.toFixed(2)}`;
}

function formatDateTime(date, time) {
  let d = String(date || "");
  if (d.includes("T")) d = d.split("T")[0]; // strip ISO time part
  const parts = d.split("-");
  if (parts.length === 3) d = `${parts[1]}/${parts[2]}/${parts[0]}`;
  return `${d} ${String(time || "")}`;
}

function buildRegularText(receipt) {
  const lines = [];
  const nl = () => lines.push("");

  // Header
  lines.push(center(COMPANY_NAME));
  nl();
  lines.push(center("POS Receipt"));
  nl();
  lines.push(`Receipt: ${receipt.receiptNo || ""}`);
  nl();
  lines.push(formatDateTime(receipt.date, receipt.time));
  lines.push(divider());

  // Items
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  for (const it of items) {
    const name = String(it.name ?? "").trim();
    const qty = Number(it.quantity || 1);
    const price = Number(it.price || 0);
    const total = Number(it.total ?? price * qty);
    lines.push(name);
    lines.push(leftRight(`${qty} x PHP ${price.toFixed(2)}`, money(total)));
  }

  // Booking reference (if any)
  if (receipt.bookingReference) {
    lines.push(divider());
    lines.push(`Ref: ${receipt.bookingReference}`);
  }

  // QR note for non-cash
  if (receipt.paymentMethod && receipt.paymentMethod !== "Cash") {
    nl();
    lines.push(center("also the qr code to be scanned"));
    lines.push(center("if not Cash"));
  }

  lines.push(divider());
  lines.push(leftRight("TOTAL", money(receipt.total || 0)));
  lines.push(divider());

  const pm = receipt.paymentMethod || receipt.payment || "Cash";
  lines.push(leftRight(`${pm}:`, money(receipt.total || 0)));

  nl();
  lines.push(leftRight("Paid Amount:", money(receipt.total || 0)));
  lines.push(leftRight("Change:", money(0)));

  nl();
  lines.push(center("Thank you!"));
  nl(); nl(); nl();

  return lines.join(os.EOL);
}

function buildBookingText(receipt) {
  const lines = [];
  const nl = () => lines.push("");

  // Header
  lines.push(center(COMPANY_NAME));
  nl();
  lines.push(center("Booking Receipt"));
  nl();
  lines.push(`Receipt: ${receipt.receiptNo || ""}`);
  lines.push(formatDateTime(receipt.date, receipt.time));
  lines.push(divider());

  // Guest info
  lines.push(`Guest: ${receipt.guestName || "N/A"}`);
  lines.push(`Phone: ${receipt.phone || "N/A"}`);
  lines.push(`Email: ${receipt.email || "N/A"}`);
  lines.push(divider());

  // Room / Booking details
  lines.push(`Room: ${receipt.roomName || "N/A"}`);
  lines.push(`Check-in:  ${receipt.checkInDate || "N/A"}`);
  lines.push(`Check-out: ${receipt.checkOutDate || "N/A"}`);
  lines.push(`Nights: ${receipt.nights || 0}`);
  lines.push(`Adults: ${receipt.adults || 0}   Children: ${receipt.children || 0}`);
  lines.push(divider());

  // Booking reference
  if (receipt.bookingReference) {
    lines.push(`Ref: ${receipt.bookingReference}`);
  }

  // QR note for non-cash
  if (receipt.paymentMethod && receipt.paymentMethod !== "Cash") {
    nl();
    lines.push(center("also the qr code to be scanned"));
    lines.push(center("if not Cash"));
  }

  lines.push(divider());
  lines.push(leftRight("TOTAL", money(receipt.total || 0)));
  lines.push(divider());

  const pm = receipt.paymentMethod || "Cash";
  lines.push(leftRight(`${pm}:`, money(receipt.total || 0)));

  nl();
  lines.push(leftRight("Paid Amount:", money(receipt.total || 0)));
  lines.push(leftRight("Change:", money(0)));

  nl();
  lines.push(center("Thank you!"));
  nl(); nl(); nl();

  return lines.join(os.EOL);
}

function queueFileName(prefix = "receipt") {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${ts}-${Math.floor(Math.random() * 10000)}.txt`;
}

function writeQueueFile(content, filename) {
  ensureQueueDir();
  const filePath = path.join(PRINT_QUEUE_DIR, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ============================================================
// Public API used by your controller
// ============================================================

export async function printRegularReceipt(receiptData) {
  try {
    const text = buildRegularText(receiptData);
    const filename = queueFileName("regular");
    const filePath = writeQueueFile(text, filename);
    return { success: true, receiptNo: receiptData.receiptNo, queued: true, filePath };
  } catch (e) {
    return { success: false, message: "Failed to queue regular receipt", error: e.message };
  }
}

export async function printBookingReceipt(receiptData) {
  try {
    const text = buildBookingText(receiptData);
    const filename = queueFileName("booking");
    const filePath = writeQueueFile(text, filename);
    return { success: true, receiptNo: receiptData.receiptNo, queued: true, filePath };
  } catch (e) {
    return { success: false, message: "Failed to queue booking receipt", error: e.message };
  }
}

export async function getPendingPrintJobs() {
  try {
    ensureQueueDir();
    const files = fs.readdirSync(PRINT_QUEUE_DIR).filter(f => f.toLowerCase().endsWith(".txt"));
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
      method: "queue+daemon (plain text)",
      message: "Printer service uses print-queue with plain .txt files. Ensure printer-service.js is running.",
      queueDir: PRINT_QUEUE_DIR,
    };
  } catch (e) {
    return { connected: false, message: "Queue directory not accessible", error: e.message };
  }
}