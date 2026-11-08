'use strict';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 去掉 HTML 与控制字符，限制长度 */
function cleanName(name, max = 12) {
  const clean = String(name || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>&"'`\\[\]{}()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return clean || '无名';
}

function cleanText(value, max = 600) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .trim()
    .slice(0, max);
}

module.exports = { clamp, cleanName, cleanText };
