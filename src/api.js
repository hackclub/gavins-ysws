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
  const nonce = crypto.randomUUID();
  sessionStorage.setItem('oauth_state', nonce);
  const url = new URL(HACKATIME_AUTHORIZE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', nonce);
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

export function adminAdjust(accessToken, recordId, hours, plays) {
  const body = { accessToken, recordId };
  if (hours !== undefined && hours !== null) body.hours = hours;
  if (plays !== undefined && plays !== null) body.plays = plays;
  return postJSON('/api/admin/adjust', body);
}

export function adminSetUserPlays(accessToken, email, plays) {
  return postJSON('/api/admin/set-user-plays', { accessToken, email, plays });
}

export function getUserTotalPlays(email, gameIds, accessToken) {
  return postJSON('/api/user/plays', { email, gameIds, accessToken });
}

export function adminListAdmins(accessToken) {
  return postJSON('/api/admin/admins/list', { accessToken });
}

export function adminAddAdmin(accessToken, email, tier) {
  return postJSON('/api/admin/admins/add', { accessToken, email, tier });
}

export function adminRemoveAdmin(accessToken, email) {
  return postJSON('/api/admin/admins/remove', { accessToken, email });
}

export function adminUserProjects(accessToken, email) {
  return postJSON('/api/admin/user-projects', { accessToken, email });
}

export function adminAllUsers(accessToken) {
  return postJSON('/api/admin/all-users', { accessToken });
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

export function getMySubmissions(email, accessToken) {
  return postJSON('/api/my-submissions', { email, accessToken });
}

export function getHackatimeProjectHours(accessToken, projectName) {
  return postJSON('/api/hackatime/project-hours', { accessToken, projectName });
}

export function loadUserProjects(email, accessToken) {
  return postJSON('/api/user/projects/load', { email, accessToken });
}

export function saveUserProjects(email, projects, recordId, accessToken) {
  return postJSON('/api/user/projects/save', { email, projects, recordId, accessToken });
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

export function recordPlay(gameId, accessToken) {
  return postJSON('/api/play', { gameId, accessToken });
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

export function postComment(gameId, author, text, accessToken) {
  return postJSON('/api/comments', { gameId, author, text, accessToken });
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

export function placeShopOrder(email, itemId, accessToken, address, phone) {
  return postJSON('/api/shop/order', { email, itemId, accessToken, address, phone });
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
