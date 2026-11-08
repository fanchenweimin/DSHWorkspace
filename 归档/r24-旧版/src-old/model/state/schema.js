'use strict';

/*
 * 单局状态结构定义 + 默认值。
 * 所有字段在这里声明一次，别处只读。
 */

const START_AGE = 7;
const STATE_VERSION = 3;

/** 各阶段年龄 */
const AGES = {
  mengxue: [7, 10],
  fuxue: [11, 14],
  gap: 15,
  exam: 15,
  admission: 16,
  tai: [16, 19],
  graduate: 20
};

/** 空状态骨架（不含随机内容） */
function emptyState() {
  return {
    version: STATE_VERSION,
    id: null,
    name: '无名',
    createdAt: null,
    seed: null,

    config: null,
    configVersion: 1,

    age: START_AGE,
    lifespan: 70,
    turn: 1,
    rev: 0,
    phase: 'event', // event | result | battle | ended

    fate: null,      // 命格 key
    talents: [],     // 天赋 key[]
    origin: [],      // 出身三段

    education: {
      stage: '蒙学',
      study: 0,
      examScore: null,
      examRank: null,
      lastExamAge: null,
      admission: null,   // direct | special | null
      admissionAge: null,
      reentry: false,
      craftChosen: false,
      craft: null,
      qiYears: 0,
      qiSensed: false
    },

    realms: {},
    activeRealm: 'body',

    hidden: {
      aptitude: 55,
      insight: 55,
      heart: 55,
      nature: 50,
      luck: 55,
      baseLuck: 55,
      caps: { aptitude: 70, insight: 70, heart: 70 },
      heartDecay: 0,
      selfDoubt: 0,
      insightBuff: { value: 0, untilAge: 0 },
      heartBuff: { value: 0, untilAge: 0 }
    },

    fortune: { body: 0, qi: 0, spirit: 0 },
    cognition: 0, // 养灵认知层数

    identity: {
      base: 'citizen',
      org: null,
      title: null,
      subjects: { mortal: 12, body: 2, qi: 0, spirit: 0 },
      herbs: 0,
      tags: []
    },

    methods: {},
    arts: {},
    mastery: {},
    equipment: { weapon: null },

    items: { money: 0 },
    skills: { alchemy: 0, forging: 0, talisman: 0, formation: 0 },
    skillTier: { alchemy: 1, forging: 1, talisman: 1, formation: 1 },

    flags: {},
    merit: 0,
    reputation: 0,
    worldRecognition: false,
    trueDao: false,
    borrowed: {}, // { realmKey: { stageIndex: times } }

    currentEventId: null,
    eventKind: null,
    tasks: [],
    seenEvents: [],
    lastEventId: null,
    declined: [],

    result: null,
    battle: null,
    ending: null,
    pendingEnding: null,
    ambientQueue: [],
    journal: [],

    incomeLog: []
  };
}

module.exports = { START_AGE, STATE_VERSION, AGES, emptyState };
