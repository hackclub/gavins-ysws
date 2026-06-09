import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';


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
const AIRTABLE_SHOP_ITEMS_TABLE  = process.env.AIRTABLE_SHOP_ITEMS_TABLE  || 'Shop Items';
const AIRTABLE_SHOP_ORDERS_TABLE = process.env.AIRTABLE_SHOP_ORDERS_TABLE || 'Shop Orders';
const AIRTABLE_ADMINS_TABLE      = process.env.AIRTABLE_ADMINS_TABLE      || 'Admins';
// T1 = basic admins (review, users, projects). T2 = super admins (+ shop, manage admins).
// ADMIN_EMAILS = T2 super admins (backwards-compatible with existing .env).
// ADMIN_T1_EMAILS = T1 basic admins.
const ADMIN_T2_EMAILS = (process.env.ADMIN_EMAILS    || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const ADMIN_T1_EMAILS = (process.env.ADMIN_T1_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

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
// Internal reviewer notes, stored as JSON so they sync across all admins.
//   ADMIN_NOTES_FIELD → long-text field on the submissions table (per project)
//   USER_NOTES_FIELD  → long-text field on the User Projects table (per creator)
const ADMIN_NOTES_FIELD = process.env.AIRTABLE_ADMIN_NOTES_FIELD || 'Admin Notes';
const USER_NOTES_FIELD  = process.env.AIRTABLE_USER_NOTES_FIELD  || 'User Notes';

const REVIEWS_PATH               = path.join(__dirname, '.review-decisions.json');
const PLAYS_PATH                 = path.join(__dirname, '.play-counts.json');
const COMMENTS_PATH              = path.join(__dirname, '.comments.json');
const SHOP_ITEMS_PATH            = path.join(__dirname, '.shop-items.json');
const SHOP_ORDERS_PATH           = path.join(__dirname, '.shop-orders.json');
const ADMIN_NOTES_PATH           = path.join(__dirname, '.admin-notes.json');
const ADMIN_SUBMITTER_NOTES_PATH = path.join(__dirname, '.admin-submitter-notes.json');
const ADMIN_LIST_PATH            = path.join(__dirname, '.admin-list.json');
const USER_PLAYS_PATH            = path.join(__dirname, '.user-plays.json');
const UPLOADS_DIR                = path.join(__dirname, 'uploads');
const COINS_PER_HOUR             = 20;

// Ensure the uploads directory exists for journal screenshots.
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

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

// Internal admin-only notes, keyed by submission record id. Never exposed to users.
async function loadAdminNotes() {
  try { return JSON.parse(await fs.readFile(ADMIN_NOTES_PATH, 'utf8')); } catch { return {}; }
}
async function saveAdminNotes(data) {
  await fs.writeFile(ADMIN_NOTES_PATH, JSON.stringify(data, null, 2));
}

// Internal admin notes about a submitter, keyed by lowercased email — shared
// across every project that person submits. Never exposed to users.
async function loadSubmitterNotes() {
  try { return JSON.parse(await fs.readFile(ADMIN_SUBMITTER_NOTES_PATH, 'utf8')); } catch { return {}; }
}
async function saveSubmitterNotes(data) {
  await fs.writeFile(ADMIN_SUBMITTER_NOTES_PATH, JSON.stringify(data, null, 2));
}

// Admin table field names (create an "Admins" table in your Airtable base with these columns)
const ADMIN_TABLE_FIELDS = {
  email: process.env.AIRTABLE_ADMINS_EMAIL_FIELD || 'Email',
  tier:  process.env.AIRTABLE_ADMINS_TIER_FIELD  || 'Tier',
};

const adminTableUrl = (recordId = '') =>
  `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_ADMINS_TABLE)}${recordId ? '/' + recordId : ''}`;

// Returns { t1: [emails], t2: [emails], records: [{id, email, tier}] }
// Primary: Airtable "Admins" table. Fallback: local .admin-list.json
async function loadAdminList() {
  if (AIRTABLE_PAT) {
    try {
      const records = await fetchAllAirtableRecords(adminTableUrl);
      const t1 = [], t2 = [], rows = [];
      for (const r of records) {
        const email = String(r.fields?.[ADMIN_TABLE_FIELDS.email] || '').trim().toLowerCase();
        const tier  = Number(r.fields?.[ADMIN_TABLE_FIELDS.tier] || 0);
        if (!email) continue;
        rows.push({ id: r.id, email, tier });
        if (tier === 2) t2.push(email); else t1.push(email);
      }
      return { t1, t2, records: rows };
    } catch (err) {
      console.warn('[loadAdminList] Airtable failed, using local fallback:', err.message);
    }
  }
  // Local fallback
  try { return JSON.parse(await fs.readFile(ADMIN_LIST_PATH, 'utf8')); } catch { return { t1: [], t2: [], records: [] }; }
}

// Write-through helper — only used when Airtable isn't available
async function saveAdminListLocal(data) {
  await fs.writeFile(ADMIN_LIST_PATH, JSON.stringify(data, null, 2));
}

async function airtableAdminAdd(email, tier) {
  const lower = email.trim().toLowerCase();
  // If a record already exists for this email, patch its tier instead of creating a duplicate
  const list = await loadAdminList();
  const existing = list.records?.find(r => r.email === lower);
  if (existing) {
    await fetch(adminTableUrl(existing.id), {
      method: 'PATCH', headers: { ...airtableHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [ADMIN_TABLE_FIELDS.tier]: tier } }),
    });
  } else {
    await fetch(adminTableUrl(), {
      method: 'POST', headers: { ...airtableHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [ADMIN_TABLE_FIELDS.email]: lower, [ADMIN_TABLE_FIELDS.tier]: tier } }),
    });
  }
}

async function airtableAdminRemove(email) {
  const lower = email.trim().toLowerCase();
  const list = await loadAdminList();
  const existing = list.records?.find(r => r.email === lower);
  if (existing) {
    await fetch(adminTableUrl(existing.id), { method: 'DELETE', headers: airtableHeaders() });
  }
}

async function loadUserPlays() {
  try { return JSON.parse(await fs.readFile(USER_PLAYS_PATH, 'utf8')); } catch { return {}; }
}
async function saveUserPlays(data) {
  await fs.writeFile(USER_PLAYS_PATH, JSON.stringify(data, null, 2));
}

async function getAdminTier(email) {
  const e = email.toLowerCase();
  if (ADMIN_T2_EMAILS.includes(e)) return 2;
  if (ADMIN_T1_EMAILS.includes(e)) return 1;
  const list = await loadAdminList();
  if ((list.t2 || []).map(x => x.toLowerCase()).includes(e)) return 2;
  if ((list.t1 || []).map(x => x.toLowerCase()).includes(e)) return 1;
  return 0;
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
  address:     'Address',
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
    address: f[SHOP_ORDER_FIELDS.address] || '',
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
    [SHOP_ORDER_FIELDS.address]: order.address || '',
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
  try {
    const airtableItems = await loadShopItemsFromAirtable();
    if (airtableItems !== null) {
      await saveShopItemsLocal(airtableItems).catch(() => {});
      return airtableItems;
    }
  } catch {}
  // Always fall back to local cache / defaults if Airtable fails for any reason
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

/* ── Reviewer notes on a submission (per project) — Airtable-backed, synced across admins ── */
async function loadSubmissionAdminNotes(recordId) {
  if (AIRTABLE_PAT) {
    const rec = await fetchSubmissionRecord(recordId);
    const raw = rec?.fields?.[ADMIN_NOTES_FIELD];
    if (raw) return parseJsonField(raw, []);
  }
  const all = await loadAdminNotes();
  return all[recordId] || [];
}

async function appendSubmissionAdminNote(recordId, note) {
  if (AIRTABLE_PAT) {
    const notes = await loadSubmissionAdminNotes(recordId); // migrates any local notes on first write
    notes.push(note);
    const r = await fetch(airtableUrl(recordId), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: { [ADMIN_NOTES_FIELD]: JSON.stringify(notes) } }),
    });
    const data = await r.json().catch(() => null);
    if (r.ok) return notes;
    if (data?.error?.type !== 'UNKNOWN_FIELD_NAME') {
      throw new Error(data?.error?.message || 'Failed to save note');
    }
  }
  const all = await loadAdminNotes();
  if (!all[recordId]) all[recordId] = [];
  all[recordId].push(note);
  await saveAdminNotes(all);
  return all[recordId];
}

/* ── Reviewer notes about a creator (per email) — stored on the User Projects table ── */
async function findUserRecordByEmail(email) {
  const url = new URL(userTableUrl());
  // Case-insensitive match so we reuse the user's existing record instead of creating a duplicate.
  url.searchParams.set('filterByFormula', `LOWER({Email})="${String(email).toLowerCase().replace(/"/g, '\\"')}"`);
  url.searchParams.set('maxRecords', '1');
  const r = await fetch(url, { headers: airtableHeaders() });
  const data = await r.json().catch(() => null);
  if (!r.ok) return null;
  return data.records?.[0] || null;
}

async function loadUserNotesByEmail(email) {
  if (AIRTABLE_PAT) {
    const rec = await findUserRecordByEmail(email);
    const raw = rec?.fields?.[USER_NOTES_FIELD];
    if (raw) return parseJsonField(raw, []);
  }
  const all = await loadSubmitterNotes();
  return all[String(email).toLowerCase()] || [];
}

async function appendUserNote(email, note) {
  if (AIRTABLE_PAT) {
    const notes = await loadUserNotesByEmail(email); // migrates any local notes on first write
    notes.push(note);
    const rec = await findUserRecordByEmail(email);
    const body = JSON.stringify({ fields: { Email: email, [USER_NOTES_FIELD]: JSON.stringify(notes) } });
    const w = rec
      ? await fetch(userTableUrl(rec.id), { method: 'PATCH', headers: airtableHeaders(), body })
      : await fetch(userTableUrl(),        { method: 'POST',  headers: airtableHeaders(), body });
    const data = await w.json().catch(() => null);
    if (w.ok) return notes;
    if (data?.error?.type !== 'UNKNOWN_FIELD_NAME') {
      throw new Error(data?.error?.message || 'Failed to save note');
    }
  }
  const key = String(email).toLowerCase();
  const all = await loadSubmitterNotes();
  if (!all[key]) all[key] = [];
  all[key].push(note);
  await saveSubmitterNotes(all);
  return all[key];
}

async function syncJournalToSubmission(recordId, journalEntries, tags) {
  if (!AIRTABLE_PAT || !recordId) return;
  const fields = {};
  if (Array.isArray(journalEntries)) fields[JOURNAL_FIELD] = JSON.stringify(journalEntries);
  if (Array.isArray(tags) && tags.length > 0) fields[FIELDS.tags] = tags.join(', ');
  if (!Object.keys(fields).length) return;
  try {
    const r = await fetch(airtableUrl(recordId), {
      method: 'PATCH',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields }),
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

async function fetchHackatimeTotalHours(accessToken) {
  const basicCreds = Buffer.from(`${accessToken}:`).toString('base64');
  const attempts = [
    { url: 'https://hackatime.hackclub.com/api/v1/users/current/projects', auth: `Basic ${basicCreds}` },
    { url: 'https://hackatime.hackclub.com/api/v1/users/current/projects', auth: `Bearer ${accessToken}` },
  ];
  for (const { url, auth } of attempts) {
    const r = await fetch(url, { headers: { Authorization: auth } });
    if (!r.ok) continue;
    try {
      const d = await r.json();
      const list = Array.isArray(d?.projects || d?.data || d)
        ? (d?.projects || d?.data || d)
        : Object.values(d?.projects || d?.data || d);
      return +((list.reduce((s, p) => s + (p.total_seconds || 0), 0) / 3600).toFixed(1));
    } catch {}
  }
  return 0;
}

async function getUserTotalPlaysServerSide(email) {
  const overrides = await loadUserPlays();
  const override = overrides[email.toLowerCase()];
  if (override !== undefined) return override;
  if (!AIRTABLE_PAT) return 0;
  const url = new URL(airtableUrl());
  url.searchParams.set('filterByFormula', `{Email}="${email.replace(/"/g, '\\"')}"`);
  url.searchParams.set('pageSize', '100');
  let gameIds = [], offset;
  do {
    const pageUrl = new URL(url);
    if (offset) pageUrl.searchParams.set('offset', offset);
    const r = await fetch(pageUrl, { headers: airtableHeaders() });
    const data = await r.json().catch(() => null);
    if (!r.ok) break;
    (data.records || [])
      .filter(rec => isAcceptedReviewStatus(rec.fields?.[FIELDS.reviewStatus]))
      .forEach(rec => gameIds.push(rec.id));
    offset = data.offset;
  } while (offset);
  const allPlays = await loadPlays();
  return gameIds.reduce((sum, id) => sum + (allPlays[id] || 0), 0);
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

    // Require authentication and verify email ownership
    if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
    const ht = await fetchHackatimeProfile(accessToken).catch(() => null);
    if (!ht?.email) return res.status(401).json({ error: 'Invalid or expired token' });
    if (!email) email = ht.email;
    if (email.toLowerCase() !== ht.email.toLowerCase())
      return res.status(403).json({ error: 'Cannot submit on behalf of another user' });
    if (!githubUser && ht.githubUsername) githubUser = ht.githubUsername;
    if (!firstName && ht.firstName) firstName = ht.firstName;
    if (!lastName && ht.lastName) lastName = ht.lastName;
    if (playableUrl) {
      try {
        const parsed = new URL(playableUrl);
        if (parsed.protocol !== 'https:') return res.status(400).json({ error: 'Playable URL must use HTTPS' });
      } catch {
        return res.status(400).json({ error: 'Invalid playable URL' });
      }
    }
    if (hackatimeProject) {
      try {
        const htHours = await fetchHackatimeProjectHours(accessToken, hackatimeProject);
        if (htHours > 0) hours = htHours;
      } catch (err) {
        console.warn('[submit-project] Hackatime hours fetch skipped:', err.message);
      }
    }

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
    const { email, accessToken } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
    const htProfile = await fetchHackatimeProfile(accessToken).catch(() => null);
    if (!htProfile?.email) return res.status(401).json({ error: 'Invalid or expired token' });
    if (htProfile.email.toLowerCase() !== email.toLowerCase())
      return res.status(403).json({ error: 'Cannot view another user\'s submissions' });

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
    const submissions = await Promise.all(records.map(async rec => {
      // Comments live in the record's Comments Data field (or the local fallback
      // file). Surface organizer feedback ([Feedback]-prefixed) to the submitter.
      let comments = parseJsonField(rec.fields?.[COMMENTS_FIELD], null);
      if (comments == null) comments = await loadSubmissionComments(rec.id);
      const feedback = (Array.isArray(comments) ? comments : [])
        .filter(c => typeof c?.text === 'string' && c.text.trim().startsWith('[Feedback]'))
        .map(c => ({
          text: c.text.replace(/^\s*\[Feedback\]\s*/, ''),
          date: c.date || null,
          author: c.author || 'Organizer',
        }));
      const hoursOverride = rec.fields?.[FIELDS.hours] ?? null;
      return {
        recordId: rec.id,
        description: rec.fields?.[FIELDS.description] || rec.fields?.Description || '',
        reviewStatus: resolveReviewStatus(rec.fields, decisions[rec.id]),
        feedback,
        ...(hoursOverride != null ? { hoursOverride: Number(hoursOverride) } : {}),
      };
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
async function checkAdmin(req, res, minTier = 1) {
  const token = req.body?.accessToken || req.headers['x-access-token'];
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  try {
    const profile = await fetchHackatimeProfile(token);
    const email = profile?.email?.toLowerCase();
    if (!email) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    const tier = await getAdminTier(email);
    if (tier === 0) { res.status(403).json({ error: 'Access denied — your email is not on the admin list' }); return null; }
    if (tier < minTier) { res.status(403).json({ error: `T${minTier} admin access required` }); return null; }
    return { email: profile.email, tier };
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify identity' });
    return null;
  }
}

// Check if an email is an admin — used by the frontend to show/hide the page
app.post('/api/admin/check', async (req, res) => {
  const admin = await checkAdmin(req, res);
  if (admin) res.json({ success: true, email: admin.email, tier: admin.tier });
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

const ALLOWED_REVIEW_STATUSES = ['Under Review', 'Accepted', 'Rejected', 'Accepted - L1', 'Accepted - L2', 'Accepted - L3'];

app.post('/api/admin/review', async (req, res) => {
  if (!await checkAdmin(req, res, 2)) return;
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured on the server.' });
    const { recordId, status } = req.body;
    if (!recordId || !status) return res.status(400).json({ error: 'recordId and status are required' });
    if (!ALLOWED_REVIEW_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value' });

    const result = await persistReviewStatus(recordId, status);
    return res.json({ success: true, reviewStatus: status, storage: result.storage, record: result.record || null });
  } catch (err) {
    console.error('Admin review error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.post('/api/admin/adjust', async (req, res) => {
  if (!await checkAdmin(req, res, 2)) return;
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured on the server.' });
    const { recordId, hours, plays } = req.body;
    if (!recordId) return res.status(400).json({ error: 'recordId required' });

    const updates = {};

    if (hours !== undefined && hours !== null) {
      const r = await fetch(airtableUrl(recordId), {
        method: 'PATCH',
        headers: airtableHeaders(),
        body: JSON.stringify({ fields: { [FIELDS.hours]: Number(hours) }, typecast: true }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error?.message || 'Failed to update hours');
      updates.hours = Number(hours);
    }

    if (plays !== undefined && plays !== null) {
      const allPlays = await loadPlays();
      allPlays[recordId] = Number(plays);
      await savePlays(allPlays);
      updates.plays = Number(plays);
    }

    return res.json({ success: true, updates });
  } catch (err) {
    console.error('Admin adjust error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Admin: set total plays override for a user (bypasses per-game counting)
app.post('/api/admin/set-user-plays', async (req, res) => {
  if (!await checkAdmin(req, res, 2)) return;
  const { email, plays } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  if (plays === undefined || plays === null) return res.status(400).json({ error: 'plays required' });
  const data = await loadUserPlays();
  data[email.toLowerCase()] = Number(plays);
  await saveUserPlays(data);
  return res.json({ success: true, plays: Number(plays) });
});

// User: fetch total plays — requires auth to prevent enumeration of override data
app.post('/api/user/plays', async (req, res) => {
  const { email, gameIds, accessToken } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
  const profile = await fetchHackatimeProfile(accessToken).catch(() => null);
  if (!profile?.email) return res.status(401).json({ error: 'Invalid or expired token' });
  if (profile.email.toLowerCase() !== email.toLowerCase()) return res.status(403).json({ error: 'Unauthorized' });
  try {
    const overrides = await loadUserPlays();
    const override = overrides[email.toLowerCase()];
    if (override !== undefined) {
      return res.json({ success: true, total: override, source: 'override' });
    }
    // Fall back to organic play counts
    const allPlays = await loadPlays();
    const ids = Array.isArray(gameIds) ? gameIds : [];
    const total = ids.reduce((sum, id) => sum + (allPlays[id] || 0), 0);
    return res.json({ success: true, total, source: 'organic' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Build the combined display lists (env + file-based, deduped) for the frontend.
// The frontend uses envT1/envT2 to show the "(env)" badge and block removal.
function buildAdminListResponse(fileList) {
  const fileT1 = (fileList.t1 || []).map(e => e.toLowerCase());
  const fileT2 = (fileList.t2 || []).map(e => e.toLowerCase());
  // Env admins always appear in the combined list; file-based ones fill in the rest.
  const t2 = [...new Set([...ADMIN_T2_EMAILS, ...fileT2])];
  const t1 = [...new Set([...ADMIN_T1_EMAILS, ...fileT1.filter(e => !t2.includes(e))])];
  return { t1, t2, envT1: ADMIN_T1_EMAILS, envT2: ADMIN_T2_EMAILS };
}

app.post('/api/admin/admins/list', async (req, res) => {
  const admin = await checkAdmin(req, res, 2);
  if (!admin) return;
  try {
    const list = await loadAdminList();
    return res.json({ success: true, ...buildAdminListResponse(list) });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/admins/add', async (req, res) => {
  const admin = await checkAdmin(req, res, 2);
  if (!admin) return;
  const { email, tier } = req.body;
  if (!email || ![1, 2].includes(Number(tier))) return res.status(400).json({ error: 'email and tier (1 or 2) required' });
  const e = email.trim().toLowerCase();
  const t = Number(tier) === 2 ? 2 : 1;
  try {
    // Load current list first so we can build an optimistic response
    const list = await loadAdminList();
    if (AIRTABLE_PAT) {
      await airtableAdminAdd(e, t);
    } else {
      if (!ADMIN_T2_EMAILS.includes(e) && !ADMIN_T1_EMAILS.includes(e)) {
        list.t1 = (list.t1 || []).filter(x => x !== e);
        list.t2 = (list.t2 || []).filter(x => x !== e);
        if (t === 2) list.t2.push(e); else list.t1.push(e);
        await saveAdminListLocal(list);
      }
    }
    // Build optimistic response — include the newly added email without re-fetching
    const optimistic = {
      t1: (list.t1 || []).filter(x => x !== e),
      t2: (list.t2 || []).filter(x => x !== e),
    };
    if (t === 2) optimistic.t2.push(e); else optimistic.t1.push(e);
    return res.json({ success: true, ...buildAdminListResponse(optimistic) });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/admins/remove', async (req, res) => {
  const admin = await checkAdmin(req, res, 2);
  if (!admin) return;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  const e = email.trim().toLowerCase();
  if (ADMIN_T2_EMAILS.includes(e) || ADMIN_T1_EMAILS.includes(e)) {
    return res.status(400).json({ error: 'Cannot remove env-configured admins — edit ADMIN_EMAILS or ADMIN_T1_EMAILS in .env' });
  }
  try {
    // Load first so we can build optimistic response
    const list = await loadAdminList();
    if (AIRTABLE_PAT) {
      await airtableAdminDelete(e);
    } else {
      list.t1 = (list.t1 || []).filter(x => x !== e);
      list.t2 = (list.t2 || []).filter(x => x !== e);
      await saveAdminListLocal(list);
    }
    // Optimistic response — remove the email without re-fetching
    const optimistic = {
      t1: (list.t1 || []).filter(x => x !== e),
      t2: (list.t2 || []).filter(x => x !== e),
    };
    return res.json({ success: true, ...buildAdminListResponse(optimistic) });
  } catch (err) { return res.status(500).json({ error: err.message }); }
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

// Internal admin notes for a submission — admin-only, never shown to the submitter.
// Stored on the submission's Airtable record so they sync across all admins.
app.post('/api/admin/notes', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    const { recordId } = req.body;
    if (!recordId) return res.status(400).json({ error: 'recordId required' });
    const notes = await loadSubmissionAdminNotes(recordId);
    return res.json({ success: true, notes });
  } catch (err) {
    console.error('Admin notes error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/admin/notes/add', async (req, res) => {
  const adminEmail = await checkAdmin(req, res);
  if (!adminEmail) return;
  try {
    const { recordId, text } = req.body;
    if (!recordId || !text?.trim()) return res.status(400).json({ error: 'recordId and text required' });
    const note = { author: adminEmail, text: text.trim(), date: new Date().toISOString() };
    const notes = await appendSubmissionAdminNote(recordId, note);
    return res.json({ success: true, note, notes });
  } catch (err) {
    console.error('Admin add-note error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Admin notes about a submitter — shared across all their submissions. Admin-only.
// Stored on the creator's User Projects record so they sync across all admins.
app.post('/api/admin/submitter-notes', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  try {
    const email = (req.body?.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    const notes = await loadUserNotesByEmail(email);
    return res.json({ success: true, notes });
  } catch (err) {
    console.error('Submitter notes error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/admin/submitter-notes/add', async (req, res) => {
  const adminEmail = await checkAdmin(req, res);
  if (!adminEmail) return;
  try {
    const email = (req.body?.email || '').trim();
    const text = req.body?.text;
    if (!email || !text?.trim()) return res.status(400).json({ error: 'email and text required' });
    const note = { author: adminEmail, text: text.trim(), date: new Date().toISOString() };
    const notes = await appendUserNote(email, note);
    return res.json({ success: true, note, notes });
  } catch (err) {
    console.error('Submitter add-note error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Record one play for a game — requires auth to prevent inflation attacks
app.post('/api/play', async (req, res) => {
  const { gameId, accessToken } = req.body;
  if (!gameId) return res.status(400).json({ error: 'gameId required' });
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
  if (!/^rec[A-Za-z0-9]{10,20}$/.test(gameId)) return res.status(400).json({ error: 'Invalid gameId' });
  const profile = await fetchHackatimeProfile(accessToken).catch(() => null);
  if (!profile?.email) return res.status(401).json({ error: 'Invalid or expired token' });
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
  const { gameId, text, accessToken } = req.body;
  if (!gameId || !text?.trim()) return res.status(400).json({ error: 'gameId and text required' });
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
  const htProfile = await fetchHackatimeProfile(accessToken).catch(() => null);
  if (!htProfile?.email) return res.status(401).json({ error: 'Invalid or expired token' });
  // Only verified admins may post [Feedback]-prefixed comments
  if (text.trim().startsWith('[Feedback]')) {
    const tier = await getAdminTier(htProfile.email.toLowerCase());
    if (tier === 0) return res.status(403).json({ error: 'Only admins can post feedback' });
  }
  // Always derive display name from the verified profile — never trust client-supplied author
  const displayName = htProfile.username || htProfile.displayName || htProfile.githubUsername || 'Arcade Player';
  try {
    const comment = {
      author: displayName,
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

// Temporary: shows which expected env vars the server can actually see (no values exposed)
app.get('/api/debug-env', (req, res) => {
  res.json({
    HACKATIME_SECRET:  !!process.env.HACKATIME_SECRET,
    HACKATIME_CLIENT_ID: !!process.env.HACKATIME_CLIENT_ID,
    AIRTABLE_PAT:      !!process.env.AIRTABLE_PAT,
    AIRTABLE_BASE_ID:  !!process.env.AIRTABLE_BASE_ID,
    PORT:              process.env.PORT || '(not set)',
  });
});

// Lets the frontend know which features are wired up without exposing secrets.
app.get('/api/config', (req, res) => {
  res.json({
    hackatimeClientId: HACKATIME_CLIENT_ID,
    hackatimeReady: Boolean(HACKATIME_SECRET),
    airtableReady: Boolean(AIRTABLE_PAT),
  });
});


/* ─────────────────────────────────────────────────────────────────────────
   USER PROJECT DATA  — load & save per-user projects to Airtable
   Table: "User Projects"  Fields: Email (text), Projects Data (long text)
   ───────────────────────────────────────────────────────────────────────── */

app.post('/api/user/projects/load', async (req, res) => {
  try {
    if (!AIRTABLE_PAT) return res.status(500).json({ error: 'Airtable not configured' });
    const { email, accessToken } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
    const htProfile = await fetchHackatimeProfile(accessToken).catch(() => null);
    if (!htProfile?.email) return res.status(401).json({ error: 'Invalid or expired token' });
    if (htProfile.email.toLowerCase() !== email.toLowerCase())
      return res.status(403).json({ error: 'Cannot load another user\'s data' });
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
    const { email, projects, recordId, accessToken } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
    const htProfile = await fetchHackatimeProfile(accessToken).catch(() => null);
    if (!htProfile?.email) return res.status(401).json({ error: 'Invalid or expired token' });
    if (htProfile.email.toLowerCase() !== email.toLowerCase())
      return res.status(403).json({ error: 'Cannot modify another user\'s data' });

    // Strip base64 data URIs from headerImage — plain URLs are fine to store
    const sanitised = (projects || []).map(p => ({
      ...p,
      headerImage: p.headerImage?.startsWith('data:') ? null : (p.headerImage || null),
    }));
    const fields = { 'Email': email, 'Projects Data': JSON.stringify(sanitised) };

    // Always resolve the record ID server-side — never trust the client-supplied value
    const { recordId: resolvedRecordId } = await loadUserProjectsByEmail(email);
    const r = resolvedRecordId
      ? await fetch(userTableUrl(resolvedRecordId), { method: 'PATCH', headers: airtableHeaders(), body: JSON.stringify({ fields }) })
      : await fetch(userTableUrl(),                 { method: 'POST',  headers: airtableHeaders(), body: JSON.stringify({ fields }) });

    const data = await r.json().catch(() => null);
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Airtable error' });

    // Mirror journal entries onto linked submission records so admin/arcade see fresh logs.
    // First, fetch the authenticated user's own submission record IDs to prevent IDOR.
    let ownedSubmissionIds = new Set();
    if (AIRTABLE_PAT) {
      try {
        const submUrl = new URL(airtableUrl());
        submUrl.searchParams.set('filterByFormula', `{Email}="${email.replace(/"/g, '\\"')}"`);
        submUrl.searchParams.set('fields[]', 'Email');
        submUrl.searchParams.set('pageSize', '100');
        let offset;
        do {
          const pageUrl = new URL(submUrl);
          if (offset) pageUrl.searchParams.set('offset', offset);
          const r = await fetch(pageUrl, { headers: airtableHeaders() });
          const data = await r.json().catch(() => null);
          if (r.ok) (data.records || []).forEach(rec => ownedSubmissionIds.add(rec.id));
          offset = r.ok ? data.offset : null;
        } while (offset);
      } catch {}
    }
    await Promise.all(
      sanitised
        .filter(p => p.airtableRecordId && ownedSubmissionIds.has(p.airtableRecordId)
                  && (Array.isArray(p.journalEntries) || Array.isArray(p.tags)))
        .map(p => syncJournalToSubmission(p.airtableRecordId, p.journalEntries, p.tags))
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
    const items = (await loadShopItems()).filter(i => i.active !== false && i.title && i.minPlayers > 0);
    return res.json({ success: true, items, coinsPerHour: COINS_PER_HOUR, storage: AIRTABLE_PAT ? 'airtable' : 'local' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/shop/order', async (req, res) => {
  try {
    const { email, itemId, accessToken, address } = req.body;
    if (!email || !itemId) return res.status(400).json({ error: 'email and itemId required' });
    if (!address?.trim()) return res.status(400).json({ error: 'Shipping address required' });
    if (address.trim().length > 500) return res.status(400).json({ error: 'Address must be 500 characters or fewer' });
    if (!accessToken) return res.status(401).json({ error: 'Authentication required' });

    const htProfile = await fetchHackatimeProfile(accessToken).catch(() => null);
    if (!htProfile?.email) return res.status(401).json({ error: 'Invalid or expired token' });
    if (htProfile.email.toLowerCase() !== email.toLowerCase())
      return res.status(403).json({ error: 'Cannot place order for another user' });

    const items = await loadShopItems();
    const item = items.find(i => i.id === itemId && i.active !== false);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Prevent duplicate orders for the same item
    const existingOrders = await loadShopOrders();
    const alreadyOrdered = existingOrders.some(
      o => o.email?.toLowerCase() === email.toLowerCase() && o.itemId === itemId && o.status !== 'cancelled'
    );
    if (alreadyOrdered) return res.status(409).json({ error: 'You already have an active order for this item' });

    // Always compute hours and plays server-side — never trust client-supplied values
    const [totalHours, totalPlays] = await Promise.all([
      fetchHackatimeTotalHours(accessToken),
      getUserTotalPlaysServerSide(email),
    ]);
    const coins = Math.floor(totalHours * COINS_PER_HOUR);

    if (totalPlays < item.minPlayers) {
      return res.status(400).json({ error: `Requires ${item.minPlayers} players (you have ${totalPlays})` });
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
      totalHours,
      totalPlays,
      address: address.trim(),
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
  if (!await checkAdmin(req, res, 2)) return;
  try {
    const items = await loadShopItems();
    return res.json({ success: true, items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/shop/items/save', async (req, res) => {
  if (!await checkAdmin(req, res, 2)) return;
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
  if (!await checkAdmin(req, res, 2)) return;
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
  if (!await checkAdmin(req, res, 2)) return;
  try {
    const orders = await loadShopOrders();
    return res.json({ success: true, orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const VALID_ORDER_STATUSES = ['pending', 'fulfilled', 'cancelled'];
const TERMINAL_ORDER_STATUSES = ['fulfilled', 'cancelled'];

app.post('/api/admin/shop/orders/update', async (req, res) => {
  if (!await checkAdmin(req, res, 2)) return;
  try {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    if (!VALID_ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value' });
    const orders = await loadShopOrders();
    const current = orders.find(o => o.id === id);
    if (!current) return res.status(404).json({ error: 'Order not found' });
    if (TERMINAL_ORDER_STATUSES.includes(current.status))
      return res.status(409).json({ error: 'Cannot modify a completed or cancelled order' });
    const result = await updateShopOrderStatus(id, status);
    return res.json({ success: true, order: result.order });
  } catch (err) {
    if (err.message === 'Order not found') return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   Image uploads (journal screenshots) — stored on disk, served by URL.
   Served under /api/* so the dev Vite proxy forwards it to this server.
   ───────────────────────────────────────────────────────────────────────── */
app.use('/api/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', immutable: true }));

app.post('/api/upload', async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl is required' });
    const m = dataUrl.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Unsupported or invalid image data' });
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 6MB)' });
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    await fs.writeFile(path.join(UPLOADS_DIR, name), buf);
    return res.json({ success: true, url: `/api/uploads/${name}` });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Upload failed' });
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
