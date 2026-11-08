'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('./router/api.router');

const DEFAULT_PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const PID_FILE = path.join(__dirname, '..', 'data', 'server.pid');

function writePid() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch {
    // 忽略
  }
}

function clearPid() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // 忽略
  }
}

function start() {
  const server = createServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${DEFAULT_PORT} 已被占用。可设置 PORT 环境变量。`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });

  server.listen(DEFAULT_PORT, HOST, () => {
    writePid();
    console.log('');
    console.log('  大曜问仙录 · 新版已开启');
    console.log(`  http://${HOST}:${DEFAULT_PORT}`);
    console.log('  默认账号：sysadmin / sysadmin、user / useradmin');
    console.log('  停止服务：node stop.js');
    console.log('');
  });

  const shutdown = () => {
    clearPid();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { start };
