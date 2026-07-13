/* ============================================================
   Good Kids — บันทึกดาวงานบ้าน
   Vanilla JS SPA · localStorage
   ============================================================ */

'use strict';

// ---------- Data ----------
const STORE_KEY = 'goodkids-data-v1';

const AVATARS = ['🦁','🐯','🐰','🐻','🐼','🦊','🐨','🐷','🐸','🐵','🦄','🐶','🐱','🐹','🦖','🐙','🦋','🐬','🦉','🐢'];
const COLORS = ['#ffe0e0','#ffe9cc','#fff4c2','#e0f7d9','#d4f1f9','#e3e0ff','#fde0f1','#e0ecff','#e8f5e9','#fce4ec'];
const CHORE_ICONS = ['🧹','🧺','🍽️','🛏️','🗑️','🌱','🐕','🧽','👕','🥗','📚','🚿','🧸','🪟','🍳','🛒','♻️','🚲'];
const REWARD_ICONS = ['🎮','🍦','🍕','🎬','🧸','📱','🎨','⚽','🎢','📖','🍭','🎧','🛴','🏊','🎪','💵','🍿','🎂'];

const DEFAULT_DATA = {
  pin: '1234',
  weeklyGoal: 20,
  kids: [
    { id: 'k1', name: 'น้องเอ', avatar: '🦁', color: '#ffe9cc' },
    { id: 'k2', name: 'น้องบี', avatar: '🐰', color: '#fde0f1' },
  ],
  chores: [
    { id: 'c1', name: 'ล้างจาน', icon: '🍽️', stars: 2 },
    { id: 'c2', name: 'กวาดบ้าน', icon: '🧹', stars: 2 },
    { id: 'c3', name: 'เก็บที่นอน', icon: '🛏️', stars: 1 },
    { id: 'c4', name: 'ทิ้งขยะ', icon: '🗑️', stars: 1 },
    { id: 'c5', name: 'รดน้ำต้นไม้', icon: '🌱', stars: 1 },
    { id: 'c6', name: 'พับผ้า', icon: '👕', stars: 2 },
  ],
  rewards: [
    { id: 'r1', name: 'เล่นเกม 30 นาที', icon: '🎮', price: 5 },
    { id: 'r2', name: 'ไอศกรีม', icon: '🍦', price: 8 },
    { id: 'r3', name: 'ดูหนัง 1 เรื่อง', icon: '🎬', price: 10 },
    { id: 'r4', name: 'ของเล่นใหม่', icon: '🧸', price: 30 },
  ],
  log: [], // { id, kidId, type: 'earn'|'spend', name, icon, stars, ts }
  metaTs: 0,      // last edit time of kids/chores/rewards/settings (for sync merge)
  deletedLog: [], // tombstones: log ids deleted on this family (so sync won't resurrect them)
};

let data = load();
let state = { view: 'home', kidId: null, parentUnlocked: false, parentTab: 'kids', pinInput: '' };

function migrate(d) {
  if (typeof d.metaTs !== 'number') d.metaTs = 0;
  if (!Array.isArray(d.deletedLog)) d.deletedLog = [];
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { /* corrupted -> reset */ }
  const d = JSON.parse(JSON.stringify(DEFAULT_DATA));
  localStorage.setItem(STORE_KEY, JSON.stringify(d));
  return d;
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
  schedulePush();
}
function bumpMeta() { data.metaTs = Date.now(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- Sync (Cloudflare KV via /api/family/:code) ----------
const SYNC_KEY = 'goodkids-sync-code';
let syncCode = (localStorage.getItem(SYNC_KEY) || '').toLowerCase();
let syncState = { status: syncCode ? 'idle' : 'off', last: 0 };
let pushTimer = null, syncing = false, pendingSync = false;

function genCode() {
  const part = () => Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 4).padEnd(4, '0');
  return `${part()}-${part()}-${part()}`;
}

async function apiGet(code) {
  const r = await fetch('/api/family/' + encodeURIComponent(code), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('sync get failed');
  return r.json();
}
async function apiPut(code, d) {
  const r = await fetch('/api/family/' + encodeURIComponent(code), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(d),
  });
  if (!r.ok) throw new Error('sync put failed');
}

// Merge: log = union by id (minus tombstones), meta = newer side wins
function mergeData(a, b) {
  const metaSrc = (b.metaTs || 0) > (a.metaTs || 0) ? b : a;
  const deleted = new Set([...(a.deletedLog || []), ...(b.deletedLog || [])]);
  const byId = new Map();
  [...(b.log || []), ...(a.log || [])].forEach(l => { if (!deleted.has(l.id)) byId.set(l.id, l); });
  return {
    pin: metaSrc.pin,
    weeklyGoal: metaSrc.weeklyGoal,
    kids: metaSrc.kids,
    chores: metaSrc.chores,
    rewards: metaSrc.rewards,
    log: [...byId.values()].sort((x, y) => x.ts - y.ts),
    metaTs: Math.max(a.metaTs || 0, b.metaTs || 0),
    deletedLog: [...deleted],
  };
}

async function syncNow() {
  if (!syncCode) return;
  if (syncing) { pendingSync = true; return; }
  syncing = true;
  syncState.status = 'syncing';
  try {
    const remote = await apiGet(syncCode);
    const merged = remote ? migrate(mergeData(data, remote)) : data;
    const localChanged = JSON.stringify(merged) !== JSON.stringify(data);
    const remoteChanged = !remote || JSON.stringify(merged) !== JSON.stringify(remote);
    if (localChanged) {
      data = merged;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    }
    if (remoteChanged) await apiPut(syncCode, merged);
    syncState = { status: 'ok', last: Date.now() };
    if (localChanged) render();
    else if (state.view === 'parent' && state.parentTab === 'settings' && state.parentUnlocked) updateSyncStatusLine();
  } catch (e) {
    syncState.status = 'error';
    updateSyncStatusLine();
  }
  syncing = false;
  if (pendingSync) { pendingSync = false; schedulePush(); }
}

function schedulePush() {
  if (!syncCode) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, 1200);
}

function syncStatusText() {
  if (!syncCode) return '';
  if (syncState.status === 'syncing') return '🔄 กำลัง sync...';
  if (syncState.status === 'error') return '⚠️ sync ไม่สำเร็จ — จะลองใหม่อัตโนมัติ';
  if (syncState.last) return `✅ sync ล่าสุด ${new Date(syncState.last).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  return 'รอ sync ครั้งแรก...';
}
function updateSyncStatusLine() {
  const el = document.getElementById('syncStatusLine');
  if (el) el.textContent = syncStatusText();
}

setInterval(() => {
  if (syncCode && document.visibilityState === 'visible') syncNow();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow();
});

// ---------- Derived ----------
function kidLog(kidId) { return data.log.filter(l => l.kidId === kidId); }
function earned(kidId) { return kidLog(kidId).filter(l => l.type === 'earn').reduce((s, l) => s + l.stars, 0); }
function spent(kidId) { return kidLog(kidId).filter(l => l.type === 'spend').reduce((s, l) => s + l.stars, 0); }
function balance(kidId) { return earned(kidId) - spent(kidId); }
function weekStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.getTime();
}
function earnedThisWeek(kidId) {
  const ws = weekStart();
  return kidLog(kidId).filter(l => l.type === 'earn' && l.ts >= ws).reduce((s, l) => s + l.stars, 0);
}

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const app = $('#app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function starBurst(x, y, count = 10) {
  const layer = $('#fxLayer');
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'fx-star';
    s.textContent = Math.random() > 0.3 ? '⭐' : '✨';
    const ang = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 110;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(ang) * dist - 40 + 'px');
    s.style.setProperty('--rot', (Math.random() * 360 - 180) + 'deg');
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------- Modal ----------
const backdrop = $('#modalBackdrop');
const modalBox = $('#modalBox');
function openModal(html) {
  modalBox.innerHTML = html;
  backdrop.classList.remove('hidden');
}
function closeModal() { backdrop.classList.add('hidden'); modalBox.innerHTML = ''; }
backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

// ---------- Router ----------
function go(view, extra = {}) {
  state = { ...state, view, ...extra };
  render();
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const nav = btn.dataset.nav;
    if (nav === 'parent' && !state.parentUnlocked) { state.pinInput = ''; }
    go(nav);
  });
});
$('#brandBtn').addEventListener('click', () => go('home'));

function render() {
  document.querySelectorAll('.nav-btn').forEach(b => {
    const v = state.view === 'kid' ? 'home' : state.view;
    b.classList.toggle('active', b.dataset.nav === v);
  });
  if (state.view === 'home') renderHome();
  else if (state.view === 'kid') renderKid();
  else if (state.view === 'rewards') renderRewards();
  else if (state.view === 'parent') renderParent();
}

// ============================================================
// HOME — kid profiles
// ============================================================
function renderHome() {
  const cards = data.kids.map(k => {
    const bal = balance(k.id);
    const week = earnedThisWeek(k.id);
    const goal = data.weeklyGoal || 20;
    const pct = Math.min(100, Math.round(week / goal * 100));
    return `
      <button class="card kid-card" data-kid="${k.id}">
        <span class="kid-avatar" style="background:${k.color}">${k.avatar}</span>
        <span class="kid-name">${esc(k.name)}</span>
        <span class="kid-balance"><span class="star-ic">⭐</span>${bal} ดาว</span>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-label">สัปดาห์นี้ ${week}/${goal} ดาว</span>
      </button>`;
  }).join('');

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">สวัสดี! วันนี้ทำงานบ้านอะไรดี 🏡</h1>
        <p class="page-sub">เลือกโปรไฟล์ของหนูเพื่อบันทึกงานและสะสมดาว</p>
      </div>
    </div>
    ${data.kids.length ? `<div class="kid-grid">${cards}</div>` : `
      <div class="card empty">
        <span class="empty-icon">👶</span>
        ยังไม่มีโปรไฟล์เด็ก — ไปที่เมนู <b>ผู้ปกครอง</b> เพื่อเพิ่มโปรไฟล์
      </div>`}
  `;
  app.querySelectorAll('[data-kid]').forEach(el =>
    el.addEventListener('click', () => go('kid', { kidId: el.dataset.kid })));
}

// ============================================================
// KID DETAIL — log chores, redeem, history
// ============================================================
function renderKid() {
  const k = data.kids.find(x => x.id === state.kidId);
  if (!k) return go('home');
  const bal = balance(k.id);
  const week = earnedThisWeek(k.id);
  const goal = data.weeklyGoal || 20;
  const pct = Math.min(100, Math.round(week / goal * 100));
  const history = kidLog(k.id).slice().sort((a, b) => b.ts - a.ts).slice(0, 15);

  app.innerHTML = `
    <button class="back-link" id="backHome">← กลับหน้าหลัก</button>
    <section class="card kid-hero">
      <span class="kid-avatar lg" style="background:${k.color}">${k.avatar}</span>
      <div class="kid-hero-info">
        <div class="kid-hero-name">${esc(k.name)}</div>
        <div class="kid-hero-stats">
          <div class="hero-stat"><b>⭐ ${bal}</b><span>ดาวคงเหลือ</span></div>
          <div class="hero-stat"><b>${earned(k.id)}</b><span>ได้รับทั้งหมด</span></div>
          <div class="hero-stat"><b>${spent(k.id)}</b><span>ใช้แลกไปแล้ว</span></div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-label" style="opacity:.9">เป้าหมายสัปดาห์นี้ ${week}/${goal} ดาว ${pct >= 100 ? '🎉 เก่งมาก!' : ''}</span>
      </div>
    </section>

    <h2 class="section-title">🧹 ทำงานบ้านเสร็จแล้ว กดเลย!</h2>
    ${data.chores.length ? `<div class="chore-grid">${data.chores.map(c => `
      <button class="card chore-card" data-chore="${c.id}">
        <span class="chore-icon">${c.icon}</span>
        <span class="chore-name">${esc(c.name)}</span>
        <span class="chip chip-star">+${c.stars} ⭐</span>
      </button>`).join('')}</div>`
      : `<div class="card empty">ยังไม่มีรายการงานบ้าน — ผู้ปกครองเพิ่มได้ในเมนูผู้ปกครอง</div>`}

    <h2 class="section-title">🎁 แลกของรางวัล</h2>
    ${data.rewards.length ? `<div class="reward-grid">${data.rewards.map(r => {
      const ok = bal >= r.price;
      return `
      <div class="card reward-card ${ok ? '' : 'locked'}">
        <span class="reward-icon">${r.icon}</span>
        <span class="reward-name">${esc(r.name)}</span>
        <span class="chip chip-star">${r.price} ⭐</span>
        <button class="btn btn-sm ${ok ? 'btn-primary' : 'btn-ghost'}" data-redeem="${r.id}" ${ok ? '' : 'disabled'}>
          ${ok ? 'แลกเลย' : 'ดาวยังไม่พอ'}
        </button>
      </div>`;
    }).join('')}</div>`
      : `<div class="card empty">ยังไม่มีของรางวัล</div>`}

    <h2 class="section-title">📖 ประวัติล่าสุด</h2>
    <div class="card history-list">
      ${history.length ? history.map(historyRow).join('')
        : `<div class="empty"><span class="empty-icon">🌟</span>ยังไม่มีประวัติ — เริ่มทำงานบ้านชิ้นแรกกันเลย!</div>`}
    </div>
  `;

  $('#backHome').addEventListener('click', () => go('home'));

  app.querySelectorAll('[data-chore]').forEach(el => el.addEventListener('click', e => {
    const c = data.chores.find(x => x.id === el.dataset.chore);
    if (!c) return;
    openModal(`
      <span class="confirm-icon">${c.icon}</span>
      <p class="confirm-text"><b>${esc(k.name)}</b> ทำ "<b>${esc(c.name)}</b>" เสร็จแล้วใช่ไหม?</p>
      <p class="confirm-text" style="margin-top:6px">จะได้รับ <b>+${c.stars} ⭐</b></p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mCancel">ยกเลิก</button>
        <button class="btn btn-primary" id="mOk">เสร็จแล้ว! ⭐</button>
      </div>`);
    $('#mCancel').addEventListener('click', closeModal);
    $('#mOk').addEventListener('click', () => {
      data.log.push({ id: uid(), kidId: k.id, type: 'earn', name: c.name, icon: c.icon, stars: c.stars, ts: Date.now() });
      save(); closeModal();
      starBurst(window.innerWidth / 2, window.innerHeight / 2, 14);
      toast(`เก่งมาก! ${k.name} ได้รับ +${c.stars} ⭐`);
      render();
    });
  }));

  app.querySelectorAll('[data-redeem]').forEach(el => el.addEventListener('click', () => {
    const r = data.rewards.find(x => x.id === el.dataset.redeem);
    if (!r || balance(k.id) < r.price) return;
    openModal(`
      <span class="confirm-icon">${r.icon}</span>
      <p class="confirm-text">ใช้ <b>${r.price} ⭐</b> แลก "<b>${esc(r.name)}</b>" ให้ <b>${esc(k.name)}</b>?</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mCancel">ยกเลิก</button>
        <button class="btn btn-primary" id="mOk">แลกเลย 🎁</button>
      </div>`);
    $('#mCancel').addEventListener('click', closeModal);
    $('#mOk').addEventListener('click', () => {
      data.log.push({ id: uid(), kidId: k.id, type: 'spend', name: r.name, icon: r.icon, stars: r.price, ts: Date.now() });
      save(); closeModal();
      toast(`แลก "${r.name}" สำเร็จ! 🎉`);
      render();
    });
  }));
}

function historyRow(l) {
  const kid = data.kids.find(k => k.id === l.kidId);
  return `
    <div class="history-item">
      <span class="history-ic ${l.type}">${l.icon || (l.type === 'earn' ? '⭐' : '🎁')}</span>
      <div class="history-main">
        <div class="history-title">${esc(l.name)}</div>
        <div class="history-meta">${kid ? esc(kid.name) + ' · ' : ''}${fmtDate(l.ts)}</div>
      </div>
      <span class="history-stars ${l.type}">${l.type === 'earn' ? '+' : '−'}${l.stars} ⭐</span>
    </div>`;
}

// ============================================================
// REWARDS (browse)
// ============================================================
function renderRewards() {
  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">🎁 ร้านของรางวัล</h1>
        <p class="page-sub">สะสมดาวให้ครบ แล้วมาแลกของรางวัลกันเถอะ</p>
      </div>
    </div>
    ${data.rewards.length ? `<div class="reward-grid">${data.rewards.map(r => `
      <div class="card reward-card">
        <span class="reward-icon">${r.icon}</span>
        <span class="reward-name">${esc(r.name)}</span>
        <span class="chip chip-star">${r.price} ⭐</span>
      </div>`).join('')}</div>`
      : `<div class="card empty"><span class="empty-icon">🎁</span>ยังไม่มีของรางวัล — ผู้ปกครองเพิ่มได้ในเมนูผู้ปกครอง</div>`}
    <p class="page-sub" style="margin-top:16px">💡 แลกของรางวัลได้จากหน้าโปรไฟล์ของแต่ละคน</p>
  `;
}

// ============================================================
// PARENT PANEL
// ============================================================
function renderParent() {
  if (!state.parentUnlocked) return renderPinPad();

  const totalEarned = data.log.filter(l => l.type === 'earn').reduce((s, l) => s + l.stars, 0);
  const totalSpent = data.log.filter(l => l.type === 'spend').reduce((s, l) => s + l.stars, 0);
  const tabs = [
    ['kids', '👧 เด็กๆ'], ['chores', '🧹 งานบ้าน'], ['rewards', '🎁 ของรางวัล'],
    ['history', '📖 ประวัติ'], ['settings', '⚙️ ตั้งค่า'],
  ];

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">🔐 โหมดผู้ปกครอง</h1>
        <p class="page-sub">จัดการโปรไฟล์ ค่าจ้างงานบ้าน และของรางวัล</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="lockBtn">🔒 ออกจากโหมดผู้ปกครอง</button>
    </div>
    <div class="stat-row">
      <div class="card stat-card"><div class="stat-value">👧 ${data.kids.length}</div><div class="stat-label">โปรไฟล์เด็ก</div></div>
      <div class="card stat-card"><div class="stat-value">⭐ ${totalEarned}</div><div class="stat-label">ดาวที่แจกทั้งหมด</div></div>
      <div class="card stat-card"><div class="stat-value">🎁 ${totalSpent}</div><div class="stat-label">ดาวที่ถูกแลก</div></div>
      <div class="card stat-card"><div class="stat-value">🧹 ${data.chores.length}</div><div class="stat-label">รายการงานบ้าน</div></div>
    </div>
    <div class="tabs">${tabs.map(([id, label]) =>
      `<button class="tab-btn ${state.parentTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
    </div>
    <div id="tabContent"></div>
  `;

  $('#lockBtn').addEventListener('click', () => { state.parentUnlocked = false; go('home'); toast('ออกจากโหมดผู้ปกครองแล้ว'); });
  app.querySelectorAll('[data-tab]').forEach(b =>
    b.addEventListener('click', () => { state.parentTab = b.dataset.tab; renderParent(); }));

  const c = $('#tabContent');
  if (state.parentTab === 'kids') renderTabKids(c);
  else if (state.parentTab === 'chores') renderTabChores(c);
  else if (state.parentTab === 'rewards') renderTabRewards(c);
  else if (state.parentTab === 'history') renderTabHistory(c);
  else renderTabSettings(c);
}

// ----- PIN -----
function renderPinPad() {
  app.innerHTML = `
    <div class="card pin-box">
      <h2 class="page-title">🔐 ใส่รหัส PIN</h2>
      <p class="page-sub">สำหรับผู้ปกครองเท่านั้น</p>
      <div class="pin-dots">${[0, 1, 2, 3].map(i =>
        `<span class="pin-dot ${i < state.pinInput.length ? 'filled' : ''}"></span>`).join('')}</div>
      <div class="pin-error" id="pinError"></div>
      <div class="pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="pin-key" data-key="${n}">${n}</button>`).join('')}
        <span></span>
        <button class="pin-key" data-key="0">0</button>
        <button class="pin-key" data-key="del">⌫</button>
      </div>
      <p class="pin-hint">PIN เริ่มต้นคือ 1234 (เปลี่ยนได้ในแท็บตั้งค่า)</p>
    </div>
  `;
  app.querySelectorAll('.pin-key').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.key;
    if (key === 'del') state.pinInput = state.pinInput.slice(0, -1);
    else if (state.pinInput.length < 4) state.pinInput += key;

    if (state.pinInput.length === 4) {
      if (state.pinInput === data.pin) {
        state.parentUnlocked = true; state.pinInput = '';
        render(); toast('ยินดีต้อนรับคุณพ่อคุณแม่ 👋');
        return;
      }
      state.pinInput = '';
      renderPinPad();
      $('#pinError').textContent = 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง';
      return;
    }
    renderPinPad();
  }));
}

// ----- Tab: Kids -----
function renderTabKids(c) {
  c.innerHTML = `
    <div class="card manage-list">
      ${data.kids.map(k => `
        <div class="manage-item">
          <span class="manage-ic" style="background:${k.color}">${k.avatar}</span>
          <div class="manage-main">
            <div class="manage-title">${esc(k.name)}</div>
            <div class="manage-sub">คงเหลือ ⭐ ${balance(k.id)} · สัปดาห์นี้ +${earnedThisWeek(k.id)}</div>
          </div>
          <div class="manage-actions">
            <button class="icon-btn" data-edit="${k.id}" title="แก้ไข">✏️</button>
            <button class="icon-btn danger" data-del="${k.id}" title="ลบ">🗑️</button>
          </div>
        </div>`).join('')}
      <div class="add-row"><button class="btn btn-primary" id="addKid">➕ เพิ่มโปรไฟล์เด็ก</button></div>
    </div>
  `;
  $('#addKid').addEventListener('click', () => kidForm());
  c.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => kidForm(b.dataset.edit)));
  c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const k = data.kids.find(x => x.id === b.dataset.del);
    confirmModal(`ลบโปรไฟล์ "<b>${esc(k.name)}</b>"?`, 'ประวัติดาวของเด็กคนนี้จะถูกลบด้วย', () => {
      data.kids = data.kids.filter(x => x.id !== k.id);
      data.log.filter(l => l.kidId === k.id).forEach(l => data.deletedLog.push(l.id));
      data.log = data.log.filter(l => l.kidId !== k.id);
      bumpMeta(); save(); renderParent(); toast('ลบโปรไฟล์แล้ว');
    });
  }));
}

function kidForm(id) {
  const k = id ? data.kids.find(x => x.id === id) : null;
  let avatar = k ? k.avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)];
  let color = k ? k.color : COLORS[Math.floor(Math.random() * COLORS.length)];

  openModal(`
    <h3 class="modal-title">${k ? '✏️ แก้ไขโปรไฟล์' : '➕ เพิ่มโปรไฟล์เด็ก'}</h3>
    <div class="form-group">
      <label class="form-label">ชื่อเด็ก</label>
      <input class="form-input" id="fName" value="${k ? esc(k.name) : ''}" placeholder="เช่น น้องเอ" maxlength="30">
    </div>
    <div class="form-group">
      <label class="form-label">เลือก Avatar</label>
      <div class="picker-grid" id="avatarPick">
        ${AVATARS.map(a => `<button class="picker-item ${a === avatar ? 'selected' : ''}" data-a="${a}">${a}</button>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">สีพื้นหลัง</label>
      <div class="picker-grid" id="colorPick">
        ${COLORS.map(cl => `<button class="picker-item color-item ${cl === color ? 'selected' : ''}" data-c="${cl}" style="background:${cl}"></button>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mCancel">ยกเลิก</button>
      <button class="btn btn-primary" id="mSave">บันทึก</button>
    </div>
  `);
  $('#avatarPick').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    avatar = b.dataset.a;
    $('#avatarPick').querySelectorAll('.picker-item').forEach(x => x.classList.toggle('selected', x === b));
  });
  $('#colorPick').addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    color = b.dataset.c;
    $('#colorPick').querySelectorAll('.picker-item').forEach(x => x.classList.toggle('selected', x === b));
  });
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', () => {
    const name = $('#fName').value.trim();
    if (!name) { toast('กรุณาใส่ชื่อเด็ก'); return; }
    if (k) { k.name = name; k.avatar = avatar; k.color = color; }
    else data.kids.push({ id: uid(), name, avatar, color });
    bumpMeta(); save(); closeModal(); renderParent(); toast(k ? 'แก้ไขแล้ว ✓' : `เพิ่ม "${name}" แล้ว ✓`);
  });
}

// ----- Tab: Chores -----
function renderTabChores(c) {
  c.innerHTML = `
    <div class="card manage-list">
      ${data.chores.map(ch => `
        <div class="manage-item">
          <span class="manage-ic">${ch.icon}</span>
          <div class="manage-main">
            <div class="manage-title">${esc(ch.name)}</div>
            <div class="manage-sub">ค่าจ้าง ${ch.stars} ⭐ ต่อครั้ง</div>
          </div>
          <div class="manage-actions">
            <button class="icon-btn" data-edit="${ch.id}">✏️</button>
            <button class="icon-btn danger" data-del="${ch.id}">🗑️</button>
          </div>
        </div>`).join('')}
      <div class="add-row"><button class="btn btn-primary" id="addChore">➕ เพิ่มงานบ้าน</button></div>
    </div>
  `;
  $('#addChore').addEventListener('click', () => itemForm('chore'));
  c.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => itemForm('chore', b.dataset.edit)));
  c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const ch = data.chores.find(x => x.id === b.dataset.del);
    confirmModal(`ลบงาน "<b>${esc(ch.name)}</b>"?`, 'ประวัติที่บันทึกไปแล้วจะยังอยู่', () => {
      data.chores = data.chores.filter(x => x.id !== ch.id);
      bumpMeta(); save(); renderParent(); toast('ลบแล้ว');
    });
  }));
}

// ----- Tab: Rewards -----
function renderTabRewards(c) {
  c.innerHTML = `
    <div class="card manage-list">
      ${data.rewards.map(r => `
        <div class="manage-item">
          <span class="manage-ic">${r.icon}</span>
          <div class="manage-main">
            <div class="manage-title">${esc(r.name)}</div>
            <div class="manage-sub">ราคา ${r.price} ⭐</div>
          </div>
          <div class="manage-actions">
            <button class="icon-btn" data-edit="${r.id}">✏️</button>
            <button class="icon-btn danger" data-del="${r.id}">🗑️</button>
          </div>
        </div>`).join('')}
      <div class="add-row"><button class="btn btn-primary" id="addReward">➕ เพิ่มของรางวัล</button></div>
    </div>
  `;
  $('#addReward').addEventListener('click', () => itemForm('reward'));
  c.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => itemForm('reward', b.dataset.edit)));
  c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const r = data.rewards.find(x => x.id === b.dataset.del);
    confirmModal(`ลบของรางวัล "<b>${esc(r.name)}</b>"?`, '', () => {
      data.rewards = data.rewards.filter(x => x.id !== r.id);
      bumpMeta(); save(); renderParent(); toast('ลบแล้ว');
    });
  }));
}

// Shared form for chore / reward
function itemForm(kind, id) {
  const isChore = kind === 'chore';
  const list = isChore ? data.chores : data.rewards;
  const item = id ? list.find(x => x.id === id) : null;
  const icons = isChore ? CHORE_ICONS : REWARD_ICONS;
  let icon = item ? item.icon : icons[0];
  const starVal = item ? (isChore ? item.stars : item.price) : (isChore ? 1 : 5);

  openModal(`
    <h3 class="modal-title">${item ? '✏️ แก้ไข' : '➕ เพิ่ม'}${isChore ? 'งานบ้าน' : 'ของรางวัล'}</h3>
    <div class="form-group">
      <label class="form-label">ชื่อ${isChore ? 'งาน' : 'ของรางวัล'}</label>
      <input class="form-input" id="fName" value="${item ? esc(item.name) : ''}" placeholder="${isChore ? 'เช่น ล้างจาน' : 'เช่น ไอศกรีม'}" maxlength="40">
    </div>
    <div class="form-group">
      <label class="form-label">${isChore ? 'ค่าจ้าง (ดาวต่อครั้ง)' : 'ราคา (ดาว)'}</label>
      <input class="form-input" id="fStars" type="number" min="1" max="999" value="${starVal}">
    </div>
    <div class="form-group">
      <label class="form-label">เลือกไอคอน</label>
      <div class="picker-grid" id="iconPick">
        ${icons.map(i => `<button class="picker-item ${i === icon ? 'selected' : ''}" data-i="${i}">${i}</button>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mCancel">ยกเลิก</button>
      <button class="btn btn-primary" id="mSave">บันทึก</button>
    </div>
  `);
  $('#iconPick').addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    icon = b.dataset.i;
    $('#iconPick').querySelectorAll('.picker-item').forEach(x => x.classList.toggle('selected', x === b));
  });
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', () => {
    const name = $('#fName').value.trim();
    const stars = Math.max(1, Math.min(999, parseInt($('#fStars').value, 10) || 1));
    if (!name) { toast('กรุณาใส่ชื่อ'); return; }
    if (item) {
      item.name = name; item.icon = icon;
      if (isChore) item.stars = stars; else item.price = stars;
    } else if (isChore) {
      data.chores.push({ id: uid(), name, icon, stars });
    } else {
      data.rewards.push({ id: uid(), name, icon, price: stars });
    }
    bumpMeta(); save(); closeModal(); renderParent(); toast('บันทึกแล้ว ✓');
  });
}

// ----- Tab: History -----
function renderTabHistory(c) {
  const rows = data.log.slice().sort((a, b) => b.ts - a.ts).slice(0, 100);
  c.innerHTML = `
    <div class="card history-list">
      ${rows.length ? rows.map(l => `
        <div class="history-item">
          <span class="history-ic ${l.type}">${l.icon || '⭐'}</span>
          <div class="history-main">
            <div class="history-title">${esc(l.name)}</div>
            <div class="history-meta">${esc((data.kids.find(k => k.id === l.kidId) || {}).name || 'ไม่ทราบชื่อ')} · ${fmtDate(l.ts)}</div>
          </div>
          <span class="history-stars ${l.type}">${l.type === 'earn' ? '+' : '−'}${l.stars} ⭐</span>
          <button class="icon-btn danger" data-dellog="${l.id}" title="ลบรายการ">✕</button>
        </div>`).join('')
      : `<div class="empty"><span class="empty-icon">📖</span>ยังไม่มีประวัติ</div>`}
    </div>
  `;
  c.querySelectorAll('[data-dellog]').forEach(b => b.addEventListener('click', () => {
    confirmModal('ลบรายการนี้?', 'ดาวจะถูกคืน/หักตามรายการที่ลบ', () => {
      data.deletedLog.push(b.dataset.dellog);
      data.log = data.log.filter(l => l.id !== b.dataset.dellog);
      save(); renderParent(); toast('ลบรายการแล้ว');
    });
  }));
}

// ----- Tab: Settings -----
function renderTabSettings(c) {
  const syncSection = syncCode ? `
      <label class="form-label">🔗 Sync ข้ามเครื่อง — เปิดอยู่</label>
      <div class="sync-code-box">
        <span class="sync-code" id="syncCodeText">${esc(syncCode)}</span>
        <button class="btn btn-ghost btn-sm" id="syncCopy">📋 คัดลอก</button>
      </div>
      <p class="pin-hint" style="text-align:left;margin-top:8px">
        นำรหัสครอบครัวนี้ไปใส่ในเครื่องอื่น (iPad / iPhone / คอมพิวเตอร์) ที่เมนูเดียวกันนี้
        ข้อมูลจะ sync อัตโนมัติทุก 30 วินาทีและทุกครั้งที่มีการแก้ไข</p>
      <p class="pin-hint" style="text-align:left" id="syncStatusLine">${syncStatusText()}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn-ghost btn-sm" id="syncNowBtn">🔄 Sync เดี๋ยวนี้</button>
        <button class="btn btn-danger btn-sm" id="syncOff">ปิดการ sync เครื่องนี้</button>
      </div>` : `
      <label class="form-label">🔗 Sync ข้ามเครื่อง</label>
      <p class="pin-hint" style="text-align:left;margin-top:0">
        เชื่อมข้อมูลระหว่าง iPad / iPhone / คอมพิวเตอร์ ด้วย "รหัสครอบครัว" —
        สร้างรหัสบนเครื่องแรก แล้วนำรหัสไปใส่บนเครื่องอื่น</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-primary btn-sm" id="syncCreate">✨ สร้างรหัสครอบครัวใหม่</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <input class="form-input" id="syncJoinCode" placeholder="ใส่รหัสจากเครื่องแรก เช่น ab12-cd34-ef56" style="flex:1;min-width:200px">
        <button class="btn btn-ghost" id="syncJoin">เชื่อมต่อ</button>
      </div>`;

  c.innerHTML = `
    <div class="card" style="padding:22px">
      <div class="form-group">
        <label class="form-label">เป้าหมายดาวต่อสัปดาห์ (ต่อคน)</label>
        <input class="form-input" id="sGoal" type="number" min="1" max="999" value="${data.weeklyGoal || 20}">
      </div>
      <div class="form-group">
        <label class="form-label">เปลี่ยนรหัส PIN (ตัวเลข 4 หลัก)</label>
        <input class="form-input" id="sPin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="เว้นว่างถ้าไม่เปลี่ยน">
      </div>
      <button class="btn btn-primary" id="sSave">บันทึกการตั้งค่า</button>
      <hr style="border:none;border-top:1px solid var(--line);margin:22px 0">
      ${syncSection}
      <hr style="border:none;border-top:1px solid var(--line);margin:22px 0">
      <label class="form-label">สำรอง / ย้ายข้อมูล</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="sExport">⬇️ Export ข้อมูล</button>
        <button class="btn btn-ghost btn-sm" id="sImport">⬆️ Import ข้อมูล</button>
        <button class="btn btn-danger btn-sm" id="sReset">🗑️ ล้างข้อมูลทั้งหมด</button>
      </div>
      <p class="pin-hint" style="text-align:left">Export/Import ใช้สำรองข้อมูลเป็นไฟล์ JSON</p>
      <input type="file" id="sFile" accept=".json" style="display:none">
    </div>
  `;

  if (syncCode) {
    $('#syncCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(syncCode); toast('คัดลอกรหัสแล้ว ✓'); }
      catch { toast('คัดลอกไม่สำเร็จ — จดรหัสด้วยตนเอง'); }
    });
    $('#syncNowBtn').addEventListener('click', () => { syncNow(); toast('กำลัง sync...'); });
    $('#syncOff').addEventListener('click', () => {
      confirmModal('ปิดการ sync เครื่องนี้?', 'ข้อมูลบนเครื่องนี้ยังอยู่ แต่จะไม่รับ-ส่งกับเครื่องอื่นอีก', () => {
        syncCode = ''; localStorage.removeItem(SYNC_KEY);
        syncState = { status: 'off', last: 0 };
        renderParent(); toast('ปิดการ sync แล้ว');
      });
    });
  } else {
    $('#syncCreate').addEventListener('click', async () => {
      const code = genCode();
      syncCode = code; localStorage.setItem(SYNC_KEY, code);
      bumpMeta(); localStorage.setItem(STORE_KEY, JSON.stringify(data));
      await syncNow();
      renderParent();
      toast(syncState.status === 'error' ? 'สร้างรหัสแล้ว แต่ยัง sync ไม่สำเร็จ' : 'เปิด sync แล้ว ✓ นำรหัสไปใส่เครื่องอื่นได้เลย');
    });
    $('#syncJoin').addEventListener('click', async () => {
      const code = $('#syncJoinCode').value.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{4,38}[a-z0-9]$/.test(code)) { toast('รูปแบบรหัสไม่ถูกต้อง'); return; }
      toast('กำลังเชื่อมต่อ...');
      try {
        const remote = await apiGet(code);
        if (!remote) { toast('ไม่พบรหัสนี้ — ตรวจสอบรหัสจากเครื่องแรกอีกครั้ง'); return; }
        syncCode = code; localStorage.setItem(SYNC_KEY, code);
        await syncNow();
        renderParent(); toast('เชื่อมต่อสำเร็จ ✓ ข้อมูล sync แล้ว');
      } catch { toast('เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง'); }
    });
  }
  $('#sSave').addEventListener('click', () => {
    const goal = parseInt($('#sGoal').value, 10);
    if (goal >= 1) data.weeklyGoal = Math.min(999, goal);
    const pin = $('#sPin').value.trim();
    if (pin) {
      if (!/^\d{4}$/.test(pin)) { toast('PIN ต้องเป็นตัวเลข 4 หลัก'); return; }
      data.pin = pin;
    }
    bumpMeta(); save(); renderParent(); toast('บันทึกการตั้งค่าแล้ว ✓');
  });
  $('#sExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `goodkids-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('ดาวน์โหลดไฟล์สำรองแล้ว');
  });
  $('#sImport').addEventListener('click', () => $('#sFile').click());
  $('#sFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d.kids || !d.chores || !d.rewards || !Array.isArray(d.log)) throw new Error('bad');
        data = migrate(d); bumpMeta(); save(); renderParent(); toast('นำเข้าข้อมูลสำเร็จ ✓');
      } catch { toast('ไฟล์ไม่ถูกต้อง'); }
    };
    reader.readAsText(file);
  });
  $('#sReset').addEventListener('click', () => {
    confirmModal('ล้างข้อมูลทั้งหมด?', 'โปรไฟล์ งานบ้าน ของรางวัล และประวัติทั้งหมดจะหายไป <b>กู้คืนไม่ได้</b>' + (syncCode ? '<br>การ sync ของเครื่องนี้จะถูกปิดด้วย' : ''), () => {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(SYNC_KEY);
      syncCode = ''; syncState = { status: 'off', last: 0 };
      data = load();
      state.parentUnlocked = false;
      go('home'); toast('ล้างข้อมูลแล้ว — เริ่มต้นใหม่');
    });
  });
}

// ----- Confirm modal -----
function confirmModal(title, sub, onOk) {
  openModal(`
    <span class="confirm-icon">⚠️</span>
    <p class="confirm-text">${title}</p>
    ${sub ? `<p class="confirm-text" style="margin-top:6px;font-size:.88rem">${sub}</p>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" id="mCancel">ยกเลิก</button>
      <button class="btn btn-danger" id="mOk">ยืนยัน</button>
    </div>`);
  $('#mCancel').addEventListener('click', closeModal);
  $('#mOk').addEventListener('click', () => { closeModal(); onOk(); });
}

// ---------- Boot ----------
render();
syncNow();
