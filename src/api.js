// ── Frontend API helpers — talk to the Express backend (server.js) ──────────

const HACKATIME_AUTHORIZE = 'https://hackatime.hackclub.com/oauth/authorize';

// Public client id (safe to expose). The matching secret lives on the server.
export const HACKATIME_CLIENT_ID = 'DKJiAV9CnBNDOpwlAwNbugVlCPe2bq2YElbPO5IapxA';

// We always redirect back to the app root.
export function redirectUri() {
  return window.location.origin + '/';
}

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export async function getServerConfig() {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Kick off the Hackatime OAuth login by redirecting the browser.
export function startHackatimeLogin(clientId = HACKATIME_CLIENT_ID) {
  const url = new URL(HACKATIME_AUTHORIZE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', 'hackatime');
  window.location.href = url.toString();
}

export function exchangeHackatimeCode(code) {
  return postJSON('/api/hackatime-exchange', { code, redirect_uri: redirectUri() });
}

export function getHackatimeMe(accessToken) {
  return postJSON('/api/hackatime/me', { accessToken });
}

export function getHackatimeProjects(accessToken) {
  return postJSON('/api/hackatime/projects', { accessToken });
}

export function submitProject(payload) {
  return postJSON('/api/submit-project', payload);
}

export function adminCheck(accessToken) {
  return postJSON('/api/admin/check', { accessToken });
}

export function adminList(accessToken) {
  return postJSON('/api/admin/list', { accessToken });
}

export function adminReview(accessToken, recordId, status) {
  return postJSON('/api/admin/review', { accessToken, recordId, status });
}

export function adminUserProjects(accessToken, email) {
  return postJSON('/api/admin/user-projects', { accessToken, email });
}

// Internal admin notes on a single submission (admin-only)
export function adminNotes(accessToken, recordId) {
  return postJSON('/api/admin/notes', { accessToken, recordId });
}
export function adminAddNote(accessToken, recordId, text) {
  return postJSON('/api/admin/notes/add', { accessToken, recordId, text });
}

// Internal admin notes about a submitter, shared across all their projects (admin-only)
export function adminSubmitterNotes(accessToken, email) {
  return postJSON('/api/admin/submitter-notes', { accessToken, email });
}
export function adminAddSubmitterNote(accessToken, email, text) {
  return postJSON('/api/admin/submitter-notes/add', { accessToken, email, text });
}

export function getMySubmissions(email) {
  return postJSON('/api/my-submissions', { email });
}

export function getHackatimeProjectHours(accessToken, projectName) {
  return postJSON('/api/hackatime/project-hours', { accessToken, projectName });
}

export function loadUserProjects(email) {
  return postJSON('/api/user/projects/load', { email });
}

export function saveUserProjects(email, projects, recordId) {
  return postJSON('/api/user/projects/save', { email, projects, recordId });
}

// Upload a base64 data-URL image (journal screenshot); returns { url }.
export function uploadImage(dataUrl) {
  return postJSON('/api/upload', { dataUrl });
}

export async function getPublishedGames() {
  const r = await fetch('/api/games', { cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export function recordPlay(gameId) {
  return postJSON('/api/play', { gameId });
}

export function getPlayCounts(gameIds) {
  return postJSON('/api/play-counts', { gameIds });
}

export async function getComments(gameId) {
  const r = await fetch(`/api/comments?gameId=${encodeURIComponent(gameId)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export function postComment(gameId, author, text) {
  return postJSON('/api/comments', { gameId, author, text });
}

export async function getGameLogs(gameId) {
  const r = await fetch(`/api/game-logs?gameId=${encodeURIComponent(gameId)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export async function getShopItems() {
  const r = await fetch('/api/shop/items', { cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export function placeShopOrder(email, itemId, totalHours, totalPlays) {
  return postJSON('/api/shop/order', { email, itemId, totalHours, totalPlays });
}

export function adminShopItems(accessToken) {
  return postJSON('/api/admin/shop/items', { accessToken });
}

export function adminShopItemSave(accessToken, item) {
  return postJSON('/api/admin/shop/items/save', { accessToken, item });
}

export function adminShopItemDelete(accessToken, id) {
  return postJSON('/api/admin/shop/items/delete', { accessToken, id });
}

export function adminShopOrders(accessToken) {
  return postJSON('/api/admin/shop/orders', { accessToken });
}

export function adminShopOrderUpdate(accessToken, id, status) {
  return postJSON('/api/admin/shop/orders/update', { accessToken, id, status });
}
