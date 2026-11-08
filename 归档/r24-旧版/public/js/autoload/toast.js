'use strict';

let timer = null;

export function toast(message, duration = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (timer) clearTimeout(timer);
  el.textContent = message;
  el.hidden = false;
  timer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

export function formatMoney(copper) {
  const value = Math.max(0, Math.round(Number(copper) || 0));
  const gold = Math.floor(value / 10000);
  const silver = Math.floor((value % 10000) / 100);
  const rest = value % 100;
  const parts = [];
  if (gold) parts.push(`${gold}金`);
  if (silver) parts.push(`${silver}银`);
  if (rest || !parts.length) parts.push(`${rest}铜`);
  return parts.join(' ');
}
