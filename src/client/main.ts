import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import './style.css';

type Check = { id: number; entered_by: string; checked_at: string };
type History = { items: Check[]; nextBefore: number | null };
type LockStatus = { hasCode: boolean; updatedAt: string | null };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const loginView = $('login-view');
const staffView = $('staff-view');
const dashboardView = $('dashboard-view');
const historyView = $('history-view');
const lockView = $('lock-view');
const dialog = $<HTMLDialogElement>('check-dialog');
const lockDialog = $<HTMLDialogElement>('lock-dialog');
const loginForm = $<HTMLFormElement>('login-form');
const checkForm = $<HTMLFormElement>('check-form');
const lockForm = $<HTMLFormElement>('lock-form');
const loginButton = $<HTMLButtonElement>('login-submit');
const passcodeInput = $<HTMLInputElement>('passcode');
const digitButtons = document.querySelectorAll<HTMLButtonElement>('[data-digit]');
const deleteButton = $<HTMLButtonElement>('passcode-delete');
const checkButton = $<HTMLButtonElement>('check-submit');
const menuButton = $<HTMLButtonElement>('menu-button');
const menuPanel = $('menu-panel');
const lockRevealButton = $<HTMLButtonElement>('lock-reveal');
const lockEditButton = $<HTMLButtonElement>('lock-edit');
const lockSubmitButton = $<HTMLButtonElement>('lock-submit');
let nextBefore: number | null = null;
let checkRequestId = '';
let checkingPasscode = false;
let lockPresent = false;
let lockVisible = false;
// A fresh QR visit always starts at the passcode, even on a shared device with an old cookie.
const sessionReset = fetch('/api/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }).catch(() => null);

function syncPasscode(): void {
  passcodeInput.value = passcodeInput.value.replace(/\D/g, '').slice(0, 12);
  loginButton.disabled = checkingPasscode || passcodeInput.value.length < 6;
}

function changePasscode(value: string): void {
  passcodeInput.value = value;
  syncPasscode();
  errorText('login-error', '');
}

function errorText(id: string, message: string): void {
  const element = $(id);
  element.textContent = message;
  element.hidden = !message;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  let data: Record<string, unknown> = {};
  try { data = await response.json() as Record<string, unknown>; } catch { /* Service failure has no JSON body. */ }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') showLogin();
    throw new Error(typeof data.error === 'string' ? data.error : 'Could not reach the service. Please try again.');
  }
  return data as T;
}

function showLogin(): void {
  staffView.hidden = true;
  loginView.hidden = false;
  closeMenu();
  if (dialog.open) dialog.close();
  if (lockDialog.open) lockDialog.close();
  $('success-message').hidden = true;
  hideLockCode();
  changePasscode('');
}

function showStaff(): void {
  loginView.hidden = true;
  staffView.hidden = false;
  changePasscode('');
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: 'long', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });

function localDate(utc: string): string { return dateFormatter.format(new Date(utc)); }
function localTime(utc: string): string { return timeFormatter.format(new Date(utc)); }

function renderLatest(check: Check | null): void {
  const target = $('latest-content');
  target.replaceChildren();
  if (!check) {
    const title = document.createElement('h1'); title.id = 'dashboard-title'; title.textContent = 'Holter box has not been checked yet.';
    target.append(title);
    return;
  }
  const title = document.createElement('h1'); title.id = 'dashboard-title'; title.textContent = 'Holter box last checked at:';
  const time = document.createElement('time'); time.className = 'latest-time'; time.dateTime = check.checked_at; time.textContent = localTime(check.checked_at);
  const meta = document.createElement('p'); meta.className = 'latest-meta';
  const date = document.createElement('span'); date.textContent = localDate(check.checked_at);
  const by = document.createElement('span'); by.textContent = `by ${check.entered_by}`;
  meta.append(date, document.createTextNode(' '), by);
  target.append(title, time, meta);
}

function historyRow(check: Check): HTMLElement {
  const row = document.createElement('div'); row.className = 'history-row';
  const when = document.createElement('div'); when.className = 'history-when';
  const date = document.createElement('strong'); date.textContent = localDate(check.checked_at);
  const time = document.createElement('time'); time.dateTime = check.checked_at; time.textContent = localTime(check.checked_at);
  when.append(date, time);
  const who = document.createElement('span'); who.className = 'history-who'; who.textContent = check.entered_by;
  row.append(when, who);
  return row;
}

async function loadHistory(reset = false): Promise<void> {
  const list = $('history-list');
  const button = $<HTMLButtonElement>('load-more');
  errorText('history-error', '');
  button.disabled = true;
  if (reset) { list.replaceChildren(); nextBefore = null; }
  try {
    const query = !reset && nextBefore ? `?before=${nextBefore}` : '';
    const result = await api<History>(`/api/history${query}`);
    if (reset && !result.items.length) {
      const empty = document.createElement('div'); empty.className = 'history-empty';
      const title = document.createElement('strong'); title.textContent = 'No checks yet';
      empty.append(title); list.append(empty);
    } else result.items.forEach(item => list.append(historyRow(item)));
    nextBefore = result.nextBefore;
    button.hidden = nextBefore === null;
  } catch (error) {
    errorText('history-error', error instanceof Error ? error.message : 'Could not load history.');
  } finally { button.disabled = false; }
}

function closeMenu(): void {
  menuPanel.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
}

function hideLockCode(): void {
  lockVisible = false;
  $('lock-code-display').textContent = lockPresent ? '••••••' : 'No code saved';
  lockRevealButton.textContent = 'Show code';
}

async function loadLockStatus(): Promise<void> {
  hideLockCode();
  $('lock-code-display').textContent = 'Loading…';
  lockRevealButton.hidden = true;
  lockEditButton.disabled = true;
  errorText('lock-error', '');
  try {
    const result = await api<LockStatus>('/api/lock-code');
    lockPresent = result.hasCode;
    hideLockCode();
    lockRevealButton.hidden = !result.hasCode;
    lockEditButton.textContent = result.hasCode ? 'Edit code' : 'Set code';
    const updated = $('lock-updated');
    updated.textContent = result.updatedAt ? `Updated ${localDate(result.updatedAt)} at ${localTime(result.updatedAt)}` : '';
    updated.hidden = !result.updatedAt;
    lockEditButton.disabled = false;
  } catch (error) {
    $('lock-code-display').textContent = 'Code unavailable';
    errorText('lock-error', error instanceof Error ? error.message : 'Could not load box lock code.');
  }
}

function setView(view: 'dashboard' | 'history' | 'lock'): void {
  dashboardView.hidden = view !== 'dashboard';
  historyView.hidden = view !== 'history';
  lockView.hidden = view !== 'lock';
  if (view !== 'lock') hideLockCode();
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(link => {
    link.classList.toggle('active', link.dataset.view === view);
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  closeMenu();
  if (view === 'history') void loadHistory(true);
  if (view === 'lock') void loadLockStatus();
}

async function refreshStatus(): Promise<void> {
  const data = await api<{ latest: Check | null }>('/api/status');
  renderLatest(data.latest);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const enteredPasscode = passcodeInput.value;
  if (!/^[0-9]{6,12}$/.test(enteredPasscode)) return;
  errorText('login-error', '');
  checkingPasscode = true;
  syncPasscode();
  passcodeInput.readOnly = true;
  digitButtons.forEach(button => { button.disabled = true; });
  deleteButton.disabled = true;
  loginButton.textContent = 'Checking…';
  try {
    await sessionReset;
    await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: enteredPasscode }) });
    await refreshStatus(); showStaff(); setView('dashboard');
  } catch (error) {
    passcodeInput.value = '';
    errorText('login-error', error instanceof Error ? error.message : 'Could not enter.');
  } finally {
    checkingPasscode = false;
    passcodeInput.readOnly = false;
    digitButtons.forEach(button => { button.disabled = false; });
    deleteButton.disabled = false;
    syncPasscode();
    loginButton.textContent = 'Enter';
  }
});

passcodeInput.addEventListener('input', () => { syncPasscode(); errorText('login-error', ''); });
digitButtons.forEach(button => button.addEventListener('click', () => changePasscode(passcodeInput.value + button.dataset.digit)));
deleteButton.addEventListener('click', () => changePasscode(passcodeInput.value.slice(0, -1)));

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view as 'dashboard' | 'history' | 'lock')));
$('load-more').addEventListener('click', () => void loadHistory());
menuButton.addEventListener('click', () => { menuPanel.hidden = !menuPanel.hidden; menuButton.setAttribute('aria-expanded', String(!menuPanel.hidden)); });
document.addEventListener('click', event => { if (event.target instanceof Element && !event.target.closest('.menu-wrap')) closeMenu(); });

$('open-check').addEventListener('click', () => {
  checkForm.reset(); errorText('check-error', ''); checkRequestId = crypto.randomUUID();
  dialog.showModal(); $('staff-name').focus();
});
$('dialog-close').addEventListener('click', () => dialog.close());
$('dialog-cancel').addEventListener('click', () => dialog.close());
checkForm.addEventListener('submit', async event => {
  event.preventDefault(); errorText('check-error', ''); checkButton.disabled = true; checkButton.textContent = 'Recording…';
  try {
    const result = await api<{ item: Check }>('/api/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enteredBy: $<HTMLInputElement>('staff-name').value, requestId: checkRequestId }) });
    renderLatest(result.item); dialog.close(); $('success-message').hidden = false; setView('dashboard');
  } catch (error) { errorText('check-error', error instanceof Error ? error.message : 'Could not record the check.'); }
  finally { checkButton.disabled = false; checkButton.textContent = 'Confirm check'; }
});

lockRevealButton.addEventListener('click', async () => {
  if (lockVisible) { hideLockCode(); return; }
  lockRevealButton.disabled = true;
  errorText('lock-error', '');
  try {
    const result = await api<{ code: string | null }>('/api/lock-code?reveal=1');
    if (result.code === null) { lockPresent = false; hideLockCode(); lockRevealButton.hidden = true; return; }
    $('lock-code-display').textContent = result.code;
    lockVisible = true;
    lockRevealButton.textContent = 'Hide code';
  } catch (error) {
    errorText('lock-error', error instanceof Error ? error.message : 'Could not show box lock code.');
  } finally { lockRevealButton.disabled = false; }
});

lockEditButton.addEventListener('click', () => {
  lockForm.reset();
  errorText('lock-form-error', '');
  $('lock-dialog-title').textContent = lockPresent ? 'Edit box lock code' : 'Set box lock code';
  lockDialog.showModal();
  $('new-lock-code').focus();
});
$('lock-dialog-close').addEventListener('click', () => lockDialog.close());
$('lock-dialog-cancel').addEventListener('click', () => lockDialog.close());
lockDialog.addEventListener('close', () => lockForm.reset());
lockForm.addEventListener('submit', async event => {
  event.preventDefault();
  const input = $<HTMLInputElement>('new-lock-code');
  const code = input.value;
  if (!/^[0-9]{3,12}$/.test(code)) { errorText('lock-form-error', 'Enter 3–12 digits.'); return; }
  errorText('lock-form-error', '');
  lockSubmitButton.disabled = true;
  lockSubmitButton.textContent = 'Saving…';
  try {
    await api('/api/lock-code', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    input.value = '';
    lockDialog.close();
    await loadLockStatus();
  } catch (error) {
    errorText('lock-form-error', error instanceof Error ? error.message : 'Could not save box lock code.');
  } finally { lockSubmitButton.disabled = false; lockSubmitButton.textContent = 'Save code'; }
});
