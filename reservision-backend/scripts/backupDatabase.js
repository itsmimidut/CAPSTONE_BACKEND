/**
 * Sprint 4 Task 05 — Database backup script
 * Run: node scripts/backupDatabase.js
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

dotenv.config();

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backupsRoot = path.join(__dirname, '..', 'backups');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'reservision';

const DAY_MS = 24 * 60 * 60 * 1000;

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const formatStamp = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}_${m}_${d}`;
};

const removeOldFiles = (directory, maxAgeMs) => {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  const now = Date.now();
  let removed = 0;

  for (const file of fs.readdirSync(directory)) {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      continue;
    }

    if (now - stat.mtimeMs > maxAgeMs) {
      fs.unlinkSync(fullPath);
      removed += 1;
    }
  }

  return removed;
};

async function runBackup() {
  ensureDir(backupsRoot);
  ensureDir(path.join(backupsRoot, 'daily'));
  ensureDir(path.join(backupsRoot, 'weekly'));
  ensureDir(path.join(backupsRoot, 'monthly'));

  const stamp = formatStamp();
  const filename = `${DB_NAME}_${stamp}.sql`;
  const dailyPath = path.join(backupsRoot, 'daily', filename);

  const args = [
    `-h${DB_HOST}`,
    `-u${DB_USER}`,
    DB_NAME,
    '--single-transaction',
    '--routines',
    '--triggers',
  ];

  if (DB_PASSWORD) {
    args.unshift(`-p${DB_PASSWORD}`);
  }

  const { stdout } = await execFileAsync('mysqldump', args, {
    maxBuffer: 1024 * 1024 * 200,
    env: process.env,
  });

  fs.writeFileSync(dailyPath, stdout, 'utf8');

  const dayOfWeek = new Date().getDay();
  const dayOfMonth = new Date().getDate();

  if (dayOfWeek === 0) {
    fs.copyFileSync(dailyPath, path.join(backupsRoot, 'weekly', filename));
  }

  if (dayOfMonth === 1) {
    fs.copyFileSync(dailyPath, path.join(backupsRoot, 'monthly', filename));
  }

  const dailyRemoved = removeOldFiles(path.join(backupsRoot, 'daily'), 30 * DAY_MS);
  const weeklyRemoved = removeOldFiles(path.join(backupsRoot, 'weekly'), 12 * 7 * DAY_MS);
  const monthlyRemoved = removeOldFiles(path.join(backupsRoot, 'monthly'), 12 * 30 * DAY_MS);

  console.log(JSON.stringify({
    success: true,
    backup_file: dailyPath,
    retention_removed: {
      daily: dailyRemoved,
      weekly: weeklyRemoved,
      monthly: monthlyRemoved,
    },
  }, null, 2));
}

runBackup().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error.message,
    hint: 'Ensure mysqldump is installed and DB_* env vars are correct.',
  }, null, 2));
  process.exit(1);
});
