const { run, P } = require('./r22.js');
const N = 100000;
const pc = (rs, f) => (100 * rs.filter(f).length / rs.length);
const med = (rs, k) => {
  const v = rs.map(r => r.gateAge[k]).filter(x => x !== undefined).sort((a, b) => a - b);
  if (!v.length) return '-';
  const q = p => v[Math.floor(v.length * p)];
  return q(0.5) + '/' + q(0.9) + '/' + q(0.99);
};
const base = run(N);
console.log('=== 定稿 ===');
console.log('10岁脏腑', pc(base, r => r.body2at10).toFixed(1) + '%');
console.log('16岁破胎(全体)', pc(base, r => r.qi2at16).toFixed(1) + '%');
console.log('30岁破胎', pc(base, r => r.qi2at30).toFixed(1) + '%');
console.log('30岁驭凡', pc(base, r => r.qi3at30).toFixed(1) + '%');
for (const k of ['body1', 'body2', 'qi1', 'qi2', 'qi3']) console.log('  年龄 中/90/99', k, med(base, k));
for (const ab of [[44, 48], [49, 52], [53, 56], [57, 60], [61, 64], [65, 99]]) {
  const g = base.filter(r => r.apt >= ab[0] && r.apt <= ab[1]);
  console.log('资质 ' + ab[0] + '-' + ab[1] + ': 占比' + (100 * g.length / N).toFixed(1) + '% 脱凡' + pc(g, r => r.qi2at30).toFixed(0) + '% 10岁脏腑' + pc(g, r => r.body2at10).toFixed(0) + '%');
}
const q16 = base.filter(r => r.qi2at16);
const adm = [...q16].sort((a, b) => b.comp - a.comp).slice(0, Math.floor(N * 0.08));
console.log('太学: 合格率', (100 * q16.length / N).toFixed(1) + '%', '| 录取', adm.length,
  '| 偏科率', pc(adm, r => r.lopsided).toFixed(1) + '%',
  '| 均资', (adm.reduce((s, r) => s + r.apt, 0) / adm.length).toFixed(1),
  '| 均悟', (adm.reduce((s, r) => s + r.ins, 0) / adm.length).toFixed(1));
console.log('偏科者', pc(base, r => r.lopsided).toFixed(1) + '% | 其中16岁破胎', pc(base.filter(r => r.lopsided), r => r.qi2at16).toFixed(1) + '%');
P.drug = false; const noDrug = run(N); P.drug = true;
console.log('不嗑药 30岁', pc(noDrug, r => r.qi2at30).toFixed(1) + '% | 破胎中/90', med(noDrug, 'qi2'));
P.lazy = 0; const noLazy = run(N); P.lazy = 0.01;
console.log('无摆烂 30岁', pc(noLazy, r => r.qi2at30).toFixed(1) + '%');
for (const d of [-0.1, -0.05, 0, 0.05, 0.1]) {
  const old = P.earlyScale; P.earlyScale = 1 + d;
  const r = run(N);
  console.log('早期修为条 x' + P.earlyScale.toFixed(2) + ': 10岁' + pc(r, x => x.body2at10).toFixed(1) + '% 30岁' + pc(r, x => x.qi2at30).toFixed(1) + '%');
  P.earlyScale = old;
}
for (const bm of [0.85, 1.0, 1.15]) {
  P.bMul = bm; const r = run(N);
  console.log('b系数 ' + (0.003 * bm).toFixed(4) + ': 30岁' + pc(r, x => x.qi2at30).toFixed(1) + '% | 破胎中/90 ' + med(r, 'qi2'));
}
P.bMul = 1;
