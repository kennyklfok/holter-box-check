import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  PASSCODE: string;
  IP_HASH_SECRET: string;
}

type CheckRow = { id: number; entered_by: string; checked_at: string };
const COOKIE = '__Host-holter_session';
const SESSION_MS = 20 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const NO_STORE = { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, ...headers } });
}

function unavailable(): Response {
  return json({ error: 'Service unavailable. Please contact your administrator.' }, 503);
}

function configured(env: Env): boolean {
  return Boolean(env.DB && /^[0-9]{8,12}$/.test(env.PASSCODE) && env.IP_HASH_SECRET);
}

function sameOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

function isJson(request: Request): boolean {
  return request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    if (!isJson(request) || Number(request.headers.get('Content-Length') || 0) > 2048) return null;
    const raw = await request.text();
    if (raw.length > 2048) return null;
    const data: unknown = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function hmac(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value))));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)__Host-holter_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] ?? null;
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = cookieValue(request);
  if (!token) return false;
  const session = await env.DB.prepare('SELECT secret_version, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256(token)).first<{ secret_version: string; expires_at: number }>();
  if (!session || session.expires_at <= Date.now()) return false;
  const version = await hmac(env.IP_HASH_SECRET, env.PASSCODE);
  return constantTimeEqual(session.secret_version, version);
}

async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  return await authorized(request, env) ? null : json({ error: 'Session expired. Enter the staff passcode again.' }, 401);
}

function serverError(error: unknown): Response {
  console.error('Holter box API failed', error instanceof Error ? error.message : 'Unknown error');
  return unavailable();
}

export async function login(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return unavailable();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  const data = await body(request);
  if (typeof data?.passcode !== 'string' || !/^[0-9]{8,12}$/.test(data.passcode)) return json({ error: 'Enter an 8–12 digit passcode.' }, 400);
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const key = await hmac(env.IP_HASH_SECRET, ip);
    const now = Date.now();
    const attempt = await env.DB.prepare(`
      INSERT INTO login_attempts (attempt_key, window_start, attempts) VALUES (?, ?, 1)
      ON CONFLICT(attempt_key) DO UPDATE SET
        attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
        window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
      RETURNING attempts
    `).bind(key, now, now - ATTEMPT_WINDOW_MS, now - ATTEMPT_WINDOW_MS).first<{ attempts: number }>();
    if (!attempt || attempt.attempts > MAX_ATTEMPTS) return json({ error: 'Too many passcode attempts. Try again in 15 minutes.' }, 429, { 'Retry-After': '900' });

    const enteredHash = await sha256(data.passcode);
    const expectedHash = await sha256(env.PASSCODE);
    if (!constantTimeEqual(enteredHash, expectedHash)) return json({ error: 'Incorrect passcode.' }, 401);

    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const version = await hmac(env.IP_HASH_SECRET, env.PASSCODE);
    await env.DB.prepare('INSERT INTO sessions (token_hash, secret_version, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(token), version, now + SESSION_MS).run();
    return json({ ok: true }, 200, {
      'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`,
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function logout(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return unavailable();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  try {
    const token = cookieValue(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  } catch (error) {
    return serverError(error);
  }
}

export async function status(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return unavailable();
  try {
    const denied = await requireAuth(request, env);
    if (denied) return denied;
    const latest = await env.DB.prepare('SELECT id, entered_by, checked_at FROM checks ORDER BY id DESC LIMIT 1').first<CheckRow>();
    return json({ latest });
  } catch (error) {
    return serverError(error);
  }
}

export async function history(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return unavailable();
  try {
    const denied = await requireAuth(request, env);
    if (denied) return denied;
    const before = new URL(request.url).searchParams.get('before');
    if (before !== null && (!/^[1-9]\d{0,14}$/.test(before) || !Number.isSafeInteger(Number(before)))) {
      return json({ error: 'Invalid history cursor.' }, 400);
    }
    const rows = before
      ? await env.DB.prepare('SELECT id, entered_by, checked_at FROM checks WHERE id < ? ORDER BY id DESC LIMIT 51').bind(Number(before)).all<CheckRow>()
      : await env.DB.prepare('SELECT id, entered_by, checked_at FROM checks ORDER BY id DESC LIMIT 51').all<CheckRow>();
    const items = rows.results.slice(0, 50);
    return json({ items, nextBefore: rows.results.length > 50 ? items[items.length - 1].id : null });
  } catch (error) {
    return serverError(error);
  }
}

export async function recordCheck(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return unavailable();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  try {
    const denied = await requireAuth(request, env);
    if (denied) return denied;
    const data = await body(request);
    const enteredBy = typeof data?.enteredBy === 'string' ? data.enteredBy.trim().replace(/\s+/g, ' ') : '';
    const requestId = data?.requestId;
    if (!enteredBy || enteredBy.length > 60 || !/^[\p{L}\p{M} .'-]+$/u.test(enteredBy)) {
      return json({ error: 'Enter staff initials or a name (letters only, up to 60 characters).' }, 400);
    }
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return json({ error: 'Invalid check request. Please reopen the form.' }, 400);
    }
    const checkedAt = new Date().toISOString();
    await env.DB.prepare('INSERT INTO checks (request_id, entered_by, checked_at) VALUES (?, ?, ?) ON CONFLICT(request_id) DO NOTHING')
      .bind(requestId, enteredBy, checkedAt).run();
    const item = await env.DB.prepare('SELECT id, entered_by, checked_at FROM checks WHERE request_id = ?').bind(requestId).first<CheckRow>();
    if (!item) return unavailable();
    return json({ item }, 201);
  } catch (error) {
    return serverError(error);
  }
}
