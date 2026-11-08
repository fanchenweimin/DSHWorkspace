'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('./router/index');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const PID_FILE = path.join(ROOT, 'data', 'server.pid');

function writePid() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch { /* 忽略 */ }
}

function clearPid() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch { /* 忽略 */ }
}

function start() {
  const server = createServer();

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用。可设置 PORT 环境变量换一个。`);
    } else {
      console.error(e);
    }
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    writePid();
    console.log('');
    console.log('  大曜问仙录 · r25');
    console.log(`  http://${HOST}:${PORT}`);
    console.log('  账号：sysadmin / sysadmin （配置页）、user / useradmin');
    console.log('  停止：node stop.js');
    console.log('');
  });

  const shutdown = () => {
    clearPid();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
