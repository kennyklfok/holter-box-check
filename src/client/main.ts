import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import './style.css';

type Check = { id: number; entered_by: string; checked_at: string };
type History = { items: Check[]; nextBefore: number | null };
type LockStatus = { hasCode: boolean; codeLength: number | null; updatedAt: string | null };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const loginView = $('login-view');
const staffView = $('staff-view');
const dashboardView = $('dashboard-view');
const historyView = $('history-view');
const lockView = $('lock-view');
const qrView = $('qr-view');
const dialog = $<HTMLDialogElement>('check-dialog');
const lockDialog = $<HTMLDialogElement>('lock-dialog');
const checkForm = $<HTMLFormElement>('check-form');
const lockForm = $<HTMLFormElement>('lock-form');
const passcodeDots = $('passcode-dots');
const lockCodeDots = $('lock-code-dots');
const digitButtons = document.querySelectorAll<HTMLButtonElement>('[data-digit]');
const deleteButton = $<HTMLButtonElement>('passcode-delete');
const lockDigitButtons = document.querySelectorAll<HTMLButtonElement>('[data-lock-digit]');
const lockDeleteButton = $<HTMLButtonElement>('lock-code-delete');
const checkButton = $<HTMLButtonElement>('check-submit');
const menuButton = $<HTMLButtonElement>('menu-button');
const menuPanel = $('menu-panel');
const lockRevealButton = $<HTMLButtonElement>('lock-reveal');
const lockEditButton = $<HTMLButtonElement>('lock-edit');
const lockSubmitButton = $<HTMLButtonElement>('lock-submit');
let nextBefore: number | null = null;
let checkRequestId = '';
let checkingPasscode = false;
let passcodeDigits = '';
let lockCodeDigits = '';
let savingLockCode = false;
let lockPresent = false;
let lockCodeLength: number | null = null;
let lockVisible = false;
let lockRevealTimer: number | null = null;
let statusRefreshId = 0;
// A fresh QR visit always starts at the passcode, even on a shared device with an old cookie.
const sessionReset = fetch('/api/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }).catch(() => null);

function haptic(duration = 10): void {
  navigator.vibrate?.(duration);
}

function renderDots(target: HTMLElement, value: string, length: number): void {
  target.querySelectorAll('span').forEach((dot, index) => dot.classList.toggle('filled', index < value.length));
  target.setAttribute('aria-label', `${value.length} of ${length} digits entered`);
}

function setPasscode(value: string): void {
  passcodeDigits = value.replace(/\D/g, '').slice(0, 6);
  renderDots(passcodeDots, passcodeDigits, 6);
}

function setLockCode(value: string): void {
  lockCodeDigits = value.replace(/\D/g, '').slice(0, 4);
  renderDots(lockCodeDots, lockCodeDigits, 4);
  lockSubmitButton.disabled = savingLockCode || lockCodeDigits.length !== 4;
}

function disableLoginPad(disabled: boolean): void {
  digitButtons.forEach(button => { button.disabled = disabled; });
  deleteButton.disabled = disabled;
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
  statusRefreshId++;
  staffView.hidden = true;
  loginView.hidden = false;
  closeMenu();
  if (dialog.open) dialog.close();
  if (lockDialog.open) lockDialog.close();
  $('success-message').hidden = true;
  hideLockCode();
  setPasscode('');
}

function showStaff(): void {
  loginView.hidden = true;
  staffView.hidden = false;
  setPasscode('');
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
  menuButton.setAttribute('aria-label', 'Open menu');
}

function hideLockCode(): void {
  if (lockRevealTimer !== null) window.clearTimeout(lockRevealTimer);
  lockRevealTimer = null;
  lockVisible = false;
  $('lock-code-display').textContent = lockPresent ? '•'.repeat(lockCodeLength || 4) : 'No code saved';
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
    lockCodeLength = result.codeLength;
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

type StaffView = 'dashboard' | 'history' | 'lock' | 'qr';

function setView(view: StaffView): void {
  dashboardView.hidden = view !== 'dashboard';
  historyView.hidden = view !== 'history';
  lockView.hidden = view !== 'lock';
  qrView.hidden = view !== 'qr';
  if (view !== 'lock') hideLockCode();
  if (view !== 'dashboard') $('success-message').hidden = true;
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
  errorText('status-error', '');
}

async function refreshStatusSafely(): Promise<void> {
  const refreshId = ++statusRefreshId;
  errorText('status-error', '');
  try {
    const data = await api<{ latest: Check | null }>('/api/status');
    if (refreshId === statusRefreshId && !staffView.hidden) renderLatest(data.latest);
  }
  catch (error) {
    if (refreshId === statusRefreshId && !staffView.hidden && !dashboardView.hidden) {
      errorText('status-error', error instanceof Error ? error.message : 'Could not refresh box status.');
    }
  }
}

function openView(view: StaffView): void {
  setView(view);
  if (view === 'dashboard') void refreshStatusSafely();
}

async function signIn(): Promise<void> {
  if (checkingPasscode || passcodeDigits.length !== 6) return;
  const enteredPasscode = passcodeDigits;
  errorText('login-error', '');
  checkingPasscode = true;
  disableLoginPad(true);
  try {
    await sessionReset;
    await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: enteredPasscode }) });
    await refreshStatus(); showStaff(); setView('dashboard');
  } catch (error) {
    setPasscode('');
    errorText('login-error', error instanceof Error ? error.message : 'Could not enter.');
    passcodeDots.classList.add('invalid');
    haptic(20);
    await new Promise(resolve => window.setTimeout(resolve, 400));
    passcodeDots.classList.remove('invalid');
  } finally {
    checkingPasscode = false;
    disableLoginPad(false);
  }
}

function addPasscodeDigit(digit: string): void {
  if (checkingPasscode || passcodeDigits.length >= 6) return;
  haptic();
  errorText('login-error', '');
  setPasscode(passcodeDigits + digit);
  if (passcodeDigits.length === 6) void signIn();
}

digitButtons.forEach(button => button.addEventListener('click', () => addPasscodeDigit(button.dataset.digit!)));
deleteButton.addEventListener('click', () => {
  if (checkingPasscode) return;
  haptic();
  setPasscode(passcodeDigits.slice(0, -1));
  errorText('login-error', '');
});

function addLockDigit(digit: string): void {
  if (savingLockCode || lockCodeDigits.length >= 4) return;
  haptic();
  setLockCode(lockCodeDigits + digit);
  errorText('lock-form-error', '');
}

lockDigitButtons.forEach(button => button.addEventListener('click', () => addLockDigit(button.dataset.lockDigit!)));
lockDeleteButton.addEventListener('click', () => { if (!savingLockCode) { haptic(); setLockCode(lockCodeDigits.slice(0, -1)); } });
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  if (lockDialog.open) {
    if (savingLockCode) return;
    if (/^[0-9]$/.test(event.key)) { event.preventDefault(); addLockDigit(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); setLockCode(lockCodeDigits.slice(0, -1)); }
  } else if (!loginView.hidden) {
    if (checkingPasscode) return;
    if (/^[0-9]$/.test(event.key)) { event.preventDefault(); addPasscodeDigit(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); setPasscode(passcodeDigits.slice(0, -1)); }
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => openView(button.dataset.view as StaffView)));
document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(button => button.addEventListener('click', () => openView('dashboard')));
$('load-more').addEventListener('click', () => void loadHistory());
$('print-qr').addEventListener('click', () => { document.body.classList.add('qr-print'); window.print(); });
window.addEventListener('afterprint', () => document.body.classList.remove('qr-print'));
menuButton.addEventListener('click', () => {
  menuPanel.hidden = !menuPanel.hidden;
  const expanded = !menuPanel.hidden;
  menuButton.setAttribute('aria-expanded', String(expanded));
  menuButton.setAttribute('aria-label', expanded ? 'Close menu' : 'Open menu');
});
document.addEventListener('click', event => { if (event.target instanceof Element && !event.target.closest('.menu-wrap')) closeMenu(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hideLockCode();
  else if (!staffView.hidden && !dashboardView.hidden) void refreshStatusSafely();
});

$('open-check').addEventListener('click', () => {
  haptic(12);
  checkForm.reset(); errorText('check-error', ''); checkRequestId = crypto.randomUUID();
  dialog.showModal(); $('staff-name').focus();
});
$('dialog-close').addEventListener('click', () => dialog.close());
$('dialog-cancel').addEventListener('click', () => { haptic(12); dialog.close(); });
checkForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (checkButton.disabled) return;
  haptic(16); errorText('check-error', ''); checkButton.disabled = true; checkButton.textContent = 'Recording…';
  try {
    const result = await api<{ item: Check }>('/api/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enteredBy: $<HTMLInputElement>('staff-name').value, requestId: checkRequestId }) });
    statusRefreshId++;
    renderLatest(result.item); errorText('status-error', ''); dialog.close(); $('success-message').hidden = false; setView('dashboard');
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
    if (lockView.hidden || staffView.hidden || document.visibilityState === 'hidden') { hideLockCode(); return; }
    $('lock-code-display').textContent = result.code;
    lockVisible = true;
    lockRevealButton.textContent = 'Hide code';
    lockRevealTimer = window.setTimeout(hideLockCode, 30_000);
  } catch (error) {
    errorText('lock-error', error instanceof Error ? error.message : 'Could not show box lock code.');
  } finally { lockRevealButton.disabled = false; }
});

lockEditButton.addEventListener('click', () => {
  setLockCode('');
  errorText('lock-form-error', '');
  $('lock-dialog-title').textContent = lockPresent ? 'Edit box lock code' : 'Set box lock code';
  lockDialog.showModal();
  lockDigitButtons[0].focus();
});
$('lock-dialog-close').addEventListener('click', () => lockDialog.close());
$('lock-dialog-cancel').addEventListener('click', () => lockDialog.close());
lockDialog.addEventListener('close', () => setLockCode(''));
lockForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (savingLockCode) return;
  const code = lockCodeDigits;
  if (!/^[0-9]{4}$/.test(code)) { errorText('lock-form-error', 'Enter four digits.'); return; }
  errorText('lock-form-error', '');
  savingLockCode = true;
  lockSubmitButton.disabled = true;
  lockDigitButtons.forEach(button => { button.disabled = true; });
  lockDeleteButton.disabled = true;
  lockSubmitButton.textContent = 'Saving…';
  try {
    await api('/api/lock-code', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    setLockCode('');
    lockDialog.close();
    await loadLockStatus();
  } catch (error) {
    errorText('lock-form-error', error instanceof Error ? error.message : 'Could not save box lock code.');
  } finally {
    savingLockCode = false;
    lockDigitButtons.forEach(button => { button.disabled = false; });
    lockDeleteButton.disabled = false;
    lockSubmitButton.textContent = 'Save code';
    lockSubmitButton.disabled = lockCodeDigits.length !== 4;
  }
});
