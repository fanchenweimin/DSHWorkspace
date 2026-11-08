'use strict';

/*
 * 一键跑全部离线测试（不需要服务）。
 * 运行：node test/all.js
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SUITES = [
  ['单元测试（纯函数规则）', 'unit.js'],
  ['系统测试（状态机与规则落地）', 'system.js'],
  ['链路测试（门槛事件链）', 'chain.js'],
  ['冒烟测试（30 世人生）', 'smoke.js']
];

let failed = 0;
const started = Date.now();

for (const [title, file] of SUITES) {
  console.log(`\n${'='.repeat(52)}`);
  console.log(`▶ ${title}  (test/${file})`);
  console.log('='.repeat(52));

  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });

  if (result.status !== 0) failed += 1;
}

console.log(`\n${'='.repeat(52)}`);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failed === 0) {
  console.log(`✓ 全部离线测试通过（${SUITES.length} 组，${seconds}s）`);
  process.exit(0);
} else {
  console.log(`✗ ${failed} 组失败（共 ${SUITES.length} 组，${seconds}s）`);
  process.exit(1);
}
