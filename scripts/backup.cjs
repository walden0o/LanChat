/**
 * SQLite 在线备份脚本。
 * 用 VACUUM INTO 生成一致性快照（WAL 模式下直接 cp 数据库文件不安全）。
 * 备份输出到 backups/，自动保留最近 20 份。
 *
 * 用法：npm run backup
 * 定时备份可加 cron：0 3 * * * cd /path/to/lanchat && npm run backup
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const KEEP = 20;
const DB_FILE = path.join(DATA_DIR, 'lanchat.db');

if (!fs.existsSync(DB_FILE)) {
  console.error(`数据库不存在: ${DB_FILE}`);
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 本地时间戳（toISOString 是 UTC，看着别扭）
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const target = path.join(BACKUP_DIR, `lanchat-${ts}.db`);
if (target.includes("'")) {
  console.error('路径包含非法字符');
  process.exit(1);
}

// VACUUM INTO：在线生成完整一致的数据库副本，无需停服务
const db = new Database(DB_FILE, { readonly: true });
db.exec(`VACUUM INTO '${target}'`);
db.close();
console.log(`备份完成: ${target}`);

// 只保留最近 KEEP 份
const files = fs
  .readdirSync(BACKUP_DIR)
  .filter((f) => /^lanchat-.*\.db$/.test(f))
  .sort();
for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
  fs.rmSync(path.join(BACKUP_DIR, f));
  console.log(`清理旧备份: ${f}`);
}
