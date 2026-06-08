import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// School/corporate networks often intercept HTTPS with their own CA, which Node
// rejects by default. Allow outbound API calls in local dev only.
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '5mb' }));

/* ─────────────────────────────────────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────────────────────────────────────── */
const HACKATIME_CLIENT_ID = process.env.HACKATIME_CLIENT_ID || 'DKJiAV9CnBNDOpwlAwNbugVlCPe2bq2YElbPO5IapxA';
const HACKATIME_SECRET    = process.env.HACKATIME_SECRET;

const AIRTABLE_PAT        = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID    = process.env.AIRTABLE_BASE_ID    || 'appJvKyj02poym6qI';
const AIRTABLE_TABLE      = process.env.AIRTABLE_TABLE      || 'tbluyQdN8QAo3rT6P';
const AIRTABLE_USER_TABLE      = process.env.AIRTABLE_USER_TABLE      || 'User Projects';
const AIRTABLE_SHOP_ITEMS_TABLE = process.env.AIRTABLE_SHOP_ITEMS_TABLE || 'Shop Items';
const AIRTABLE_SHOP_ORDERS_TABLE = process.env.AIRTABLE_SHOP_ORDERS_TABLE || 'Shop Orders';
// Comma-separated list of emails allowed to access the admin panel
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// ── Airtable field-name mapping ──────────────────────────────────────────
// EDIT THESE to match the exact field names in your Airtable table.
// Left = our internal key, right = the column header in Airtable.
const FIELDS = {
  email:       'Email',
  firstName:   'First Name',
  lastName:    'Last Name',
  description: 'Description',
  playableUrl: 'Playable URL',
  githubUser:  'GitHub Username',
  hours:        'Optional - Override Hours Spent',
  status:       'Automation - Status', // read-only — computed by Airtable automations
  reviewStatus: process.env.AIRTABLE_REVIEW_FIELD || 'Review Status', // writable — create in Airtable (Single select)
  tags:         process.env.AIRTABLE_TAGS_FIELD || 'Tags', // comma-separated tag string
};

// Long-text JSON fields on the submissions table (create in Airtable for production sync)
const COMMENTS_FIELD    = process.env.AIRTABLE_COMMENTS_FIELD || 'Comments Data';
const JOURNAL_FIELD     = process.env.AIRTABLE_JOURNAL_FIELD  || 'Journal Data';
const REVIEW_DATA_FIELD = process.env.AIRTABLE_REVIEW_DATA_FIELD || 'Review Data';

const REVIEWS_PATH     = path.join(__dirname, '.review-decisions.json');
const PLAYS_PATH       = path.join(__dirname, '.play-counts.json');
const COMMENTS_PATH    = path.join(__dirname, '.comments.json');
const SHOP_ITEMS_PATH  = path.join(__dirname, '.shop-items.json');
const SHOP_ORDERS_PATH = path.join(__dirname, '.shop-orders.json');
const COINS_PER_HOUR   = 20;

const DEFAULT_SHOP_ITEMS = [
  { id: 'steam-giftcard', title: '$10 Steam Gift Card', desc: 'Redeem for games on Steam.', coins: 40, minPlayers: 10, image: '/shop-steam-giftcard.png', active: true },
  { id: 'wacom-intuos', title: 'Wacom Intuos Drawing Tablet', desc: 'Digital drawing tablet for your next project.', coins: 160, minPlayers: 20, image: '/shop-wacom-intuos.png', active: true },
  { id: 'steam-grant', title: 'Steam Publisher Grant', desc: 'We cover the Steam developer fee so you can publish your game.', coins: 400, minPlayers: 40, image: '/shop-steam-grant.png', active: true },
  { id: 'flipper-zero', title: 'Flipper Zero', desc: 'Portable multi-tool for hardware hackers.', coins: 200, minPlayers: 40, image: '/shop-flipper-zero.png', active: true },
  { id: 'bambu-a1-mini', title: 'Bambu A1 Mini', desc: 'Compact 3D printer for rapid prototyping.', coins: 876, minPlayers: 60, image: '/shop-bambu-a1-mini.png', active: true },
];

async function loadPlays() {
  try { return JSON.parse(await fs.readFile(PLAYS_PATH, 'utf8')); } catch { return {}; }
}
async function savePlays(data) {
  await fs.writeFile(PLAYS_PATH, JSON.stringify(data, null, 2));
}

async function loadComments() {
  try { return JSON.parse(await fs.readFile(COMMENTS_PATH, 'utf8')); } catch { return {}; }
}
async function saveComments(data) {
  await fs.writeFile(COMMENTS_PATH, JSON.stringify(data, null, 2));
}

const SHOP_ITEM_FIELDS = {
  itemId:     'Item ID',
  title:      'Title',
  desc:       'Description',
  coins:      'Coins',
  minPlayers: 'Min Players',
  image:      'Image',
  active:     'Active',
};

const SHOP_ORDER_FIELDS = {
  orderId:     'Order ID',
  email:       'Email',
  itemId:      'Item ID',
  itemTitle:   'Item Title',
  coins:       'Coins',
  minPlayers:  'Min Players',
  totalHours:  'Total Hours',
  totalPlays:  'Total Plays',
  status:      'Status',
  orderedAt:   'Ordered At',
};

const shopItemsTableUrl = (recordId = '') =>
  `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_SHOP_ITEMS_TABLE)}${recordId ? '/' + recordId : ''}`;

const shopOrdersTableUrl = (recordId = '') =>
  `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_SHOP_ORDERS_TABLE)}${recordId ? '/' + recordId : ''}`;

function newShopItemId(title) {
  const base = String(title || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  return `${base}-${Date.now().toString(36)}`;
}

function isAirtableShopUnavailable(data, status) {
  return !AIRTABLE_PAT
    || status === 404
    || data?.error?.type === 'NOT_FOUND'
    || data?.error?.type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND'
    || data?.error?.type === 'UNKNOWN_FIELD_NAME';
}

async function loadShopItemsLocal() {
  try {
    const raw = await fs.readFile(SHOP_ITEMS_PATH, 'utf8');
    const items = JSON.parse(raw);
    return Array.isArray(items) && items.length > 0 ? items : DEFAULT_SHOP_ITEMS;
  } catch { return DEFAULT_SHOP_ITEMS; }
}

async function saveShopItemsLocal(items) {
  await fs.writeFile(SHOP_ITEMS_PATH, JSON.stringify(items, null, 2));
}

async function loadShopOrdersLocal() {
  try {
    const raw = await fs.readFile(SHOP_ORDERS_PATH, 'utf8');
    const orders = JSON.parse(raw);
    return Array.isArray(orders) ? orders : [];
  } catch { return []; }
}

async function saveShopOrdersLocal(orders) {
  await fs.writeFile(SHOP_ORDERS_PATH, JSON.stringify(orders, null, 2));
}

async function fetchAllAirtableRecords(tableUrl) {
  let records = [];
  let offset;
  do {
    const url = new URL(tableUrl());
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: airtableHeaders() });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      if (isAirtableShopUnavailable(data, r.status)) return null;
      throw new Error(data?.error?.message || 'Airtable error');
    }
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

function shopItemFromRecord(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    itemId: f[SHOP_ITEM_FIELDS.itemId] || rec.id,
    title: f[SHOP_ITEM_FIELDS.title] || '',
    desc: f[SHOP_ITEM_FIELDS.desc] || '',
    coins: Number(f[SHOP_ITEM_FIELDS.coins]) || 0,
    minPlayers: Number(f[SHOP_ITEM_FIELDS.minPlayers]) || 0,
    image: f[SHOP_ITEM_FIELDS.image] || '',
    active: f[SHOP_ITEM_FIELDS.active] !== false,
    recordId: rec.id,
  };
}

function shopItemToFields(item) {
  return {
    [SHOP_ITEM_FIELDS.itemId]: item.id,
    [SHOP_ITEM_FIELDS.title]: String(item.title || '').trim(),
    [SHOP_ITEM_FIELDS.desc]: String(item.desc || '').trim(),
    [SHOP_ITEM_FIELDS.coins]: Math.max(0, Number(item.coins) || 0),
    [SHOP_ITEM_FIELDS.minPlayers]: Math.max(0, Number(item.minPlayers) || 0),
    [SHOP_ITEM_FIELDS.image]: String(item.image || '').trim(),
    [SHOP_ITEM_FIELDS.active]: item.active !== false,
  };
}

function shopOrderFromRecord(rec) {
  const f = rec.fields || {};
  return {
    id: f[SHOP_ORDER_FIELDS.orderId] || rec.id,
    recordId: rec.id,
    itemId: f[SHOP_ORDER_FIELDS.itemId] || '',
    itemTitle: f[SHOP_ORDER_FIELDS.itemTitle] || '',
    coins: Number(f[SHOP_ORDER_FIELDS.coins]) || 0,
    minPlayers: Number(f[SHOP_ORDER_FIELDS.minPlayers]) || 0,
    email: f[SHOP_ORDER_FIELDS.email] || '',
    totalHours: Number(f[SHOP_ORDER_FIELDS.totalHours]) || 0,
    totalPlays: Number(f[SHOP_ORDER_FIELDS.totalPlays]) || 0,
    status: f[SHOP_ORDER_FIELDS.status] || 'pending',
    orderedAt: f[SHOP_ORDER_FIELDS.orderedAt] || rec.createdTime || new Date().toISOString(),
    updatedAt: f['Updated At'] || null,
  };
}

function shopOrderToFields(order) {
  return {
    [SHOP_ORDER_FIELDS.orderId]: order.id,
    [SHOP_ORDER_FIELDS.email]: order.email,
    [SHOP_ORDER_FIELDS.itemId]: order.itemId,
    [SHOP_ORDER_FIELDS.itemTitle]: order.itemTitle,
    [SHOP_ORDER_FIELDS.coins]: order.coins,
    [SHOP_ORDER_FIELDS.minPlayers]: order.minPlayers,
    [SHOP_ORDER_FIELDS.totalHours]: order.totalHours,
    [SHOP_ORDER_FIELDS.totalPlays]: order.totalPlays,
    [SHOP_ORDER_FIELDS.status]: order.status || 'pending',
    [SHOP_ORDER_FIELDS.orderedAt]: order.orderedAt,
  };
}

function normalizeShopItem(item) {
  return {
    id: item.id || item.itemId,
    title: String(item.title || '').trim(),
    desc: String(item.desc || '').trim(),
    coins: Math.max(0, Number(item.coins) || 0),
    minPlayers: Math.max(0, Number(item.minPlayers) || 0),
    image: String(item.image || '').trim(),
    active: item.active !== false,
  };
}

async function findShopItemRecordByItemId(itemId) {
  const url = new URL(shopItemsTableUrl());
  url.searchParams.set('filterByFormula', `{${SHOP_ITEM_FIELDS.itemId}}="${String(itemId).replace(/"/g, '\\"')}"`);
  url.searchParams.set('maxRecords', '1');
  const r = await fetch(url, { headers: airtableHeaders() });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    if (isAirtableShopUnavailable(data, r.status)) return { unavailable: true, record: null };
    throw new Error(data?.error?.message || 'Airtable error');
  }
  return { unavailable: false, record: data.records?.[0] || null };
}

async function findShopOrderRecordByOrderId(orderId) {
  const url = new URL(shopOrdersTableUrl());
  url.searchParams.set('filterByFormula', `{${SHOP_ORDER_FIELDS.orderId}}="${String(orderId).replace(/"/g, '\\"')}"`);
  url.searchParams.set('maxRecords', '1');
  const r = await fetch(url, { headers: airtableHeaders() });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    if (isAirtableShopUnavailable(data, r.status)) return { unavailable: true, record: null };
    throw new Error(data?.error?.message || 'Airtable error');
  }
  return { unavailable: false, record: data.records?.[0] || null };
}

async function seedShopItemsToAirtable(items) {
  for (const item of items) {
    const payload = normalizeShopItem(item);
    if (!payload.id) payload.id = newShopItemId(payload.title);
    const { unavailable, record: existing } = await findShopItemRecordByItemId(payload.id);
    if (unavailable) return false;
    if (existing) continue;
    const r = await fetch(shopItemsTableUrl(), {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: shopItemToFields(payload), typecast: true }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok && !isAirtableShopUnavailable(data, r.status)) {
      throw new Error(data?.error?.message || 'Failed to seed shop item');
    }
    if (!r.ok) return false;
  }
  return true;
}

async function loadShopItemsFromAirtable() {
  const records = await fetchAllAirtableRecords(shopItemsTableUrl);
  if (records === null) return null;
  if (records.length === 0) {
    const local = await loadShopItemsLocal();
    const seeded = await seedShopItemsToAirtable(local);
    if (!seeded) return null;
    const again = await fetchAllAirtableRecords(shopItemsTableUrl);
    if (again === null) return null;
    return again.map(shopItemFromRecord).map(i => ({
      id: i.itemId,
      title: i.title,
      desc: i.desc,
      coins: i.coins,
      minPlayers: i.minPlayers,
      image: i.image,
      active: i.active,
      recordId: i.recordId,
    }));
  }
  return records.map(shopItemFromRecord).map(i => ({
    id: i.itemId,
    title: i.title,
    desc: i.desc,
    coins: i.coins,
    minPlayers: i.minPlayers,
    image: i.image,
    active: i.active,
    recordId: i.recordId,
  }));
}

async function loadShopItems() {
  const airtableItems = await loadShopItemsFromAirtable();
  if (airtableItems !== null) {
    await saveShopItemsLocal(airtableItems);
    return airtableItems;
  }
  return loadShopItemsLocal();
}

async function saveShopItemLocal(payload) {
  const items = await loadShopItemsLocal();
  const idx = items.findIndex(i => i.id === payload.id);
  if (idx >= 0) items[idx] = payload;
  else items.push(payload);
  await saveShopItemsLocal(items);
  return { item: payload, items };
}

async function upsertShopItem(item) {
  const payload = normalizeShopItem(item);
  if (!payload.id) payload.id = newShopItemId(payload.title);

  if (!AIRTABLE_PAT) return saveShopItemLocal(payload);

  const { unavailable, record: existing } = await findShopItemRecordByItemId(payload.id);
  if (unavailable) return saveShopItemLocal(payload);

  if (existing) {
    const r = await fetch(shopItemsTableUrl(existing.id), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: shopItemToFields(payload), typecast: true }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      if (isAirtableShopUnavailable(data, r.status)) return saveShopItemLocal(payload);
      throw new Error(data?.error?.message || 'Failed to update shop item');
    }
  } else {
    const r = await fetch(shopItemsTableUrl(), {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: shopItemToFields(payload), typecast: true }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      if (isAirtableShopUnavailable(data, r.status)) return saveShopItemLocal(payload);
      throw new Error(data?.error?.message || 'Failed to create shop item');
    }
  }

  const items = await loadShopItems();
  return { item: payload, items };
}

async function deleteShopItem(itemId) {
  if (AIRTABLE_PAT) {
    const { unavailable, record: existing } = await findShopItemRecordByItemId(itemId);
    if (!unavailable && existing) {
      const r = await fetch(shopItemsTableUrl(existing.id), { method: 'DELETE', headers: airtableHeaders() });
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        if (!isAirtableShopUnavailable(data, r.status)) {
          throw new Error(data?.error?.message || 'Failed to delete shop item');
        }
      }
    }
  }
  const items = (await loadShopItems()).filter(i => i.id !== itemId);
  await saveShopItemsLocal(items);
  return items;
}

async function migrateLocalOrdersToAirtable(localOrders) {
  for (const order of localOrders) {
    const { unavailable, record } = await findShopOrderRecordByOrderId(order.id);
    if (unavailable) return false;
    if (record) continue;
    const r = await fetch(shopOrdersTableUrl(), {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: shopOrderToFields(order), typecast: true }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok && !isAirtableShopUnavailable(data, r.status)) {
      throw new Error(data?.error?.message || 'Failed to migrate order');
    }
    if (!r.ok) return false;
  }
  return true;
}

async function loadShopOrdersFromAirtable() {
  const records = await fetchAllAirtableRecords(shopOrdersTableUrl);
  if (records === null) return null;
  if (records.length === 0) {
    const local = await loadShopOrdersLocal();
    if (local.length > 0) {
      const migrated = await migrateLocalOrdersToAirtable(local);
      if (!migrated) return null;
      const again = await fetchAllAirtableRecords(shopOrdersTableUrl);
      if (again === null) return null;
      const orders = again.map(shopOrderFromRecord);
      orders.sort((a, b) => new Date(b.orderedAt) - new Date(a.orderedAt));
      return orders;
    }
  }
  const orders = records.map(shopOrderFromRecord);
  orders.sort((a, b) => new Date(b.orderedAt) - new Date(a.orderedAt));
  return orders;
}

async function loadShopOrders() {
  const airtableOrders = await loadShopOrdersFromAirtable();
  if (airtableOrders !== null) {
    await saveShopOrdersLocal(airtableOrders);
    return airtableOrders;
  }
  return loadShopOrdersLocal();
}

async function appendShopOrder(order) {
  if (AIRTABLE_PAT) {
    const r = await fetch(shopOrdersTableUrl(), {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: shopOrderToFields(order), typecast: true }),
    });
    const data = await r.json().catch(() => null);
    if (r.ok) {
      const orders = await loadShopOrders();
      return { order: shopOrderFromRecord(data), orders };
    }
    if (!isAirtableShopUnavailable(data, r.status)) {
      throw new Error(data?.error?.message || 'Failed to save order');
    }
  }
  const orders = await loadShopOrdersLocal();
  orders.unshift(order);
  await saveShopOrdersLocal(orders);
  return { order, orders };
}

async function updateShopOrderStatus(orderId, status) {
  const updatedAt = new Date().toISOString();

  if (AIRTABLE_PAT) {
    const { unavailable, record: existing } = await findShopOrderRecordByOrderId(orderId);
    if (!unavailable && existing) {
      const r = await fetch(shopOrdersTableUrl(existing.id), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: { [SHOP_ORDER_FIELDS.status]: status }, typecast: true }),
    });
      const data = await r.json().catch(() => null);
      if (r.ok) {
        const order = shopOrderFromRecord(data);
        const orders = await loadShopOrders();
        return { order, orders };
      }
      if (!isAirtableShopUnavailable(data, r.status)) {
        throw new Error(data?.error?.message || 'Failed to update order');
      }
    }
  }

  const orders = await loadShopOrdersLocal();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx < 0) throw new Error('Order not found');
  orders[idx] = { ...orders[idx], status, updatedAt };
  await saveShopOrdersLocal(orders);
  return { order: orders[idx], orders };
}

const userTableUrl = (recordId = '') =>
  `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_USER_TABLE)}${recordId ? '/' + recordId : ''}`;

async function loadReviewDecisions() {
  try {
    const raw = await fs.readFile(REVIEWS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
}

async function saveReviewDecisions(data) {
  await fs.writeFile(REVIEWS_PATH, JSON.stringify(data, null, 2));
}

function isTerminalReviewStatus(status) {
  const lower = String(status || '').toLowerCase();
  return lower.includes('accept') || lower.includes('approv') || lower.includes('reject');
}

function isAcceptedReviewStatus(status) {
  const lower = String(status || '').toLowerCase();
  return lower.includes('accept') || lower.includes('approv');
}

/** Pick the authoritative review status from Airtable fields, Review Data JSON, and local backup. */
function resolveReviewStatus(recordFields, localDecision) {
  const candidates = [];
  const add = (status, updatedAt) => {
    if (!status) return;
    candidates.push({
      status,
      ts: updatedAt ? new Date(updatedAt).getTime() : 0,
    });
  };

  const reviewData = parseJsonField(recordFields?.[REVIEW_DATA_FIELD], null);
  if (reviewData?.status) add(reviewData.status, reviewData.updatedAt);

  add(recordFields?.[FIELDS.reviewStatus], null);

  if (localDecision?.status) add(localDecision.status, localDecision.updatedAt);

  if (!candidates.length) return 'Under Review';

  const terminal = candidates.filter(c => isTerminalReviewStatus(c.status));
  const pool = terminal.length ? terminal : candidates;
  pool.sort((a, b) => b.ts - a.ts);
  return pool[0].status;
}

function enrichRecordWithReviewStatus(record, decisions) {
  const local = decisions[record.id];
  const resolved = resolveReviewStatus(record.fields, local);
  return {
    ...record,
    fields: { ...record.fields, [FIELDS.reviewStatus]: resolved },
  };
}

/** Persist review status to local backup + Airtable (Review Data JSON + optional select field). */
async function persistReviewStatus(recordId, status) {
  const updatedAt = new Date().toISOString();
  const reviewData = { status, updatedAt };

  const decisions = await loadReviewDecisions();
  decisions[recordId] = reviewData;
  await saveReviewDecisions(decisions);

  if (!AIRTABLE_PAT) return { storage: 'local', reviewStatus: status };

  const patchFields = {
    [REVIEW_DATA_FIELD]: JSON.stringify(reviewData),
    [FIELDS.reviewStatus]: status,
  };

  let r = await fetch(airtableUrl(recordId), {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields: patchFields, typecast: true }),
  });
  let data = await r.json().catch(() => null);

  if (r.ok) return { storage: 'airtable', reviewStatus: status, record: data };

  const msg = data?.error?.message || '';
  const unknownField = data?.error?.type === 'UNKNOWN_FIELD_NAME'
    || msg.includes('Unknown field')
    || msg.includes('computed');

  if (unknownField) {
    r = await fetch(airtableUrl(recordId), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: { [REVIEW_DATA_FIELD]: JSON.stringify(reviewData) }, typecast: true }),
    });
    data = await r.json().catch(() => null);
    if (r.ok) return { storage: 'airtable-partial', reviewStatus: status, record: data };

    r = await fetch(airtableUrl(recordId), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: { [FIELDS.reviewStatus]: status }, typecast: true }),
    });
    data = await r.json().catch(() => null);
    if (r.ok) return { storage: 'airtable-partial', reviewStatus: status, record: data };
  }

  if (unknownField) return { storage: 'local', reviewStatus: status };

  throw new Error(msg || 'Failed to update review status');
}

async function loadUserProjectsByEmail(email) {
  const url = new URL(userTableUrl());
  url.searchParams.set('filterByFormula', `{Email}="${email.replace(/"/g, '\\"')}"`);
  url.searchParams.set('maxRecords', '1');
  const r = await fetch(url, { headers: airtableHeaders() });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const missing = data?.error?.type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND'
      || data?.error?.type === 'NOT_FOUND';
    if (missing || r.status === 404) return { projects: [], recordId: null };
    throw new Error(data?.error?.message || 'Airtable error');
  }
  const record = data.records?.[0];
  if (!record) return { projects: [], recordId: null };
  let projects = [];
  try { projects = JSON.parse(record.fields['Projects Data'] || '[]'); } catch {}
  return { projects, recordId: record.id };
}

const airtableUrl = (recordId = '') =>
  `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}${recordId ? '/' + recordId : ''}`;

const airtableHeaders = () => ({
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
});

function parseJsonField(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function fetchSubmissionRecord(recordId) {
  const r = await fetch(airtableUrl(recordId), { headers: airtableHeaders() });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function loadSubmissionComments(gameId) {
  if (AIRTABLE_PAT) {
    const rec = await fetchSubmissionRecord(gameId);
    if (rec?.fields?.[COMMENTS_FIELD]) {
      return parseJsonField(rec.fields[COMMENTS_FIELD], []);
    }
  }
  const all = await loadComments();
  return all[gameId] || [];
}

async function appendSubmissionComment(gameId, comment) {
  if (AIRTABLE_PAT) {
    const comments = await loadSubmissionComments(gameId);
    comments.push(comment);
    const r = await fetch(airtableUrl(gameId), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: { [COMMENTS_FIELD]: JSON.stringify(comments) } }),
    });
    const data = await r.json().catch(() => null);
    if (r.ok) return comment;
    if (data?.error?.type !== 'UNKNOWN_FIELD_NAME') {
      throw new Error(data?.error?.message || 'Failed to save comment');
    }
  }
  const all = await loadComments();
  if (!all[gameId]) all[gameId] = [];
  all[gameId].push(comment);
  await saveComments(all);
  return comment;
}

async function syncJournalToSubmission(recordId, journalEntries) {
  if (!AIRTABLE_PAT || !recordId || !Array.isArray(journalEntries)) return;
  try {
    const r = await fetch(airtableUrl(recordId), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: { [JOURNAL_FIELD]: JSON.stringify(journalEntries) } }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => null);
      if (data?.error?.type !== 'UNKNOWN_FIELD_NAME') {
        console.warn('[syncJournal]', recordId, data?.error?.message);
      }
    }
  } catch (err) {
    console.warn('[syncJournal]', err.message);
  }
}

function journalFromSubmissionRecord(rec) {
  const raw = rec?.fields?.[JOURNAL_FIELD];
  return raw ? parseJsonField(raw, []) : null;
}

// Pull email, GitHub username, and name parts from any Hackatime profile response shape.
function parseHackatimeProfile(data) {
  const profile = data?.data || data || {};
  const email = profile.email
    || (Array.isArray(profile.emails) ? profile.emails[0] : null)
    || null;
  // Hackatime usernames are GitHub usernames
  const githubUsername = profile.github_username
    || profile.githubUsername
    || profile.username
    || null;
  const displayName = profile.display_name
    || profile.displayName
    || profile.full_name
    || profile.name
    || null;
  let firstName = profile.first_name || '';
  let lastName  = profile.last_name  || '';
  if (!firstName && displayName) {
    const parts = String(displayName).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  }
  console.log('[parseProfile] username:', profile.username, 'display_name:', profile.display_name, 'email:', email);
  return { email, githubUsername, displayName, firstName, lastName, raw: profile };
}

async function fetchHackatimeProfile(accessToken) {
  const basicCreds = Buffer.from(`${accessToken}:`).toString('base64');
  const attempts = [
    { url: 'https://hackatime.hackclub.com/api/v1/authenticated/me', auth: `Bearer ${accessToken}` },
    { url: 'https://hackatime.hackclub.com/api/v1/users/current',     auth: `Basic ${basicCreds}` },
    { url: 'https://hackatime.hackclub.com/api/v1/users/current',     auth: `Bearer ${accessToken}` },
  ];
  for (const { url, auth } of attempts) {
    const r = await fetch(url, { headers: { Authorization: auth } });
    if (!r.ok) continue;
    try {
      const data = await r.json();
      return parseHackatimeProfile(data);
    } catch {}
  }
  return null;
}

async function fetchHackatimeProjectHours(accessToken, projectName) {
  const basicCreds = Buffer.from(`${accessToken}:`).toString('base64');
  const attempts = [
    { url: 'https://hackatime.hackclub.com/api/v1/users/current/projects', auth: `Basic ${basicCreds}` },
    { url: 'https://hackatime.hackclub.com/api/v1/users/current/projects', auth: `Bearer ${accessToken}` },
    { url: 'https://hackatime.hackclub.com/api/v1/authenticated/projects', auth: `Bearer ${accessToken}` },
  ];

  let projects = null;
  for (const { url, auth } of attempts) {
    const r = await fetch(url, { headers: { Authorization: auth } });
    if (!r.ok) continue;
    try {
      const d = await r.json();
      projects = d?.projects || d?.data || d;
      break;
    } catch {}
  }
  if (!projects) return 0;

  const list = Array.isArray(projects) ? projects : Object.values(projects);
  const match = list.find(p => (p.name || p.key || '') === projectName);
  return match ? +((match.total_seconds || 0) / 3600).toFixed(1) : 0;
}

/* ─────────────────────────────────────────────────────────────────────────
   HACKATIME OAUTH
   ───────────────────────────────────────────────────────────────────────── */
app.post('/api/hackatime-exchange', async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'No authorization code provided' });
    if (!HACKATIME_SECRET) return res.status(500).json({ success: false, error: 'HACKATIME_SECRET is not configured on the server.' });

    // Hackatime (Doorkeeper) requires client credentials as HTTP Basic Auth
    const credentials = Buffer.from(`${HACKATIME_CLIENT_ID}:${HACKATIME_SECRET}`).toString('base64');
    const params = new URLSearchParams({
      code:         String(code).trim(),
      redirect_uri,
      grant_type:   'authorization_code',
    });

    console.log('[hackatime-exchange] client_id:', HACKATIME_CLIENT_ID);
    console.log('[hackatime-exchange] redirect_uri:', redirect_uri);
    console.log('[hackatime-exchange] code (first 8):', String(code).trim().slice(0, 8) + '…');

    const r = await fetch('https://hackatime.hackclub.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: params.toString(),
    });

    const rawText = await r.text();
    console.log('[hackatime-exchange] status:', r.status, 'body:', rawText.slice(0, 300));

    let data = null;
    try { data = JSON.parse(rawText); } catch {}

    if (!r.ok || !data || data.error) {
      return res.status(r.ok ? 400 : r.status).json({
        success: false,
        error: data?.error_description || data?.error || `Hackatime returned ${r.status}: ${rawText.slice(0, 200)}`,
      });
    }
    return res.json({ success: true, accessToken: data.access_token });
  } catch (err) {
    console.error('Hackatime exchange error:', err);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   HACKATIME USER DATA  (email + projects/hours)
   ───────────────────────────────────────────────────────────────────────── */
app.post('/api/hackatime/me', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(401).json({ error: 'Missing access token' });

    // Try WakaTime-compatible endpoint first, fall back to authenticated/me
    // Try multiple auth styles + endpoints — Hackatime supports both OAuth Bearer
    // and WakaTime-compatible Basic auth (token as username, empty password)
    const basicCreds = Buffer.from(`${accessToken}:`).toString('base64');
    const attempts = [
      { url: 'https://hackatime.hackclub.com/api/v1/users/current',     auth: `Basic ${basicCreds}` },
      { url: 'https://hackatime.hackclub.com/api/v1/users/current',     auth: `Bearer ${accessToken}` },
      { url: 'https://hackatime.hackclub.com/api/v1/authenticated/me',  auth: `Bearer ${accessToken}` },
    ];

    let data = null;
    let lastStatus = null;
    let lastBody = null;

    for (const { url, auth } of attempts) {
      const r = await fetch(url, { headers: { Authorization: auth } });
      const text = await r.text();
      console.log(`[hackatime/me] ${auth.split(' ')[0]} ${url} → ${r.status}: ${text.slice(0, 200)}`);
      if (r.ok) {
        try { data = JSON.parse(text); } catch {}
        break;
      }
      lastStatus = r.status;
      lastBody = text;
    }

    if (!data) {
      return res.status(lastStatus || 401).json({
        error: `Hackatime /me failed (${lastStatus}): ${lastBody?.slice(0, 200)}`,
      });
    }

    const profile = data.data || data;
    const parsed = parseHackatimeProfile(data);

    console.log('[hackatime/me] email resolved:', parsed.email);
    return res.json({
      success: true,
      email: parsed.email,
      profile,
      githubUsername: parsed.githubUsername,
      displayName: parsed.displayName,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
    });
  } catch (err) {
    console.error('Hackatime me error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/hackatime/projects', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(401).json({ error: 'Missing access token' });

    const basicCreds = Buffer.from(`${accessToken}:`).toString('base64');
    const attempts = [
      { url: 'https://hackatime.hackclub.com/api/v1/users/current/projects', auth: `Basic ${basicCreds}` },
      { url: 'https://hackatime.hackclub.com/api/v1/users/current/projects', auth: `Bearer ${accessToken}` },
      { url: 'https://hackatime.hackclub.com/api/v1/authenticated/projects', auth: `Bearer ${accessToken}` },
    ];

    let data = null;
    for (const { url, auth } of attempts) {
      const r = await fetch(url, { headers: { Authorization: auth } });
      const text = await r.text();
      console.log(`[hackatime/projects] ${auth.split(' ')[0]} → ${r.status}: ${text.slice(0, 200)}`);
      if (r.ok) {
        try { data = JSON.parse(text); } catch {}
        break;
      }
    }

    // Return empty list rather than an error — projects are optional
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Hackatime projects error:', err);
    return res.json({ success: true, data: [] });
  }
});

// Get hours for a single Hackatime project by name
app.post('/api/hackatime/project-hours', async (req, res) => {
  try {
    const { accessToken, projectName } = req.body;
    if (!accessToken || !projectName) return res.status(400).json({ error: 'accessToken and projectName required' });

    const hours = await fetchHackatimeProjectHours(accessToken, projectName);
    return res.json({ success: true, hours });
  } catch (err) {
    console.error('Hackatime project-hours error:', err);
    return res.json({ success: true, hours: 0 });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   SUBMIT PROJECT  →  create an Airtable record
   ───────────────────────────────────────────────────────────────────────── */
app.post('/api/submit-project', async (req, res) => {
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured on the server.' });
    let { email, firstName, lastName, description, playableUrl, githubUser, hours, accessToken, hackatimeProject, journalEntries, tags } = req.body;

    // Fill any missing Airtable fields from Hackatime when the user is signed in.
    if (accessToken) {
      try {
        const ht = await fetchHackatimeProfile(accessToken);
        if (ht) {
          if (!email && ht.email) email = ht.email;
          if (!githubUser && ht.githubUsername) githubUser = ht.githubUsername;
          if (!firstName && ht.firstName) firstName = ht.firstName;
          if (!lastName && ht.lastName) lastName = ht.lastName;
        }
        if (hackatimeProject) {
          const htHours = await fetchHackatimeProjectHours(accessToken, hackatimeProject);
          if (htHours > 0) hours = htHours;
        }
      } catch (err) {
        console.warn('[submit-project] Hackatime auto-fill skipped:', err.message);
      }
    }

    if (!email) return res.status(400).json({ error: 'Email is required' });

    const fields = {};
    const set = (key, val) => { if (val !== undefined && val !== null && val !== '') fields[FIELDS[key]] = val; };
    set('email',       email);
    set('firstName',   firstName);
    set('lastName',    lastName);
    set('description', description);
    set('playableUrl', playableUrl);
    set('githubUser',  githubUser);
    if (hours != null && Number(hours) > 0) set('hours', Number(hours));
    set('reviewStatus', 'Under Review');
    fields[REVIEW_DATA_FIELD] = JSON.stringify({ status: 'Under Review', updatedAt: new Date().toISOString() });
    if (Array.isArray(journalEntries) && journalEntries.length > 0) {
      fields[JOURNAL_FIELD] = JSON.stringify(journalEntries);
    }
    // Save tags as a comma-separated string (easy to read in Airtable)
    if (Array.isArray(tags) && tags.length > 0) {
      fields[FIELDS.tags] = tags.join(', ');
    }

    let r = await fetch(airtableUrl(), {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields, typecast: true }),
    });

    let data = await r.json().catch(() => null);
    if (!r.ok && data?.error?.type === 'UNKNOWN_FIELD_NAME') {
      if (fields[FIELDS.reviewStatus]) delete fields[FIELDS.reviewStatus];
      if (fields[REVIEW_DATA_FIELD]) delete fields[REVIEW_DATA_FIELD];
      if (fields[JOURNAL_FIELD]) delete fields[JOURNAL_FIELD];
      if (fields[FIELDS.tags]) delete fields[FIELDS.tags];
      r = await fetch(airtableUrl(), {
        method: 'POST',
        headers: airtableHeaders(),
        body: JSON.stringify({ fields, typecast: true }),
      });
      data = await r.json().catch(() => null);
    }

    if (!r.ok) {
      console.error('Airtable create error:', r.status, data);
      const msg = r.status === 401
        ? 'Airtable token is invalid — update AIRTABLE_PAT in your .env file (get one at airtable.com/create/tokens)'
        : r.status === 403
        ? 'Airtable token lacks permission — make sure it has data.records:write on this base'
        : data?.error?.message || 'Failed to create Airtable record';
      return res.status(r.status).json({ error: msg });
    }

    if (data?.id) {
      await persistReviewStatus(data.id, 'Under Review');
    }

    return res.json({ success: true, record: data, reviewStatus: 'Under Review' });
  } catch (err) {
    console.error('Submit project error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/my-submissions', async (req, res) => {
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured.' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const url = new URL(airtableUrl());
    url.searchParams.set('filterByFormula', `{Email}="${email.replace(/"/g, '\\"')}"`);

    let records = [];
    let offset;
    do {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('pageSize', '100');
      if (offset) pageUrl.searchParams.set('offset', offset);
      const r = await fetch(pageUrl, { headers: airtableHeaders() });
      const data = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Failed to load submissions' });
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    const decisions = await loadReviewDecisions();
    const submissions = records.map(rec => ({
      recordId: rec.id,
      description: rec.fields?.[FIELDS.description] || rec.fields?.Description || '',
      reviewStatus: resolveReviewStatus(rec.fields, decisions[rec.id]),
    }));

    return res.json({ success: true, submissions });
  } catch (err) {
    console.error('My submissions error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   ADMIN  —  list & review submissions
   Access is gated by ADMIN_EMAILS in .env — no password needed.
   The request must include the user's Hackatime accessToken; we verify it
   live and check the returned email against the whitelist.
   ───────────────────────────────────────────────────────────────────────── */
async function checkAdmin(req, res) {
  const token = req.body?.accessToken || req.headers['x-access-token'];
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  if (ADMIN_EMAILS.length === 0) { res.status(403).json({ error: 'No admin emails configured (set ADMIN_EMAILS in .env)' }); return null; }
  try {
    const profile = await fetchHackatimeProfile(token);
    const email = profile?.email?.toLowerCase();
    if (!email) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    if (!ADMIN_EMAILS.includes(email)) {
      res.status(403).json({ error: 'Access denied — your email is not on the admin list' });
      return null;
    }
    return profile.email;
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify identity' });
    return null;
  }
}

// Check if an email is an admin — used by the frontend to show/hide the page
app.post('/api/admin/check', async (req, res) => {
  const email = await checkAdmin(req, res);
  if (email) res.json({ success: true, email });
});

app.post('/api/admin/list', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured on the server.' });

    // Page through all records.
    let records = [];
    let offset;
    do {
      const url = new URL(airtableUrl());
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);
      const r = await fetch(url, { headers: airtableHeaders() });
      const data = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Failed to list records' });
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    const decisions = await loadReviewDecisions();
    records = records.map(r => enrichRecordWithReviewStatus(r, decisions));

    return res.json({ success: true, records, fields: FIELDS });
  } catch (err) {
    console.error('Admin list error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/admin/review', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured on the server.' });
    const { recordId, status } = req.body;
    if (!recordId || !status) return res.status(400).json({ error: 'recordId and status are required' });

    const result = await persistReviewStatus(recordId, status);
    return res.json({ success: true, reviewStatus: status, storage: result.storage, record: result.record || null });
  } catch (err) {
    console.error('Admin review error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.post('/api/admin/user-projects', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const { projects, recordId } = await loadUserProjectsByEmail(email);
    return res.json({ success: true, projects, recordId });
  } catch (err) {
    console.error('Admin user-projects error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Public list of accepted / published games
// Record one play for a game (no auth — called when user opens game in the arcade)
app.post('/api/play', async (req, res) => {
  const { gameId } = req.body;
  if (!gameId) return res.status(400).json({ error: 'gameId required' });
  try {
    const plays = await loadPlays();
    plays[gameId] = (plays[gameId] || 0) + 1;
    await savePlays(plays);
    return res.json({ success: true, plays: plays[gameId] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Return play counts for an array of game IDs
app.post('/api/play-counts', async (req, res) => {
  const { gameIds } = req.body;
  if (!Array.isArray(gameIds)) return res.status(400).json({ error: 'gameIds array required' });
  try {
    const plays = await loadPlays();
    const counts = {};
    gameIds.forEach(id => { counts[id] = plays[id] || 0; });
    return res.json({ success: true, counts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get comments for a game (Airtable submissions table, with local file fallback)
app.get('/api/comments', async (req, res) => {
  const { gameId } = req.query;
  if (!gameId) return res.status(400).json({ error: 'gameId required' });
  try {
    const comments = await loadSubmissionComments(gameId);
    return res.json({ success: true, comments });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// Post a comment on a game
app.post('/api/comments', async (req, res) => {
  const { gameId, author, text } = req.body;
  if (!gameId || !text?.trim()) return res.status(400).json({ error: 'gameId and text required' });
  try {
    const comment = {
      author: (author || 'Anonymous').trim(),
      text: text.trim(),
      date: new Date().toISOString(),
    };
    await appendSubmissionComment(gameId, comment);
    return res.json({ success: true, comment });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// Public dev-log for a game (journal entries from the submitter)
app.get('/api/game-logs', async (req, res) => {
  const { gameId } = req.query;
  if (!gameId) return res.status(400).json({ error: 'gameId required' });
  if (!AIRTABLE_PAT) return res.json({ success: true, logs: [] });
  try {
    const rec = await fetchSubmissionRecord(gameId);
    if (!rec) return res.json({ success: true, logs: [] });

    const desc = rec.fields?.[FIELDS.description] || '';
    const gameName = desc.split(' — ')[0]?.trim() || '';

    const journalOnRecord = journalFromSubmissionRecord(rec);
    if (journalOnRecord?.length) {
      return res.json({ success: true, logs: journalOnRecord, projectName: gameName });
    }

    const email = rec.fields?.[FIELDS.email];
    if (!email) return res.json({ success: true, logs: [] });
    const { projects } = await loadUserProjectsByEmail(email);
    const match = projects.find(p =>
      p.name === gameName || desc.startsWith(p.name)
      || (p.hackatimeProject && desc.includes(p.hackatimeProject))
    );
    return res.json({ success: true, logs: match?.journalEntries || [], projectName: match?.name || gameName });
  } catch (err) {
    return res.json({ success: true, logs: [] });
  }
});

app.get('/api/games', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!AIRTABLE_PAT) return res.json({ success: true, games: [] }); // graceful — no error shown in arcade
  try {
    // Fetch all records — don't filter in Airtable since Review Status may be stored locally
    let records = [], offset;
    do {
      const url = new URL(airtableUrl());
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);
      const r = await fetch(url, { headers: airtableHeaders() });
      const data = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Failed' });
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    const decisions = await loadReviewDecisions();
    records = records.map(r => enrichRecordWithReviewStatus(r, decisions));

    const accepted = records.filter(r => isAcceptedReviewStatus(r.fields?.[FIELDS.reviewStatus]));

    const plays = await loadPlays();
    const games = accepted.map(r => {
      const rawTags = r.fields?.[FIELDS.tags] || '';
      const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];
      return {
        id: r.id,
        name: (r.fields?.[FIELDS.description] || '').split(' — ')[0]?.trim() || 'Untitled',
        description: r.fields?.[FIELDS.description] || '',
        itchUrl: r.fields?.[FIELDS.playableUrl] || '',
        submitter: [r.fields?.[FIELDS.firstName], r.fields?.[FIELDS.lastName]].filter(Boolean).join(' ') || 'Unknown',
        hours: r.fields?.[FIELDS.hours] || 0,
        plays: plays[r.id] || 0,
        tags,
      };
    });
    return res.json({ success: true, games });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Lets the frontend know which features are wired up without exposing secrets.
app.get('/api/config', (req, res) => {
  res.json({
    hackatimeClientId: HACKATIME_CLIENT_ID,
    hackatimeReady: Boolean(HACKATIME_SECRET),
    airtableReady: Boolean(AIRTABLE_PAT),
  });
});

// Diagnostic: returns the actual field names in the submissions table
// Visit http://localhost:3001/api/admin/fields in your browser to see them
app.get('/api/admin/fields', async (req, res) => {
  try {
    // Try Metadata API first (needs schema.bases:read scope)
    const meta = await fetch(
      `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }
    );
    if (meta.ok) {
      const data = await meta.json();
      const table = data.tables?.find(t => t.id === AIRTABLE_TABLE || t.name === AIRTABLE_TABLE);
      const fields = table?.fields?.map(f => `"${f.name}" (${f.type})`) || [];
      return res.json({ source: 'metadata', tableName: table?.name, fields });
    }

    // Fallback: read one record and extract field names from it
    const url = new URL(airtableUrl());
    url.searchParams.set('maxRecords', '1');
    const r = await fetch(url, { headers: airtableHeaders() });
    const data = await r.json().catch(() => null);
    if (!r.ok) return res.status(r.status).json({ error: data?.error || 'Airtable error' });

    const record = data.records?.[0];
    if (!record) return res.json({ source: 'records', note: 'Table is empty — create a record manually in Airtable first', fields: [] });

    const fields = Object.keys(record.fields).map(k => `"${k}"`);
    return res.json({ source: 'records', fields, currentMapping: FIELDS });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   USER PROJECT DATA  — load & save per-user projects to Airtable
   Table: "User Projects"  Fields: Email (text), Projects Data (long text)
   ───────────────────────────────────────────────────────────────────────── */

app.post('/api/user/projects/load', async (req, res) => {
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const { projects, recordId } = await loadUserProjectsByEmail(email);
    return res.json({ success: true, projects, recordId });
  } catch (err) {
    console.error('Load user projects error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/user/projects/save', async (req, res) => {
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured' });
    const { email, projects, recordId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Strip headerImage (base64 blobs) — too large for Airtable text fields
    const sanitised = (projects || []).map(p => ({ ...p, headerImage: null }));
    const fields = { 'Email': email, 'Projects Data': JSON.stringify(sanitised) };

    const r = recordId
      ? await fetch(userTableUrl(recordId), { method: 'PATCH', headers: airtableHeaders(), body: JSON.stringify({ fields }) })
      : await fetch(userTableUrl(),          { method: 'POST',  headers: airtableHeaders(), body: JSON.stringify({ fields }) });

    const data = await r.json().catch(() => null);
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Airtable error' });

    // Mirror journal entries onto linked submission records so admin/arcade see fresh logs
    await Promise.all(
      sanitised
        .filter(p => p.airtableRecordId && Array.isArray(p.journalEntries))
        .map(p => syncJournalToSubmission(p.airtableRecordId, p.journalEntries))
    );

    return res.json({ success: true, recordId: data.id });
  } catch (err) {
    console.error('Save user projects error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   SHOP  —  items & orders
   ───────────────────────────────────────────────────────────────────────── */

app.get('/api/shop/items', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const items = (await loadShopItems()).filter(i => i.active !== false);
    return res.json({ success: true, items, coinsPerHour: COINS_PER_HOUR, storage: AIRTABLE_PAT ? 'airtable' : 'local' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/shop/order', async (req, res) => {
  try {
    const { email, itemId, totalHours, totalPlays } = req.body;
    if (!email || !itemId) return res.status(400).json({ error: 'email and itemId required' });

    const items = await loadShopItems();
    const item = items.find(i => i.id === itemId && i.active !== false);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const hours = Number(totalHours) || 0;
    const plays = Number(totalPlays) || 0;
    const coins = Math.floor(hours * COINS_PER_HOUR);

    if (plays < item.minPlayers) {
      return res.status(400).json({ error: `Requires ${item.minPlayers} players (you have ${plays})` });
    }
    if (coins < item.coins) {
      return res.status(400).json({ error: `Requires ${item.coins} coins (you have ${coins})` });
    }

    const order = {
      id: `ord-${Date.now().toString(36)}`,
      itemId: item.id,
      itemTitle: item.title,
      coins: item.coins,
      minPlayers: item.minPlayers,
      email,
      totalHours: hours,
      totalPlays: plays,
      status: 'pending',
      orderedAt: new Date().toISOString(),
    };
    const result = await appendShopOrder(order);
    return res.json({ success: true, order: result.order });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/shop/items', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    const items = await loadShopItems();
    return res.json({ success: true, items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/shop/items/save', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    const { item } = req.body;
    if (!item?.title?.trim()) return res.status(400).json({ error: 'title is required' });

    const payload = {
      id: item.id || newShopItemId(item.title),
      title: String(item.title).trim(),
      desc: String(item.desc || '').trim(),
      coins: Math.max(0, Number(item.coins) || 0),
      minPlayers: Math.max(0, Number(item.minPlayers) || 0),
      image: String(item.image || '').trim(),
      active: item.active !== false,
    };

    const result = await upsertShopItem(payload);
    return res.json({ success: true, item: result.item, items: result.items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/shop/items/delete', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const items = await deleteShopItem(id);
    return res.json({ success: true, items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/shop/orders', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    const orders = await loadShopOrders();
    return res.json({ success: true, orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/shop/orders/update', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    const result = await updateShopOrderStatus(id, status);
    return res.json({ success: true, order: result.order });
  } catch (err) {
    if (err.message === 'Order not found') return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   In production, serve the built frontend from /dist
   ───────────────────────────────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'dist', 'index.html'), err => err && next());
});

app.listen(PORT, () => console.log(`API + static server running at http://localhost:${PORT}`));
