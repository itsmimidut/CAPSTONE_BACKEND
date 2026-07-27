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
const PROCESSING_SUFFIX = ".processing";

const CHECK_INTERVAL_MS = Number(process.env.PRINT_CHECK_INTERVAL_MS || 120);
const WATCH_DEBOUNCE_MS = Number(process.env.PRINT_WATCH_DEBOUNCE_MS || 25);
const USE_RAW_WORKER = process.env.PRINT_USE_RAW_WORKER !== "false";
const RAW_PRINT_TIMEOUT_MS = Number(process.env.PRINT_RAW_TIMEOUT_MS || 20000);

// Windows printer name (Printers & scanners)
const PRINTER_NAME = process.env.PRINTER_NAME || "POS-582";

// Allowed extensions
const ALLOWED_EXT = new Set([".txt", ".prn", ".raw", ".bin"]);

// Retry behavior
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1200;

// File stability — only needed for slow .txt writers; .prn files are atomically renamed when complete
const STABLE_CHECKS = Number(process.env.PRINT_STABLE_CHECKS || 1);
const STABLE_INTERVAL_MS = Number(process.env.PRINT_STABLE_INTERVAL_MS || 40);
const STABLE_MAX_TRIES = Number(process.env.PRINT_STABLE_MAX_TRIES || 8);
const BINARY_EXTENSIONS = new Set([".prn", ".raw", ".bin"]);

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

let syncPrintJobStatus = null;
let printJobServiceModule = null;

async function getPrintJobService() {
  if (printJobServiceModule) return printJobServiceModule;
  try {
    printJobServiceModule = await import("./services/printJobService.js");
    return printJobServiceModule;
  } catch (err) {
    log("WARN", `Print job service unavailable: ${err?.message || err}`);
    return null;
  }
}

async function getPrintJobSyncer() {
  if (syncPrintJobStatus) return syncPrintJobStatus;
  try {
    const mod = await getPrintJobService();
    syncPrintJobStatus = mod?.syncPrintJobFromDaemon || null;
    return syncPrintJobStatus;
  } catch (err) {
    log("WARN", `Print job DB sync unavailable: ${err?.message || err}`);
    return null;
  }
}

async function resolveTargetPrinterForFile(filename) {
  const mod = await getPrintJobService();
  if (!mod?.extractPrintJobIdFromFilename || !mod?.getPrintJobPrinterTarget) {
    return {
      printerName: PRINTER_NAME,
      printerInterface: 'usb',
      printerConfig: null,
      usedFallback: true,
    };
  }

  const jobId = mod.extractPrintJobIdFromFilename(filename);
  if (!jobId) {
    return {
      printerName: PRINTER_NAME,
      printerInterface: 'usb',
      printerConfig: null,
      usedFallback: true,
    };
  }

  try {
    const target = await mod.getPrintJobPrinterTarget(jobId);
    if (!target) {
      return {
        printerName: PRINTER_NAME,
        printerInterface: 'usb',
        printerConfig: null,
        usedFallback: true,
      };
    }
    if (target.usedFallback && target.printerInterface === 'usb') {
      log("WARN", `Job ${jobId} has no printer_name; falling back to PRINTER_NAME (${PRINTER_NAME})`);
    }
    return {
      printerName: target.printerName || PRINTER_NAME,
      printerInterface: target.printerInterface || 'usb',
      printerConfig: target.printerConfig || null,
      usedFallback: Boolean(target.usedFallback),
      jobId,
    };
  } catch (err) {
    log("WARN", `Could not resolve printer for job ${jobId}: ${err?.message || err}`);
    return {
      printerName: PRINTER_NAME,
      printerInterface: 'usb',
      printerConfig: null,
      usedFallback: true,
      jobId,
    };
  }
}

async function reportPrintJobResult(filename, success, errorMessage = null, targetPrinter = null) {
  try {
    const syncer = await getPrintJobSyncer();
    if (!syncer) return;
    const result = await syncer({ filename, success, errorMessage, targetPrinter });
    if (result.updated) {
      log("INFO", `Print job ${result.jobId} -> ${result.status}${result.printerName ? ` (${result.printerName})` : ""}`);
    }
  } catch (err) {
    log("WARN", `Failed to sync print job status: ${err?.message || err}`);
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
  if (filename.endsWith(PROCESSING_SUFFIX)) return false;
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

function reserveJobFile(filePath) {
  const lockedPath = `${filePath}${PROCESSING_SUFFIX}`;
  try {
    fs.renameSync(filePath, lockedPath);
    return lockedPath;
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
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

  for (let i = 0; i < STABLE_MAX_TRIES; i++) {
    try {
      const st = fs.statSync(filePath);
      const size = st.size;

      if (size > 0 && size === lastSize) stableCount++;
      else stableCount = 0;

      lastSize = size;

      if (stableCount >= STABLE_CHECKS) return true;
    } catch { }
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
function printTextViaOutPrinter(filePath, printerName = PRINTER_NAME) {
  return new Promise((resolve, reject) => {
    const psFile = filePath.replace(/'/g, "''");
    const psPrinter = String(printerName || PRINTER_NAME).replace(/'/g, "''");

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
function printRawViaWritePrinter(filePath, jobName = "RAW Job", printerName = PRINTER_NAME) {
  return new Promise((resolve, reject) => {
    const psPrinter = String(printerName || PRINTER_NAME).replace(/"/g, '""');
    const psJob = String(jobName).replace(/"/g, '""');
    const psFilePath = String(filePath).replace(/'/g, "''");

    const script = `
$printer = "${psPrinter}"
$jobName = "${psJob}"
$filePath = '${psFilePath}'

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

$bytes = [System.IO.File]::ReadAllBytes($filePath)
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
// PERSISTENT RAW PRINT WORKER (avoids ~1–3s Add-Type compile per job)
// ============================================================

const RAW_WORKER_SCRIPT = path.join(__dirname, "scripts", "raw-print-worker.ps1");

let rawWorkerProc = null;
let rawWorkerReady = false;
let rawWorkerStdoutBuffer = "";
/** @type {{ filePath: string, jobName: string, resolve: Function, reject: Function, timeout?: NodeJS.Timeout } | null} */
let rawWorkerPending = null;
const rawWorkerQueue = [];

function handleRawWorkerLine(line) {
  const trimmed = line.trim();
  if (trimmed === "READY") {
    rawWorkerReady = true;
    log("INFO", "RAW print worker ready");
    drainRawWorkerQueue();
    return;
  }
  if (!rawWorkerPending) return;

  const pending = rawWorkerPending;
  rawWorkerPending = null;
  if (pending.timeout) clearTimeout(pending.timeout);

  if (trimmed === "OK") {
    pending.resolve(true);
  } else {
    pending.reject(new Error(trimmed.startsWith("ERR|") ? trimmed.slice(4) : trimmed));
  }
  drainRawWorkerQueue();
}

function drainRawWorkerQueue() {
  if (rawWorkerPending || rawWorkerQueue.length === 0 || !rawWorkerReady || !rawWorkerProc) return;

  const next = rawWorkerQueue.shift();
  rawWorkerPending = next;

  const timeout = setTimeout(() => {
    if (rawWorkerPending !== next) return;
    rawWorkerPending = null;
    next.reject(new Error("RAW print worker timeout"));
    log("WARN", "RAW worker timeout — restarting");
    restartRawWorker();
  }, RAW_PRINT_TIMEOUT_MS);
  next.timeout = timeout;

  const payload = JSON.stringify({
    cmd: "print",
    file: next.filePath,
    job: next.jobName,
    printer: next.printerName || PRINTER_NAME,
  });
  try {
    rawWorkerProc.stdin.write(`${payload}\n`);
  } catch (err) {
    clearTimeout(timeout);
    rawWorkerPending = null;
    next.reject(err);
    restartRawWorker();
  }
}

function shutdownRawWorker() {
  if (!rawWorkerProc || rawWorkerProc.killed) return;
  try {
    rawWorkerProc.stdin.write("EXIT\n");
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    if (rawWorkerProc && !rawWorkerProc.killed) rawWorkerProc.kill();
  }, 400);
}

function restartRawWorker() {
  if (rawWorkerProc && !rawWorkerProc.killed) {
    try {
      rawWorkerProc.kill();
    } catch {
      /* ignore */
    }
  }
  rawWorkerProc = null;
  rawWorkerReady = false;
  rawWorkerPending = null;
  startRawWorker();
}

function startRawWorker() {
  if (!USE_RAW_WORKER) return;
  if (rawWorkerProc && !rawWorkerProc.killed) return;

  if (!fs.existsSync(RAW_WORKER_SCRIPT)) {
    log("WARN", `RAW worker script missing (${RAW_WORKER_SCRIPT}); using one-shot PowerShell per job`);
    return;
  }

  rawWorkerStdoutBuffer = "";
  rawWorkerReady = false;

  rawWorkerProc = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", RAW_WORKER_SCRIPT, PRINTER_NAME],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
  );

  rawWorkerProc.stdout.on("data", (chunk) => {
    rawWorkerStdoutBuffer += chunk.toString();
    const lines = rawWorkerStdoutBuffer.split(/\r?\n/);
    rawWorkerStdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) handleRawWorkerLine(line);
    }
  });

  rawWorkerProc.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) log("WARN", `RAW worker stderr: ${msg}`);
  });

  rawWorkerProc.on("close", (code) => {
    log("WARN", `RAW worker exited (code ${code})`);
    rawWorkerProc = null;
    rawWorkerReady = false;

    if (rawWorkerPending) {
      if (rawWorkerPending.timeout) clearTimeout(rawWorkerPending.timeout);
      rawWorkerPending.reject(new Error("RAW worker exited unexpectedly"));
      rawWorkerPending = null;
    }

    while (rawWorkerQueue.length) {
      const q = rawWorkerQueue.shift();
      q.reject(new Error("RAW worker exited"));
    }

    if (USE_RAW_WORKER) setTimeout(() => startRawWorker(), 300);
  });

  rawWorkerProc.on("error", (err) => {
    log("ERROR", `RAW worker spawn error: ${err?.message || err}`);
  });
}

function printRawViaWorker(filePath, jobName = "RAW Job", printerName = PRINTER_NAME) {
  return new Promise((resolve, reject) => {
    if (!USE_RAW_WORKER || !rawWorkerProc) {
      printRawViaWritePrinter(filePath, jobName, printerName).then(resolve).catch(reject);
      return;
    }
    rawWorkerQueue.push({ filePath, jobName, printerName, resolve, reject });
    drainRawWorkerQueue();
  });
}

async function printRaw(filePath, jobName, printerName = PRINTER_NAME) {
  if (USE_RAW_WORKER && rawWorkerReady) {
    try {
      return await printRawViaWorker(filePath, jobName, printerName);
    } catch (err) {
      log("WARN", `Worker print failed, falling back: ${err?.message || err}`);
      return printRawViaWritePrinter(filePath, jobName, printerName);
    }
  }

  if (USE_RAW_WORKER && rawWorkerProc && !rawWorkerReady) {
    await new Promise((r) => setTimeout(r, 80));
    if (rawWorkerReady) return printRaw(filePath, jobName, printerName);
  }

  return printRawViaWritePrinter(filePath, jobName, printerName);
}


async function processJob(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const target = await resolveTargetPrinterForFile(filename);
  const targetPrinter = target.printerName || PRINTER_NAME;
  const interfaceType = String(target.printerInterface || 'usb').toLowerCase();
  const printerConfig = target.printerConfig || {};

  const targetLabel = interfaceType === 'ethernet'
    ? `${printerConfig.ip_address || '—'}:${printerConfig.port || 9100}`
    : targetPrinter;

  log("INFO", `Job detected: ${filename} -> ${interfaceType} "${targetLabel}"`);

  const lockedPath = reserveJobFile(filePath);
  if (!lockedPath) {
    log("WARN", `Job already processed by another worker: ${filename}`);
    return false;
  }

  const stable = BINARY_EXTENSIONS.has(ext)
    ? true
    : await waitForFileStable(lockedPath);
  if (!stable) {
    log("WARN", `File not stable/locked too long: ${filename} -> moving to failed`);
    if (fs.existsSync(lockedPath)) {
      const moved = safeMove(lockedPath, FAILED_DIR);
      log("ERROR", `Moved to failed: ${moved}`);
      await reportPrintJobResult(filename, false, "File not stable before print", targetPrinter);
    }
    return false;
  }

  try {
    const st = fs.statSync(lockedPath);
    if (st.size <= 0) {
      log("ERROR", `Empty file: ${filename} -> moving to failed`);
      if (fs.existsSync(lockedPath)) {
        const moved = safeMove(lockedPath, FAILED_DIR);
        log("ERROR", `Moved to failed: ${moved}`);
        await reportPrintJobResult(filename, false, "Empty print file", targetPrinter);
      }
      return false;
    }
  } catch (e) {
    log("ERROR", `Stat error on ${filename}: ${e?.message || e}`);
    return false;
  }

  // Connector-owned jobs: park payload for Print Connector (Windows or Android).
  const connectorDeviceId =
    printerConfig.connector_device_id ||
    printerConfig.connectorDeviceId ||
    printerConfig.bridge_device_id ||
    printerConfig.bridgeDeviceId ||
    null;
  const connectionMethod = String(
    printerConfig.connection_method || printerConfig.connectionMethod || ''
  ).toLowerCase();

  if (connectorDeviceId) {
    try {
      const bridgeDir = process.env.PRINT_BRIDGE_PAYLOAD_DIR
        ? path.resolve(process.env.PRINT_BRIDGE_PAYLOAD_DIR)
        : path.resolve(__dirname, "print-bridge-payloads");
      if (!fs.existsSync(bridgeDir)) fs.mkdirSync(bridgeDir, { recursive: true });
      const destName = filename.replace(/\.processing$/i, "");
      const destPath = path.join(bridgeDir, destName);
      fs.renameSync(lockedPath, destPath);
      log(
        "INFO",
        `Connector job parked (${connectionMethod || interfaceType}) for connector ${connectorDeviceId}: ${destName}`
      );
    } catch (e) {
      log("WARN", `Could not move connector job to bridge payloads: ${e?.message || e}`);
    }
    // Do not mark SENT/FAILED — Print Connector will claim and complete.
    return true;
  }

  // Bluetooth / serial without connector cannot be printed by backend daemon.
  if (
    interfaceType === 'bluetooth' ||
    connectionMethod === 'android_bluetooth' ||
    connectionMethod === 'bluetooth_serial'
  ) {
    const message =
      connectionMethod === 'bluetooth_serial'
        ? 'Bluetooth Serial / COM requires a Windows Print Connector.'
        : 'No Print Connector assigned.';
    log("ERROR", message);
    if (fs.existsSync(lockedPath)) {
      const moved = safeMove(lockedPath, FAILED_DIR);
      log("ERROR", `Moved to failed: ${moved}`);
    }
    await reportPrintJobResult(filename, false, message, targetPrinter);
    return false;
  }

  // Ethernet: send ESC/POS buffer over TCP 9100.
  if (interfaceType === 'ethernet') {
    const ipAddress = printerConfig.ip_address || printerConfig.ipAddress;
    const port = Number(printerConfig.port || 9100);

    if (!ipAddress) {
      const message = 'Ethernet printer IP address is missing.';
      log("ERROR", message);
      if (fs.existsSync(lockedPath)) safeMove(lockedPath, FAILED_DIR);
      await reportPrintJobResult(filename, false, message, targetPrinter);
      return false;
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log("INFO", `Ethernet print (${attempt}/${MAX_RETRIES}) -> ${filename} to ${ipAddress}:${port}`);
        const buffer = fs.readFileSync(lockedPath);
        const { sendToEthernetPrinter } = await import("./services/ethernetPrinterService.js");
        await sendToEthernetPrinter({ ipAddress, port, buffer });

        const moved = safeMove(lockedPath, PRINTED_DIR);
        log("SUCCESS", `Ethernet printed OK: ${filename} -> ${moved}`);
        await reportPrintJobResult(filename, true, null, `${ipAddress}:${port}`);
        return true;
      } catch (err) {
        const errMsg = err?.message || String(err);
        log("ERROR", `Ethernet print failed attempt ${attempt} for ${filename}: ${errMsg}`);
        if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        else {
          if (fs.existsSync(lockedPath)) {
            const moved = safeMove(lockedPath, FAILED_DIR);
            log("ERROR", `All ethernet retries failed. Moved to failed: ${moved}`);
          }
          await reportPrintJobResult(filename, false, errMsg, `${ipAddress}:${port}`);
          return false;
        }
      }
    }
    return false;
  }

  // USB / Windows daemon path (default).
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log("INFO", `Printing (${attempt}/${MAX_RETRIES}) -> ${filename} to "${targetPrinter}"`);

      if (ext === ".txt") {
        await printTextViaOutPrinter(lockedPath, targetPrinter);
      } else {
        await printRaw(lockedPath, filename, targetPrinter);
      }

      const moved = safeMove(lockedPath, PRINTED_DIR);
      log("SUCCESS", `Printed OK: ${filename} -> ${moved}`);
      await reportPrintJobResult(filename, true, null, targetPrinter);
      return true;
    } catch (err) {
      const errMsg = err?.message || String(err);
      log("ERROR", `Print failed attempt ${attempt} for ${filename} on "${targetPrinter}": ${errMsg}`);
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  const failureMessage = `Failed to send to Windows print queue: ${targetPrinter}`;
  if (fs.existsSync(lockedPath)) {
    const moved = safeMove(lockedPath, FAILED_DIR);
    log("ERROR", `All retries failed. Moved to failed: ${moved}`);
    await reportPrintJobResult(filename, false, failureMessage, targetPrinter);
  } else {
    log("WARN", `All retries failed and file already missing: ${filename}`);
  }
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
  log("INFO", `Printer default: ${PRINTER_NAME} (USB uses Windows name; Ethernet uses TCP 9100)`);
  log("INFO", `Poll: ${CHECK_INTERVAL_MS}ms | Watch debounce: ${WATCH_DEBOUNCE_MS}ms | RAW worker: ${USE_RAW_WORKER}`);
  log("INFO", "============================================");

  startRawWorker();
  scanQueueOnce();

  let watchTimer = null;
  try {
    fs.watch(PRINT_QUEUE_DIR, { persistent: true }, (eventType, filename) => {
      if (!filename) return;
      if (!isAllowedFile(filename)) return;
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => scanQueueOnce(), WATCH_DEBOUNCE_MS);
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
  shutdownRawWorker();
  process.exit(0);
});
process.on("SIGTERM", () => {
  log("INFO", "Shutting down (SIGTERM)...");
  shutdownRawWorker();
  process.exit(0);
});

start();