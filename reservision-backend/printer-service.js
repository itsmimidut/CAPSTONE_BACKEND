#!/usr/bin/env node
/**
 * ============================================================
 * Thermal Printer Daemon (Windows) - Queue Folder Watcher (FIXED)
 * ============================================================
 *
 * - Watches ./print-queue for new receipt files
 * - .txt  -> prints as TEXT using PowerShell Out-Printer
 * - .prn/.raw/.bin -> prints as RAW bytes using Win32 WritePrinter (ESC/POS safe)
 * - Moves jobs to ./printed on success, ./failed on failure
 * - Writes logs to ./printer-service.log
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========= CONFIG =========
const PRINT_QUEUE_DIR = path.join(__dirname, "print-queue");
const PRINTED_DIR = path.join(__dirname, "printed");
const FAILED_DIR = path.join(__dirname, "failed");
const LOG_FILE = path.join(__dirname, "printer-service.log");

const CHECK_INTERVAL_MS = 1000;

// Windows printer name (Printers & scanners)
const PRINTER_NAME = process.env.PRINTER_NAME || "POS-582";

// Allowed extensions
const ALLOWED_EXT = new Set([".txt", ".prn", ".raw", ".bin"]);

// Retry behavior
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1200;

// File stability: how many times size must remain unchanged
const STABLE_CHECKS = 3;
const STABLE_INTERVAL_MS = 250;

// ========= LOGGING =========
function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + os.EOL, "utf8");
  } catch (e) {
    console.error("Failed to write log file:", e?.message || e);
  }
}

// ========= HELPERS =========
function ensureDirs() {
  for (const d of [PRINT_QUEUE_DIR, PRINTED_DIR, FAILED_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function isAllowedFile(filename) {
  if (!filename || filename.startsWith(".")) return false;
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

function safeMove(src, destDir) {
  const base = path.basename(src);
  const dest = path.join(destDir, base);

  let finalPath = dest;
  if (fs.existsSync(finalPath)) {
    const stamp = Date.now();
    const ext = path.extname(base);
    const name = path.basename(base, ext);
    finalPath = path.join(destDir, `${name}-${stamp}${ext}`);
  }

  fs.renameSync(src, finalPath);
  return finalPath;
}

/**
 * Wait until the file is "stable" (writer finished saving it).
 */
async function waitForFileStable(filePath) {
  let lastSize = -1;
  let stableCount = 0;

  for (let i = 0; i < 40; i++) {
    try {
      const st = fs.statSync(filePath);
      const size = st.size;

      if (size > 0 && size === lastSize) stableCount++;
      else stableCount = 0;

      lastSize = size;

      if (stableCount >= STABLE_CHECKS) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, STABLE_INTERVAL_MS));
  }

  return false;
}

// ============================================================
// PRINT METHODS
// ============================================================

/**
 * TEXT printing via Out-Printer (for .txt only)
 */
function printTextViaOutPrinter(filePath) {
  return new Promise((resolve, reject) => {
    const psFile = filePath.replace(/'/g, "''");
    const psPrinter = PRINTER_NAME.replace(/'/g, "''");

    const script = `
      $ErrorActionPreference = 'Stop';
      $p = '${psPrinter}';
      if (-not (Get-Printer -Name $p -ErrorAction SilentlyContinue)) {
        throw "Printer not found: $p";
      }
      $content = Get-Content -LiteralPath '${psFile}' -Raw;
      $content | Out-Printer -Name $p;
    `.trim();

    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) return resolve(true);
      reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * RAW printing using Win32 WritePrinter (for .prn/.raw/.bin)
 * Sends bytes exactly as-is (ESC/POS safe).
 */
function printRawViaWritePrinter(buffer, jobName = "RAW Job") {
  return new Promise((resolve, reject) => {
    const b64 = buffer.toString("base64");
    const psPrinter = PRINTER_NAME.replace(/"/g, '""');
    const psJob = String(jobName).replace(/"/g, '""');

    const script = `
$printer = "${psPrinter}"
$jobName = "${psJob}"
$b64 = "${b64}"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes, string jobName) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = jobName;
    di.pDataType = "RAW";

    if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) return false;
    try {
      if (!StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!StartPagePrinter(hPrinter)) return false;
        try {
          int dwWritten = 0;
          IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
          Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
          bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
          Marshal.FreeCoTaskMem(pUnmanagedBytes);
          return ok && dwWritten == bytes.Length;
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@

$bytes = [Convert]::FromBase64String($b64)
$ok = [RawPrinterHelper]::SendBytesToPrinter($printer, $bytes, $jobName)

if ($ok) { exit 0 } else { exit 1 }
    `.trim();

    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) return resolve(true);
      reject(new Error(stderr || `RAW print failed. Exit code ${code}`));
    });

    proc.on("error", (err) => reject(err));
  });
}

// ============================================================
// JOB PROCESSOR
// ============================================================

async function processJob(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  log("INFO", `Job detected: ${filename}`);

  const stable = await waitForFileStable(filePath);
  if (!stable) {
    log("WARN", `File not stable/locked too long: ${filename} -> moving to failed`);
    const moved = safeMove(filePath, FAILED_DIR);
    log("ERROR", `Moved to failed: ${moved}`);
    return false;
  }

  try {
    const st = fs.statSync(filePath);
    if (st.size <= 0) {
      log("ERROR", `Empty file: ${filename} -> moving to failed`);
      const moved = safeMove(filePath, FAILED_DIR);
      log("ERROR", `Moved to failed: ${moved}`);
      return false;
    }
  } catch (e) {
    log("ERROR", `Stat error on ${filename}: ${e?.message || e}`);
    return false;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log("INFO", `Printing (${attempt}/${MAX_RETRIES}) -> ${filename} to "${PRINTER_NAME}"`);

      if (ext === ".txt") {
        await printTextViaOutPrinter(filePath);
      } else {
        // RAW file types
        const buffer = fs.readFileSync(filePath);
        await printRawViaWritePrinter(buffer, filename);
      }

      const moved = safeMove(filePath, PRINTED_DIR);
      log("SUCCESS", `Printed OK: ${filename} -> ${moved}`);
      return true;
    } catch (err) {
      log("ERROR", `Print failed attempt ${attempt} for ${filename}: ${err?.message || err}`);
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  const moved = safeMove(filePath, FAILED_DIR);
  log("ERROR", `All retries failed. Moved to failed: ${moved}`);
  return false;
}

// ============================================================
// QUEUE SCAN
// ============================================================

let isProcessing = false;

async function scanQueueOnce() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    ensureDirs();

    const files = fs
      .readdirSync(PRINT_QUEUE_DIR)
      .filter(isAllowedFile)
      .map((name) => {
        const full = path.join(PRINT_QUEUE_DIR, name);
        const st = fs.statSync(full);
        return { name, full, mtime: st.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);

    if (files.length === 0) return;

    for (const f of files) {
      await processJob(f.full);
    }
  } catch (e) {
    log("ERROR", `scanQueueOnce error: ${e?.message || e}`);
  } finally {
    isProcessing = false;
  }
}

// ============================================================
// START DAEMON
// ============================================================

function start() {
  ensureDirs();

  log("INFO", "============================================");
  log("INFO", "Thermal Printer Daemon (Windows TEXT+RAW)");
  log("INFO", `Queue:   ${PRINT_QUEUE_DIR}`);
  log("INFO", `Printed: ${PRINTED_DIR}`);
  log("INFO", `Failed:  ${FAILED_DIR}`);
  log("INFO", `Printer: ${PRINTER_NAME}`);
  log("INFO", "============================================");

  scanQueueOnce();

  try {
    fs.watch(PRINT_QUEUE_DIR, { persistent: true }, (eventType, filename) => {
      if (!filename) return;
      if (!isAllowedFile(filename)) return;
      setTimeout(() => scanQueueOnce(), 250);
    });
    log("INFO", "Watching queue directory changes...");
  } catch (e) {
    log("WARN", `fs.watch failed: ${e?.message || e} (will rely on interval)`);
  }

  setInterval(() => scanQueueOnce(), CHECK_INTERVAL_MS);
  log("INFO", "Running...");
}

process.on("SIGINT", () => {
  log("INFO", "Shutting down (SIGINT)...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  log("INFO", "Shutting down (SIGTERM)...");
  process.exit(0);
});

start();