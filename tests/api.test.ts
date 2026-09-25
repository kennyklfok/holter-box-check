import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { history, login, logout, recordCheck, status, type Env } from '../src/server/api';

type Check = { id: number; request_id: string; entered_by: string; checked_at: string };

class MemoryDB {
  sessions = new Map<string, { secret_version: string; expires_at: number }>();
  attempts = new Map<string, { window_start: number; attempts: number }>();
  checks: Check[] = [];

  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    return {
      bind(...values: unknown[]) { args = values; return this; },
      async first<T>(): Promise<T | null> {
        if (sql.includes('RETURNING attempts')) {
          const [key, now, cutoff] = args as [string, number, number];
          const previous = db.attempts.get(key);
          const next = !previous || previous.window_start <= cutoff ? { window_start: now, attempts: 1 } : { ...previous, attempts: previous.attempts + 1 };
          db.attempts.set(key, next);
          return { attempts: next.attempts } as T;
        }
        if (sql.includes('FROM sessions')) return (db.sessions.get(args[0] as string) ?? null) as T | null;
        if (sql.includes('WHERE request_id = ?')) return (db.checks.find(item => item.request_id === args[0]) ?? null) as T | null;
        if (sql.includes('FROM checks')) return (db.checks.at(-1) ?? null) as T | null;
        throw Error(`Unexpected first query: ${sql}`);
      },
      async run() {
        if (sql.startsWith('INSERT INTO sessions')) {
          const [hash, version, expiry] = args as [string, string, number];
          db.sessions.set(hash, { secret_version: version, expires_at: expiry });
        } else if (sql.startsWith('DELETE FROM sessions')) db.sessions.delete(args[0] as string);
        else if (sql.startsWith('INSERT INTO checks')) {
          const [requestId, enteredBy, checkedAt] = args as [string, string, string];
          if (!db.checks.some(item => item.request_id === requestId)) db.checks.push({ id: db.checks.length + 1, request_id: requestId, entered_by: enteredBy, checked_at: checkedAt });
        } else throw Error(`Unexpected run query: ${sql}`);
        return {};
      },
      async all<T>() {
        const before = args[0] as number | undefined;
        return { results: [...db.checks].reverse().filter(item => before === undefined || item.id < before).slice(0, 51) as T[] };
      },
    };
  }
}

const ORIGIN = 'https://holter-box-check.pages.dev';
const ID = 'b84d5159-05e1-4ac5-b074-a57176b8bfad';
function env(db: MemoryDB): Env {
  return { DB: db as unknown as D1Database, PASSCODE: 'example-test-passcode', IP_HASH_SECRET: 'test-only-random-secret' };
}
function get(path: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}
function post(path: string, data: unknown, cookie?: string, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) });
}
async function signIn(context: Env): Promise<string> {
  const response = await login(post('/api/login', { passcode: context.PASSCODE }), context);
  expect(response.status).toBe(200);
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Strict');
  expect(response.headers.get('Set-Cookie')).toContain('Max-Age=1200');
  return response.headers.get('Set-Cookie')!.split(';')[0];
}

describe('passcode protection', () => {
  it('keeps latest check, history, and recording private without a session', async () => {
    const context = env(new MemoryDB());
    expect((await status(get('/api/status'), context)).status).toBe(401);
    expect((await history(get('/api/history'), context)).status).toBe(401);
    expect((await recordCheck(post('/api/checks', { enteredBy: 'AB', requestId: ID }), context)).status).toBe(401);
  });

  it('rejects wrong passcodes, rate limits attempts, and blocks cross-origin posts', async () => {
    const context = env(new MemoryDB());
    expect((await login(post('/api/login', { passcode: 'wrong' }, undefined, 'https://other.example'), context)).status).toBe(403);
    for (let i = 0; i < 10; i++) expect((await login(post('/api/login', { passcode: 'wrong' }), context)).status).toBe(401);
    expect((await login(post('/api/login', { passcode: context.PASSCODE }), context)).status).toBe(429);
  });

  it('invalidates sessions on logout and passcode rotation', async () => {
    const context = env(new MemoryDB());
    const cookie = await signIn(context);
    expect((await status(get('/api/status', cookie), context)).status).toBe(200);
    context.PASSCODE = 'new-example-passcode';
    expect((await status(get('/api/status', cookie), context)).status).toBe(401);
    const newCookie = await signIn(context);
    expect((await logout(post('/api/logout', {}, newCookie), context)).status).toBe(200);
    expect((await status(get('/api/status', newCookie), context)).status).toBe(401);
  });
});

describe('check recording', () => {
  it('uses server UTC time, records a single check per request ID, and returns newest first', async () => {
    const db = new MemoryDB();
    const context = env(db);
    const cookie = await signIn(context);
    expect(await (await status(get('/api/status', cookie), context)).json()).toEqual({ latest: null });
    const before = Date.now();
    const first = await recordCheck(post('/api/checks', { enteredBy: ' AB ', requestId: ID }, cookie), context);
    expect(first.status).toBe(201);
    const item = (await first.json() as { item: Check }).item;
    expect(item.entered_by).toBe('AB');
    expect(Date.parse(item.checked_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(item.checked_at)).toBeLessThanOrEqual(Date.now());
    await recordCheck(post('/api/checks', { enteredBy: 'CD', requestId: ID }, cookie), context);
    expect(db.checks).toHaveLength(1);
    const secondId = 'a64654bb-7393-4f17-b484-31f734090b19';
    await recordCheck(post('/api/checks', { enteredBy: 'CD', requestId: secondId }, cookie), context);
    const rows = await (await history(get('/api/history', cookie), context)).json() as { items: Check[] };
    expect(rows.items.map(row => row.entered_by)).toEqual(['CD', 'AB']);
    expect((await recordCheck(post('/api/checks', { enteredBy: 'Patient 123', requestId: crypto.randomUUID() }, cookie), context)).status).toBe(400);
    expect((await recordCheck(post('/api/checks', { enteredBy: 'EF', requestId: crypto.randomUUID() }, cookie, 'https://other.example'), context)).status).toBe(403);
  });
});
