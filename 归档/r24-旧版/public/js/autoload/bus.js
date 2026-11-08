'use strict';

/** 极简信号总线（Godot signal 的对应物） */

const listeners = new Map();

export function on(name, handler) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(handler);
  return () => off(name, handler);
}

export function off(name, handler) {
  listeners.get(name)?.delete(handler);
}

export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (error) {
      console.error('[bus]', name, error);
    }
  }
}

export const Bus = { on, off, emit };
