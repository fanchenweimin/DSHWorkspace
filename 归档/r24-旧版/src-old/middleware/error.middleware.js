'use strict';

const { GameError } = require('../model/systems/view.helper');

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function headers(extra = {}) {
  return { ...SECURITY, ...extra };
}

function json(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(
    status,
    headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      ...extra
    })
  );
  res.end(body);
}

function fail(res, error) {
  if (error instanceof GameError) {
    json(res, error.status || 400, { error: { code: error.code, message: error.message } });
    return;
  }
  console.error(error);
  json(res, 500, { error: { code: 'INTERNAL', message: '山中有雾，服务暂时没有回应。' } });
}

module.exports = { SECURITY, headers, json, fail };
