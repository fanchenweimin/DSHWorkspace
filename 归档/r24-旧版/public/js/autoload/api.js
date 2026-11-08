'use strict';

/** HTTP 封装 */

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const error = new Error(payload?.error?.message || '山中起了雾，请稍后再试。');
    error.code = payload?.error?.code || 'HTTP_ERROR';
    error.status = res.status;
    throw error;
  }
  return payload;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
export const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body || {}) });
export const del = (path) => api(path, { method: 'DELETE' });
