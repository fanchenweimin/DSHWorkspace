'use strict';

import { escapeHtml, paragraphs } from '../autoload/toast.js';

/** 可复用的 DOM 片段 */

export function realmRail(vm, { onFocus, canFocus }) {
  return vm.realms
    .map((realm) => {
      const tag = realm.stageTag ? ` · ${realm.stageTag}` : '';
      const status = realm.completed
        ? '大圆满'
        : realm.blocked
          ? '瓶颈'
          : realm.awaiting === 'world'
            ? '待认可'
            : realm.awaiting === 'dao'
              ? '待悟道'
              : realm.active
                ? '主修'
                : '可切换';
      return `
      <button type="button" class="realm-tile ${realm.active ? 'is-active' : ''}"
        ${realm.active || realm.completed || !canFocus ? 'disabled' : ''}
        data-realm="${escapeHtml(realm.key)}"
        style="--realm-accent:${escapeHtml(realm.accent)};--realm-soft:${escapeHtml(realm.soft)}">
        <span class="realm-head">
          <span class="realm-seal">${escapeHtml(realm.seal)}</span>
          <span class="realm-info">
            <strong>${escapeHtml(realm.name)}</strong>
            <span>${escapeHtml(realm.stageName)}${escapeHtml(tag)}</span>
          </span>
          <span class="realm-badge">${escapeHtml(status)}</span>
        </span>
        <span class="realm-bar"><span style="width:${realm.progress}%"></span></span>
        <span class="realm-foot">
          <span>${realm.completed ? '已至大圆满' : realm.active ? '主修中' : '点击切换主修'}</span>
          <span>${realm.completed ? 100 : realm.progress}%</span>
        </span>
      </button>`;
    })
    .join('');
}

export function choiceList(event) {
  return event.choices
    .map((choice, index) => {
      const letter = String.fromCharCode(65 + index);
      const meta = [
        choice.hint ? `<span class="choice-hint">${escapeHtml(choice.hint)}</span>` : '',
        ...(choice.tags || []).map((tag) => `<span class="mini-tag">${escapeHtml(tag)}</span>`),
        choice.evil ? '<span class="mini-tag evil">邪</span>' : ''
      ]
        .filter(Boolean)
        .join('');

      return `
      <button type="button" class="choice ${choice.evil ? 'evil' : ''}"
        data-choice="${escapeHtml(choice.id)}"
        ${choice.available ? '' : 'disabled'}>
        <span class="choice-letter">${letter}</span>
        <span class="choice-body">
          <span class="choice-label">${escapeHtml(choice.label)}</span>
          ${meta ? `<span class="choice-meta">${meta}</span>` : ''}
        </span>
        <span class="choice-side">
          <span>约 ${choice.years} 年</span>
          ${choice.available ? '' : `<span class="blocked">${escapeHtml(choice.reason)}</span>`}
        </span>
      </button>`;
    })
    .join('');
}

export function changesBar(changes) {
  if (!changes || !changes.length) return '';
  return `<div class="changes">${changes
    .map((c) => `<span class="change">${escapeHtml(c.label)}<strong>${escapeHtml(c.value)}</strong></span>`)
    .join('')}</div>`;
}

export function notesBlock(notes) {
  if (!notes || !notes.length) return '';
  return `<div class="notes">${notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}</div>`;
}

export function journalList(journal) {
  if (!journal || !journal.length) return '<p class="journal-text">还没有什么可记的。</p>';
  return journal
    .slice(-8)
    .reverse()
    .map(
      (entry) => `
      <div class="journal-item">
        <span class="journal-age">${entry.age}岁</span>
        <span class="journal-title">${escapeHtml(entry.title)}</span>
        <p class="journal-text">${escapeHtml(String(entry.text || '').slice(0, 46))}${String(entry.text || '').length > 46 ? '…' : ''}</p>
      </div>`
    )
    .join('');
}

export function quickBag(inv) {
  const count = (type) => inv.items.filter((i) => i.type === type).reduce((s, i) => s + i.count, 0);
  return `
    <div class="kv"><span>钱财</span><strong>${escapeHtml(inv.moneyLabel)}</strong></div>
    <div class="kv"><span>器</span><strong>${escapeHtml(inv.weapon || '无')}</strong></div>
    <div class="kv"><span>符箓</span><strong>${count('talisman') || '无'}</strong></div>
    <div class="kv"><span>丹药</span><strong>${count('pill') || '无'}</strong></div>`;
}

export function storyFrame(content, extraClass = '') {
  return `<article class="story-card ${extraClass}">${content}</article>`;
}

export { escapeHtml, paragraphs };
