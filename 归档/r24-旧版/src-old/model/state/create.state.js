'use strict';

const crypto = require('node:crypto');
const rng = require('../../util/rng');
const { clamp, cleanName } = require('../../util/text');
const { START_AGE, emptyState } = require('./schema');
const { defaultConfig, THRESHOLDS, LIFESPAN } = require('../../seed/realms.seed');
const { FATES } = require('../../seed/fates.seed');
const { TALENTS } = require('../../seed/talents.seed');
const { ITEMS } = require('../../seed/items.seed');
const { METHODS } = require('../../seed/arts.seed');
const { IDENTITIES, soulMass } = require('../../seed/identities.seed');
const { familySupply } = require('../rules/economy.rule');

/** 出身三段 */
const ORIGINS = {
  family: [
    { key: 'farm', label: '农家', family: '农户', text: '你出生在长明城外的农家，父母都种灵田。', money: 400 },
    { key: 'shop', label: '药铺', family: '富商', text: '你家在城南开药铺。你闻着药味长大。', money: 900 },
    { key: 'clerk', label: '小吏', family: '小吏', text: '你父亲在仙司做抄写小吏，家里有许多旧公文可看。', money: 700 },
    { key: 'trader', label: '行商', family: '富商', text: '你跟着商队走过三州，见过沙漠、雪山和会发光的河。', money: 1200 },
    { key: 'orphan', label: '孤儿', family: '孤儿', text: '你没有见过父母，是蒙学门口的老门房把你拉扯大的。', money: 60 }
  ],
  childhood: [
    { key: 'sick', label: '体弱', text: '你小时候常生病，七岁前有一半时间在药炉边度过。', hidden: { aptitude: -2, insight: 2 } },
    { key: 'restless', label: '好动', text: '你从会走路起就闲不住，膝盖上的疤没断过。', hidden: { aptitude: 2, heart: -1 } },
    { key: 'quiet', label: '寡言', text: '你不爱说话，喜欢蹲在墙角看蚂蚁搬家。', hidden: { insight: 1, heart: 1 } },
    { key: 'reader', label: '爱读书', text: '你认字早，七岁前已把家里的旧书翻烂了两本。', study: 2 },
    { key: 'wild', label: '山野', text: '你常往城外山野跑，认得许多草药和野兽的脚印。', hidden: { luck: 2 }, items: { herb: 1 } }
  ],
  omen: [
    { key: 'deer', label: '白鹿入梦', text: '你三岁那年梦见一头白鹿走进屋子。', hidden: { luck: 3 } },
    { key: 'bone', label: '老僧摸骨', text: '一个游方老僧摸过你的骨头，说“可惜，也可期”。', hidden: { aptitude: 2 } },
    { key: 'meteor', label: '流星入怀', text: '你五岁那年，一颗流星落在院中。', hidden: { insight: 2 } },
    { key: 'moon', label: '井中捞月', text: '你六岁那年趴在井边看月亮，伸手去捞。', hidden: { heart: 2 } }
  ]
};

function generateOrigin() {
  return {
    family: rng.pick(ORIGINS.family),
    childhood: rng.pick(ORIGINS.childhood),
    omen: rng.pick(ORIGINS.omen)
  };
}

/** 随机命格 */
function rollFate() {
  return rng.pick(FATES);
}

/** 随机 2–3 个天赋，不重复 */
function rollTalents(fate) {
  const count = rng.int(2, 3);
  const pool = [...TALENTS];
  const chosen = [];
  while (chosen.length < count && pool.length) {
    const index = rng.int(0, pool.length - 1);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen.map((talent) => talent.key);
}

/** 建初始 hidden */
function buildHidden(fate, origin) {
  const hidden = {
    aptitude: rng.int(38, 82),
    insight: rng.int(38, 82),
    heart: rng.int(38, 82),
    nature: rng.int(35, 65),
    luck: rng.int(44, 72),
    baseLuck: 0,
    caps: {},
    heartDecay: 0,
    selfDoubt: 0,
    insightBuff: { value: 0, untilAge: 0 },
    heartBuff: { value: 0, untilAge: 0 }
  };
  hidden.baseLuck = hidden.luck;
  hidden.caps = {
    aptitude: Math.min(100, hidden.aptitude + 14),
    insight: Math.min(100, hidden.insight + 14),
    heart: Math.min(100, hidden.heart + 14)
  };

  const apply = (effects) => {
    if (!effects) return;
    for (const [key, delta] of Object.entries(effects)) {
      if (key === 'luck') {
        hidden.luck = clamp(hidden.luck + delta, 20, 95);
      } else if (key in hidden && key in hidden.caps) {
        hidden[key] = clamp(hidden[key] + delta, 10, hidden.caps[key]);
      }
    }
  };

  // 命格
  apply(fate.hidden);
  if (fate.luck) {
    hidden.luck = Math.max(fate.luck.min, hidden.luck + fate.luck.bonus);
  }
  if (fate.nature) hidden.nature = clamp(hidden.nature + fate.nature, 0, 100);
  if (fate.cap) {
    for (const key of ['aptitude', 'insight', 'heart']) {
      hidden.caps[key] = Math.min(100, hidden.caps[key] + fate.cap);
    }
  }

  // 出身
  apply(origin.childhood.hidden);
  apply(origin.omen.hidden);

  hidden.baseLuck = hidden.luck;
  return hidden;
}

/** 建四道初始状态 */
function buildRealms(config) {
  const realms = {};
  for (const realm of config.realms) {
    realms[realm.key] = {
      stageIndex: 0,
      prof: 0,
      unlocked: realm.unlock === 'start',
      blocked: false,
      awaiting: null,
      completed: false,
      attempts: 0
    };
  }
  return realms;
}

/** 创建一局 */
function createState(name, configInput) {
  const config = configInput ? JSON.parse(JSON.stringify(configInput)) : defaultConfig();
  const state = emptyState();

  const fate = rollFate();
  const origin = generateOrigin();
  const hidden = buildHidden(fate, origin);
  const talents = rollTalents(fate);

  state.id = crypto.randomUUID();
  state.name = cleanName(name);
  state.createdAt = new Date().toISOString();
  state.config = config;
  state.configVersion = config.version || 1;

  state.fate = fate.key;
  state.talents = talents;
  state.origin = [
    { label: origin.family.label, text: origin.family.text },
    { label: origin.childhood.label, text: origin.childhood.text },
    { label: origin.omen.label, text: origin.omen.text }
  ];

  state.hidden = hidden;
  state.lifespan = clamp(62 + (fate.lifespan || 0), 35, 95);

  state.realms = buildRealms(config);
  state.activeRealm = 'body';

  // 家世
  const family = origin.family.family;
  state.flags.family = family;
  state.identity = {
    base: 'citizen',
    org: { type: 'city', name: '长明城' },
    title: null,
    subjects: { ...IDENTITIES.citizen.subjects },
    herbs: 0,
    tags: []
  };

  // 初始金钱
  let money = origin.family.money;
  money += familySupply(family, START_AGE);
  money += 500; // 蒙学发的安家钱
  state.items.money = money;

  // 出身带来的物品
  if (origin.childhood.items) {
    for (const [id, count] of Object.entries(origin.childhood.items)) {
      state.items[id] = (state.items[id] || 0) + count;
    }
  }

  // 蒙学发的通用功法与拳脚
  state.methods.body = 'body_school';
  state.arts.body = ['fist_school'];
  state.mastery.body_school = 10;

  state.journal.push({
    age: START_AGE,
    title: '七岁前',
    text: `${origin.family.text}${origin.childhood.text}${origin.omen.text} 七岁这年，你进入长明城蒙学。`
  });

  state.seed = `${Date.now()}-${rng.int(1000, 9999)}`;
  state.rev = 1;
  return state;
}

module.exports = {
  ORIGINS,
  createState,
  generateOrigin,
  rollFate,
  rollTalents
};
