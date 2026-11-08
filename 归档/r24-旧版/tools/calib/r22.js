// r22 人口校准 v2：单梯子 + 墙只掷一次 + 永久/临时资源
'use strict';

const P = {
  barScale: 1.0,
  bMul: 1.0,
  earlyScale: 1.0,
  studyCap: [0.06, 0.06, 0.06, 0.12],
  lazy: 0.01,
  drug: true,
};

const PROF = {
  body: [140, 310, 1600, 2500, 3900, 5700],
  qi:   [ 90, 300,  900, 1800, 2800, 4000],
};
// 单梯子：体魄 → 脏腑 → 感气 → 破胎 → 驭凡
const LADDER = [
  { dao: 'body', tier: 1 },
  { dao: 'body', tier: 2 },
  { dao: 'qi',   tier: 1 },
  { dao: 'qi',   tier: 2 },
  { dao: 'qi',   tier: 3 },
];

function qOf(dao, tier, attr) {
  if (dao === 'body') {
    if (tier === 1) return 1 - Math.min(1, 0.80 + (attr - 40) * 0.02);
    if (tier === 2) return 1 - Math.min(1, 0.90 + (attr - 60) * 0.01);
    if (tier === 3) return 1 - Math.min(1, Math.max(0, (attr - 60) * 0.05));
    return 1 - Math.min(1, Math.max(0, (attr - 79) * 0.10));
  }
  if (tier === 1) return 1 - Math.min(1, Math.max(0, 0.50 + (attr - 60) * 0.025));
  if (tier === 2) return 1 - Math.min(1, Math.max(0, 0.30 + (attr - 60) * 0.035));
  return 1 - Math.min(1, Math.max(0, (attr - 70) * 0.05));
}

function drawAttr() {
  const S = 110 + Math.random() * 20;
  const r = 0.40 + Math.random() * 0.20;
  return Math.min(78, Math.max(44, Math.round(S * r)));
}

function simPerson() {
  const apt0 = drawAttr(), ins0 = drawAttr();
  let apt = apt0, ins = ins0;

  const talent = (apt + ins) / 2;
  const sup = talent >= 65 ? 1.0 : talent >= 55 ? 0.75 : 0.40;
  const has = (c) => P.drug && Math.random() < sup * c;
  const r = {
    peiyuan: has(0.65), guben: has(0.50), weizhao: has(0.75),
    wudao: has(0.35), baodi: has(0.20), yaoyu: has(0.15), xisui: has(0.08),
  };
  if (r.xisui) apt += 3;                       // 永久
  const eff = 0.85 + Math.random() * 0.30;     // 个人勤奋/环境：平滑修为速度
  const lazy = Math.random() < P.lazy;

  const path = { body: 0, qi: 0 };
  const bar  = { body: 0, qi: 0 };
  const fail = { body: [0,0,0,0], qi: [0,0,0,0] };
  const wall = { body: [null,null,null,null], qi: [null,null,null,null] };  // 墙只在首次满时掷一次
  const study = { body: [0,0,0,0], qi: [0,0,0,0] };
  const gateAge = {};
  let step = 0, age = 7;

  for (let y = 0; y < 90 && step < LADDER.length; y++) {
    if (r.yaoyu && y < 3) apt += 1;
    const tIns = ins + (r.wudao ? 5 : 0);
    const tApt = apt + (r.baodi ? 3 : 0);
    let months = 12, guard = 0, spent = false;

    while (months > 0 && step < LADDER.length && guard++ < 8) {
      const { dao, tier } = LADDER[step];
      const attr = dao === 'body' ? tApt : tIns;
      const early = (dao === 'body' && tier <= 2) ? P.earlyScale : 1;
      const need = PROF[dao][tier - 1] * P.barScale * early;
      const gf = age <= 10 ? 38 : age <= 14 ? 46 : 54;
      const base = 0.70 * attr + 0.20 * gf + 0.10 * (30 + 10 * tier);
      const perMonth = base * 0.20 * (r.peiyuan ? 1.10 : 1) * eff;

      if (lazy) { months = 0; break; }

      if (bar[dao] < need) {
        const m = Math.min(months, Math.ceil((need - bar[dao]) / perMonth));
        bar[dao] = Math.min(need, bar[dao] + perMonth * m);
        months -= m;
        if (bar[dao] < need) break;
      }

      if (spent) break;                        // 本年已尝试过，剩余月作废（简化）
      spent = true;

      // 墙：首次满时掷一次，之后不再重掷
      if (wall[dao][tier - 1] === null) wall[dao][tier - 1] = Math.random() < qOf(dao, tier, attr);

      // 求学：3 月/次，年内最多 2 次，按品封顶
      const cap = P.studyCap[tier - 1];
      let n = 0;
      while (months >= 3 && n < 2 && study[dao][tier - 1] + 0.03 <= cap + 1e-9) {
        study[dao][tier - 1] += 0.03; months -= 3; n++;
      }

      let ok = !wall[dao][tier - 1];           // 没有墙 → 直接破
      if (!ok) {
        if (fail[dao][tier - 1] === 0) {       // 首次必败
          fail[dao][tier - 1] = 0.02;
        } else {
          const b = Math.max(0, attr - 40) * 0.0030 * P.bMul;
          const pill = (r.guben ? 0.05 : 0) + (r.weizhao ? 0.08 : 0);
          const luck = (Math.random() - 0.5) * 0.06;
          const p = Math.min(0.95, b + study[dao][tier - 1] + fail[dao][tier - 1] + pill + luck);
          if (Math.random() < p) ok = true;
          else fail[dao][tier - 1] = Math.min(0.03, fail[dao][tier - 1] + 0.01 + Math.random() * 0.02);
        }
      }

      if (ok) {
        path[dao] = tier; bar[dao] = 0;
        fail[dao][tier - 1] = 0; wall[dao][tier - 1] = null;
        gateAge[`${dao}${tier}`] = age;
        step++;
        // 带动：高阶到达品 N → 低阶同品号补齐
        if (dao === 'qi') for (let k = tier; k >= 2; k--) {
          if (path.body < k) { path.body = k; bar.body = 0; if (gateAge[`body${k}`] === undefined) gateAge[`body${k}`] = age; }
        }
      } else {
        months = 0;                            // 失败：本年结束
      }
    }
    age++;
    if (age > 30) break;
  }

  const at = (a, dao, tier) => gateAge[`${dao}${tier}`] !== undefined && gateAge[`${dao}${tier}`] <= a;
  return { apt: apt0, ins: ins0, comp: apt0 + ins0,
    body2at10: at(10,'body',2), qi2at16: at(16,'qi',2),
    qi2at30: at(30,'qi',2), qi3at30: at(30,'qi',3),
    gateAge, lopsided: (apt0 >= 68 && ins0 <= 52) || (ins0 >= 68 && apt0 <= 52) };
}

function run(n) { const o = []; for (let i = 0; i < n; i++) o.push(simPerson()); return o; }

function report(rs, tag) {
  const n = rs.length, pc = (f) => (100 * rs.filter(f).length / n);
  const q16 = rs.filter(r => r.qi2at16);
  const top = [...q16].sort((a, b) => b.comp - a.comp).slice(0, Math.max(1, Math.floor(n * 0.08)));
  const uni = 100 * top.filter(r => r.qi2at16).length / Math.max(1, top.length);
  const qual = 100 * q16.length / n;
  const med = (k) => {
    const v = rs.map(r => r.gateAge[k]).filter(x => x !== undefined).sort((a, b) => a - b);
    return v.length ? `${v[Math.floor(v.length * .5)]}/${v[Math.floor(v.length * .9)]}` : '-';
  };
  const bands = [[44,48],[49,52],[53,56],[57,60],[61,64],[65,99]];
  const band = bands.map(([a,b]) => {
    const g = rs.filter(r => r.apt >= a && r.apt <= b);
    return g.length ? `${a}-${b}:${(100*g.filter(r=>r.qi2at30).length/g.length).toFixed(0)}` : '';
  }).filter(Boolean).join(' ');
  console.log(`${tag.padEnd(16)} 10岁脏腑 ${pc(r=>r.body2at10).toFixed(1)}% | 16岁破胎 ${qual.toFixed(1)}% | 30岁脱凡 ${pc(r=>r.qi2at30).toFixed(1)}% | 破胎 ${med('qi2')} | 脏腑 ${med('body2')}`);
  return { p10: pc(r=>r.body2at10), uni, p30: pc(r=>r.qi2at30), band, med };
}

module.exports = { run, report, P, simPerson };

if (require.main === module) {
  const N = +(process.argv[2] || 100000);
  const mode = process.argv[3];
  if (mode === 'sweep') {
    for (const bm of [0.85, 0.95, 1.0, 1.05]) {
      P.bMul = bm; const r = report(run(N), `bCoef=${(0.003*bm).toFixed(4)}`);
      console.log('      ' + r.band);
    }
  } else {
    const r = report(run(N), 'r22 基线');
    console.log('分资质带脱凡：' + r.band);
  }
}
