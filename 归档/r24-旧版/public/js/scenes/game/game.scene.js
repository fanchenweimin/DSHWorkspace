'use strict';

import { Store } from '../../autoload/store.js';
import { Session } from '../../autoload/session.js';
import { on, emit } from '../../autoload/bus.js';
import { toast, escapeHtml, paragraphs } from '../../autoload/toast.js';
import { GameController } from '../../controller/game.controller.js';
import {
  realmRail,
  choiceList,
  changesBar,
  notesBlock,
  journalList,
  quickBag,
  storyFrame
} from '../../components/nodes.js';

const dom = {};

function cache() {
  dom.age = document.getElementById('age');
  dom.calendar = document.getElementById('calendar');
  dom.school = document.getElementById('school');
  dom.identity = document.getElementById('identity');
  dom.soulMass = document.getElementById('soulMass');
  dom.realmRail = document.getElementById('realmRail');
  dom.storyPanel = document.getElementById('storyPanel');
  dom.journal = document.getElementById('journal');
  dom.quickBag = document.getElementById('quickBag');
  dom.account = document.getElementById('account');
  dom.drawerRoot = document.getElementById('drawerRoot');
  dom.drawerTitle = document.getElementById('drawerTitle');
  dom.drawerKicker = document.getElementById('drawerKicker');
  dom.drawerBody = document.getElementById('drawerBody');
}

function renderStatus(vm) {
  dom.age.textContent = vm.age;
  dom.calendar.textContent = vm.calendar;
  dom.school.textContent = vm.education.stage;
  dom.identity.textContent = vm.identity.name;
  dom.soulMass.textContent = `${vm.identity.soulMass}（×${vm.identity.spiritMultiplier}）`;
}

function renderAccount() {
  const user = Session.get();
  if (!user) {
    dom.account.innerHTML = '<a class="chip" href="/login.html">登录</a>';
    return;
  }
  dom.account.innerHTML = `
    <span class="chip">${escapeHtml(user.username)}${user.role === 'sysadmin' ? ' · 管理员' : ''}</span>
    ${user.role === 'sysadmin' ? '<a class="chip" href="/admin.html">配置</a>' : ''}
    <a class="chip" href="/">首页</a>`;
}

/* ─── 各阶段渲染 ─── */

function renderEvent(vm) {
  const event = vm.event;
  const canFocus = ['event', 'result'].includes(vm.phase);
  dom.realmRail.innerHTML = realmRail(vm, { canFocus });

  const actions = `
    <div class="actions-bar">
      <span class="label">不选这件事，也可以：</span>
      <button type="button" class="btn btn-small btn-ghost" data-drawer="cultivate">修炼</button>
      <button type="button" class="btn btn-small btn-ghost" data-drawer="commission">委托</button>
      <button type="button" class="btn btn-small btn-ghost" data-drawer="bag">行囊</button>
      ${vm.admin ? '<button type="button" class="btn btn-small btn-ghost" data-drawer="hidden">观己</button>' : ''}
    </div>`;

  const isAmbient = event.kind === 'ambient' || !event.choices.length;

  dom.storyPanel.innerHTML = storyFrame(`
    <header class="story-head">
      <span class="story-icon">${escapeHtml(event.icon || '缘')}</span>
      <div>
        <p class="story-kicker">${escapeHtml(event.kicker || '')} · ${escapeHtml(vm.calendar)}</p>
        <h1 class="story-title">${escapeHtml(event.title)}</h1>
        <p class="story-meta">${vm.age}岁 · ${escapeHtml(vm.identity.name)} · 第 ${vm.turn || 1} 幕</p>
      </div>
    </header>
    <div class="story-copy">${paragraphs(event.body)}</div>
    ${
      isAmbient
        ? `<footer class="story-foot">
             <span>这一年就这样过去了。</span>
             <button type="button" class="btn btn-primary" data-action="next">继续前行 →</button>
           </footer>`
        : `<div class="story-divider"></div>
           <div class="choice-head">
             <h2>你要如何选？</h2>
             <span>选择就在此地，不弹窗</span>
           </div>
           <div class="choices">${choiceList(event)}</div>
           ${actions}`
    }
  `);
}

function renderResult(vm) {
  const result = vm.result;
  dom.realmRail.innerHTML = realmRail(vm, { canFocus: true });

  dom.storyPanel.innerHTML = storyFrame(
    `
    <header class="result-head">
      <span class="result-mark">果</span>
      <div>
        <p class="story-kicker">${escapeHtml(result.kicker || '')}</p>
        <h1 class="story-title">${escapeHtml(result.title)}</h1>
        ${result.years ? `<p class="story-meta">岁月 +${result.years} 年</p>` : ''}
      </div>
    </header>
    <div class="story-copy">${paragraphs(result.paragraphs.join('\n\n'))}</div>
    ${notesBlock(result.notes)}
    ${changesBar(result.changes)}
    <footer class="story-foot">
      <span>${vm.pendingEnding ? '大限将至，这一页之后便是终章。' : '山高水长，继续往前。'}</span>
      <button type="button" class="btn btn-primary" data-action="next">
        ${vm.pendingEnding ? '走到人生尽头' : '继续前行'} →
      </button>
    </footer>
  `,
    'result-card'
  );
}

function renderBattle(vm) {
  const b = vm.battle;
  const bar = (cls, cur, max, label) => `
    <div class="bar-box">
      <div class="bar-label"><span>${escapeHtml(label)}</span><span>${cur} / ${max}</span></div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.max(0, (cur / max) * 100)}%"></div></div>
    </div>`;

  const actions = b.over
    ? `<button type="button" class="btn btn-primary" data-action="finish">结算此战 →</button>`
    : `<div class="battle-actions">${b.actions
        .map(
          (a) => `
        <button type="button" class="battle-action" data-battle="${escapeHtml(a.id)}" ${a.available ? '' : 'disabled'}>
          <strong>${escapeHtml(a.name)}</strong>
          <small>${escapeHtml(a.available ? a.desc : a.reason)}</small>
        </button>`
        )
        .join('')}</div>
      <div class="actions-bar">
        <span class="label">不想打了：</span>
        ${b.canSurrender ? '<button type="button" class="btn btn-small btn-ghost" data-battle="surrender">认输</button>' : ''}
        ${b.canFlee ? '<button type="button" class="btn btn-small btn-ghost" data-battle="flee">遁走</button>' : ''}
      </div>`;

  dom.storyPanel.innerHTML = storyFrame(`
    <header class="story-head">
      <span class="story-icon">斗</span>
      <div>
        <p class="story-kicker">${escapeHtml(b.combatLevelLabel)} · 第 ${b.round} / ${b.maxRounds} 回合</p>
        <h1 class="story-title">${escapeHtml(b.opponent.name)}</h1>
        <p class="story-meta">${escapeHtml(b.opponent.title)} · ${escapeHtml(b.opponent.rank)}</p>
      </div>
    </header>
    <div class="story-copy"><p>${escapeHtml(b.opponent.desc)}</p></div>
    <div class="battle-bars">
      ${bar('player', b.playerHp, b.playerMaxHp, '你')}
      ${bar('enemy', b.enemyHp, b.enemyMaxHp, b.opponent.name)}
    </div>
    <div class="gap-banner ${escapeHtml(b.gap.key)}">境界差距：${escapeHtml(b.gap.name)}</div>
    ${b.intent ? `<div class="intent-banner">对方气机·${escapeHtml(b.intent.label)}：${escapeHtml(b.intent.desc)}</div>` : ''}
    <div class="battle-log">${b.log.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>
    ${actions}
  `);
}

function renderEnding(vm) {
  const e = vm.ending;
  dom.storyPanel.innerHTML = storyFrame(`
    <header class="result-head">
      <span class="result-mark">终</span>
      <div>
        <p class="story-kicker">一生终章 · ${vm.age}岁</p>
        <h1 class="story-title">${escapeHtml(e.title)}</h1>
      </div>
    </header>
    <div class="story-copy"><p>${escapeHtml(e.subtitle)}</p></div>
    <footer class="story-foot">
      <span>${escapeHtml(vm.name)} · ${vm.age}岁 · ${escapeHtml(vm.education.stage)}</span>
      <a class="btn btn-primary" href="/">返回首页</a>
    </footer>
  `);
}

/* ─── 抽屉 ─── */

function openDrawer(kind) {
  const vm = Store.viewModel();
  const titles = {
    cultivate: ['修行', '修炼与闭关'],
    commission: ['委托', '接一份差事'],
    bag: ['行囊', '随身之物'],
    hidden: ['内视 · 管理员', '观己']
  };
  const [kicker, title] = titles[kind] || ['', ''];

  dom.drawerKicker.textContent = kicker;
  dom.drawerTitle.textContent = title;
  dom.drawerBody.innerHTML = drawerContent(kind, vm);
  dom.drawerRoot.hidden = false;
  document.body.classList.add('modal-open');
}

function closeDrawer() {
  dom.drawerRoot.hidden = true;
  dom.drawerBody.innerHTML = '';
  document.body.classList.remove('modal-open');
}

function drawerContent(kind, vm) {
  if (kind === 'cultivate') {
    const list = vm.actions.cultivate;
    if (!list.length) return '<p>此刻不能修炼。</p>';
    return `
      <section class="drawer-section">
        <p>每次修炼消耗一年。养灵不认静修。</p>
        <div class="option-list">
          ${list
            .map(
              (opt) => `
            <div class="option-row">
              <div>
                <strong>${escapeHtml(opt.label)}</strong>
                <small>${escapeHtml(opt.available ? opt.hint : opt.reason)}</small>
              </div>
              <button type="button" class="btn btn-small btn-ghost" data-cultivate="${escapeHtml(opt.id)}" ${opt.available ? '' : 'disabled'}>
                ${opt.seclusion ? '闭关' : '修炼'}
              </button>
            </div>`
            )
            .join('')}
        </div>
      </section>`;
  }

  if (kind === 'commission') {
    const list = vm.actions.commissions;
    return `
      <section class="drawer-section">
        <p>委托会花掉一到两年，别错过该做的事。</p>
        <div class="option-list">
          ${list
            .map(
              (task) => `
            <div class="option-row">
              <div>
                <strong>${escapeHtml(task.name)}</strong>
                <small>${escapeHtml(task.desc)} · 约 ${task.years} 年</small>
              </div>
              <button type="button" class="btn btn-small btn-ghost" data-commission="${escapeHtml(task.id)}">接下</button>
            </div>`
            )
            .join('')}
        </div>
      </section>`;
  }

  if (kind === 'bag') {
    const inv = vm.inventory;
    return `
      <section class="drawer-section">
        <h3>钱财</h3>
        <p>${escapeHtml(inv.moneyLabel)}</p>
      </section>
      <section class="drawer-section">
        <h3>器</h3>
        <p>${escapeHtml(inv.weapon || '尚无兵器')}</p>
      </section>
      <section class="drawer-section">
        <h3>物品</h3>
        <div class="option-list">
          ${
            inv.items.length
              ? inv.items
                  .map(
                    (item) => `
            <div class="option-row">
              <div><strong>${escapeHtml(item.name)} × ${item.count}</strong><small>${escapeHtml(item.desc)}</small></div>
            </div>`
                  )
                  .join('')
              : '<p>行囊空空。</p>'
          }
        </div>
      </section>
      <section class="drawer-section">
        <h3>百艺</h3>
        <div class="option-list">
          ${vm.skills
            .map(
              (s) => `<div class="option-row"><div><strong>${escapeHtml(s.name)}</strong><small>${s.level} 阶 · 天赋 ${s.talent}</small></div></div>`
            )
            .join('')}
        </div>
      </section>`;
  }

  if (kind === 'hidden') {
    const admin = vm.admin;
    if (!admin) return '<p>没有权限。</p>';
    const h = admin.hidden;
    return `
      <section class="drawer-section">
        <h3>寿数</h3>
        <div class="stat-grid">
          <div class="stat-cell"><span>当前</span><strong>${vm.age} 岁</strong></div>
          <div class="stat-cell"><span>寿命总数</span><strong>${admin.lifespan} 岁</strong></div>
          <div class="stat-cell"><span>尚余</span><strong>${admin.remaining} 年</strong></div>
          <div class="stat-cell"><span>气运</span><strong>${h.luck}</strong></div>
        </div>
      </section>
      <section class="drawer-section">
        <h3>四数</h3>
        <div class="stat-grid">
          <div class="stat-cell"><span>资质</span><strong>${h.aptitude} / ${h.caps.aptitude}</strong></div>
          <div class="stat-cell"><span>悟性</span><strong>${h.insight} / ${h.caps.insight}</strong></div>
          <div class="stat-cell"><span>心性</span><strong>${h.heart} / ${h.caps.heart}</strong></div>
          <div class="stat-cell"><span>本性</span><strong>${h.nature}（${escapeHtml(admin.natureLabel)}）</strong></div>
        </div>
      </section>
      <section class="drawer-section">
        <h3>灵量</h3>
        <p>${admin.soulMass} → 养灵增益 ×${admin.spiritMultiplier}</p>
      </section>
      <section class="drawer-section">
        <h3>机缘 / 认知</h3>
        <p>机缘：${JSON.stringify(admin.fortune)} · 认知：${admin.cognition}</p>
      </section>
      <section class="drawer-section">
        <h3>认可</h3>
        <p>可追世界认可：${admin.canSeekRecognition ? '是' : '否'}</p>
        <p>记功 ${admin.merit} · 声望 ${admin.reputation}</p>
      </section>`;
  }

  return '';
}

/* ─── 主渲染 ─── */

export function render() {
  const vm = Store.viewModel();
  if (!vm) return;
  renderStatus(vm);
  renderAccount();
  dom.journal.innerHTML = journalList(vm.journal);
  dom.quickBag.innerHTML = quickBag(vm.inventory);

  switch (vm.phase) {
    case 'event':
      renderEvent(vm);
      break;
    case 'result':
      renderResult(vm);
      break;
    case 'battle':
      renderBattle(vm);
      break;
    case 'ended':
      renderEnding(vm);
      break;
    default:
      dom.storyPanel.innerHTML = storyFrame('<p>正在推演……</p>');
  }
}

export function bind() {
  cache();

  document.addEventListener('click', async (event) => {
    const choice = event.target.closest('[data-choice]');
    if (choice && !choice.disabled) return GameController.choose(choice.dataset.choice);

    const next = event.target.closest('[data-action="next"]');
    if (next) return GameController.next();

    const finish = event.target.closest('[data-action="finish"]');
    if (finish) return GameController.battle('finish');

    const battleBtn = event.target.closest('[data-battle]');
    if (battleBtn && !battleBtn.disabled) return GameController.battle(battleBtn.dataset.battle);

    const realm = event.target.closest('[data-realm]');
    if (realm && !realm.disabled) return GameController.focus(realm.dataset.realm);

    const drawerBtn = event.target.closest('[data-drawer]');
    if (drawerBtn) return openDrawer(drawerBtn.dataset.drawer);

    if (event.target.closest('[data-close-drawer]')) return closeDrawer();

    const cult = event.target.closest('[data-cultivate]');
    if (cult && !cult.disabled) {
      const opt = Store.viewModel().actions.cultivate.find((o) => o.id === cult.dataset.cultivate);
      let years = 1;
      if (opt?.seclusion) {
        const input = window.prompt('闭关几年？（1–50，钱花光会被打断）', '5');
        years = Number(input) || 1;
      }
      closeDrawer();
      return GameController.cultivate(cult.dataset.cultivate, years);
    }

    const commission = event.target.closest('[data-commission]');
    if (commission) {
      closeDrawer();
      return GameController.commission(commission.dataset.commission);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.drawerRoot.hidden) closeDrawer();
  });

  on('state:changed', render);
  on('run:reload', () => GameController.reload());
}

export { cache, closeDrawer, openDrawer };
