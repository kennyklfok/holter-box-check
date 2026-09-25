import './style.css';

type Check = { id: number; entered_by: string; checked_at: string };
type History = { items: Check[]; nextBefore: number | null };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const loadingView = $('loading-view');
const loginView = $('login-view');
const staffView = $('staff-view');
const dashboardView = $('dashboard-view');
const historyView = $('history-view');
const dialog = $<HTMLDialogElement>('check-dialog');
const loginForm = $<HTMLFormElement>('login-form');
const checkForm = $<HTMLFormElement>('check-form');
const loginButton = $<HTMLButtonElement>('login-submit');
const checkButton = $<HTMLButtonElement>('check-submit');
const menuButton = $<HTMLButtonElement>('menu-button');
const mobileMenu = $('mobile-menu');
let nextBefore: number | null = null;
let checkRequestId = '';

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
  loadingView.hidden = true;
  staffView.hidden = true;
  loginView.hidden = false;
  $('top-actions').hidden = true;
  mobileMenu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  if (dialog.open) dialog.close();
  $('success-message').hidden = true;
  $('passcode').focus();
}

function showStaff(): void {
  loadingView.hidden = true;
  loginView.hidden = true;
  staffView.hidden = false;
  $('top-actions').hidden = false;
  $<HTMLInputElement>('passcode').value = '';
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: 'long', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });

function localDate(utc: string): string { return dateFormatter.format(new Date(utc)); }
function localTime(utc: string): string { return timeFormatter.format(new Date(utc)); }

function renderLatest(check: Check | null): void {
  const target = $('latest-content');
  target.replaceChildren();
  if (!check) {
    const title = document.createElement('h2'); title.textContent = 'No checks recorded yet';
    const note = document.createElement('p'); note.textContent = 'Once a staff member checks the box, the latest check will appear here.';
    target.append(title, note);
    return;
  }
  const date = document.createElement('h2'); date.textContent = localDate(check.checked_at);
  const time = document.createElement('div'); time.className = 'latest-time'; time.textContent = localTime(check.checked_at);
  const by = document.createElement('p'); by.className = 'checked-by'; by.textContent = `Checked by ${check.entered_by}`;
  target.append(date, time, by);
}

function historyRow(check: Check): HTMLElement {
  const row = document.createElement('div'); row.className = 'history-row';
  const icon = document.createElement('span'); icon.className = 'history-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✓';
  const when = document.createElement('div'); when.className = 'history-when';
  const date = document.createElement('strong'); date.textContent = localDate(check.checked_at);
  const time = document.createElement('span'); time.textContent = localTime(check.checked_at);
  when.append(date, time);
  const who = document.createElement('span'); who.className = 'history-who'; who.textContent = check.entered_by;
  row.append(icon, when, who);
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
      const note = document.createElement('p'); note.textContent = 'The first recorded check will appear here.';
      empty.append(title, note); list.append(empty);
    } else result.items.forEach(item => list.append(historyRow(item)));
    nextBefore = result.nextBefore;
    button.hidden = nextBefore === null;
  } catch (error) {
    errorText('history-error', error instanceof Error ? error.message : 'Could not load history.');
  } finally { button.disabled = false; }
}

function closeMenu(): void {
  mobileMenu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
}

function setView(view: 'dashboard' | 'history'): void {
  dashboardView.hidden = view !== 'dashboard';
  historyView.hidden = view !== 'history';
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(link => {
    link.classList.toggle('active', link.dataset.view === view);
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  closeMenu();
  if (view === 'history') void loadHistory(true);
}

async function refreshStatus(): Promise<void> {
  const data = await api<{ latest: Check | null }>('/api/status');
  renderLatest(data.latest);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault(); errorText('login-error', ''); loginButton.disabled = true; loginButton.textContent = 'Checking…';
  try {
    await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: $<HTMLInputElement>('passcode').value }) });
    await refreshStatus(); showStaff(); setView('dashboard');
  } catch (error) { errorText('login-error', error instanceof Error ? error.message : 'Could not sign in.'); }
  finally { loginButton.disabled = false; loginButton.innerHTML = 'Continue <span aria-hidden="true">→</span>'; }
});

async function doLogout(): Promise<void> {
  try { await api('/api/logout', { method: 'POST' }); showLogin(); }
  catch (error) { $('success-message').hidden = true; setView('history'); errorText('history-error', error instanceof Error ? error.message : 'Could not log out.'); }
}

['logout-top', 'logout-side', 'logout-mobile'].forEach(id => $(id).addEventListener('click', () => void doLogout()));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view as 'dashboard' | 'history')));
$('history-shortcut').addEventListener('click', () => setView('history'));
$('load-more').addEventListener('click', () => void loadHistory());
menuButton.addEventListener('click', () => { mobileMenu.hidden = !mobileMenu.hidden; menuButton.setAttribute('aria-expanded', String(!mobileMenu.hidden)); });

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

void refreshStatus().then(() => { showStaff(); setView('dashboard'); }).catch(error => {
  if (error instanceof Error && error.message.startsWith('Session expired')) showLogin();
  else { showLogin(); errorText('login-error', error instanceof Error ? error.message : 'Could not open the service.'); }
});
