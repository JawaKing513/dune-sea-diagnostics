/**
 * Dune Sea Diagnostics — Simple static site + local scheduler
 * - No backend required: all data stored in localStorage
 * - Supports "pending" appointment requests and "admin" accept/reject
 * - Supports availability blocks (admin)
 *
 * IMPORTANT:
 *  - Change ADMIN_PIN below.
 *  - Hosting: works as a static site (GitHub Pages, Netlify, etc.)
 */

const ADMIN_PIN = "dunesea"; // <-- CHANGE THIS

// -------------------- Server-backed schedule --------------------
// The schedule (pending + booked) is authoritative on the server.
// Client loads it on startup and uses it to render the calendar.
// If the server can't be reached, we show every slot as unavailable.

const SERVER_HTTP_PORT = 8787;

function getServerBase(){
  // Override options:
  //  1) URL param:   ?server=https://your-server.com
  //  2) localStorage: dune_server_base
  //
  // Defaults:
  //  - Local dev:  http(s)://localhost:8787
  //  - Production: if the site is served from the same origin as the API, we use relative /api/...
  //               otherwise we fall back to your Render API host.
  const LS_KEY = "dune_server_base";
  const DEFAULT_PROD_API_BASE = "https://dune-sea-diagnostics.onrender.com";

  let override = "";
  try{
    const qs = (typeof location !== "undefined" && location.search) ? new URLSearchParams(location.search) : null;
    override = (qs && qs.get("server")) ? String(qs.get("server")).trim() : "";
  }catch(_){ override = ""; }

  if(!override){
    try{ override = String(localStorage.getItem(LS_KEY) || "").trim(); }catch(_){ override = ""; }
  }

  if(override){
    // Normalize: remove trailing slashes
    return override.replace(/\/+$/,'');
  }

  const host = (typeof location !== "undefined" && location.hostname != null) ? String(location.hostname) : "";
  // location.protocol is "http:" or "https:" (note the colon)
  const proto = (typeof location !== "undefined" && location.protocol && String(location.protocol).startsWith("http"))
    ? String(location.protocol)
    : "http:";

  if(!host){
    // file:// or unknown host: default to production API
    return DEFAULT_PROD_API_BASE;
  }

  const isLocalHost = (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local"));
  if(isLocalHost){
    return `${proto}//${host}:${SERVER_HTTP_PORT}`;
  }

  // Use same-origin routes ONLY when the site is actually served from the same origin as the API.
  // (If the site is hosted elsewhere, relative /api/* will hit the wrong host.)
  try{
    if (typeof location !== "undefined" && location.origin === DEFAULT_PROD_API_BASE) {
      return "";
    }
  }catch(_){ /* ignore */ }

  // Otherwise (e.g., site hosted elsewhere), use your Render API host.
  return DEFAULT_PROD_API_BASE;
}

const serverSchedule = {
  online: false,
  booked: [],
  pending: []
};

// Server-backed availability (weekly template + specific blocked slots)
const serverAvailability = {
  online: false,
  weekly: {},
  blocks: {}
};

// Server-backed inventory
const serverInventory = {
  online: false,
  items: []
};

// Server-backed gallery
const serverGallery = {
  online: false,
  photos: []
};

async function fetchJson(url, opts){
  const res = await fetch(url, opts);
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json().catch(()=>null) : null;
  if(!res.ok){
    const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}


async function applyInventoryVisibility(){
  // Hide Inventory links if there is nothing publicly "in stock".
  // "In stock" for this site = any inventory item with status === "available".
  try{
    const base = getServerBase();
    const j = await fetchJson(`${base}/api/inventory`, { method:"GET" });
    const items = Array.isArray(j?.items) ? j.items : [];
    const hasInStock = items.some(it => String(it?.status || "").toLowerCase() === "available");

    // Nav/menu link(s)
    const navInv = document.querySelectorAll('.nav-links a[href="inventory.html"]');
    navInv.forEach(a => { a.style.display = hasInStock ? "inline-flex" : "none"; });

    // Home "Browse Inventory" button (or any primary CTA button)
    const homeBtn = document.querySelector('a.btn[href="inventory.html"]');
    if(homeBtn){
      if(hasInStock){
        homeBtn.style.visibility = "visible";
        homeBtn.textContent = "Browse Inventory";
        homeBtn.setAttribute("href", "inventory.html");
        homeBtn.removeAttribute("aria-disabled");
        homeBtn.classList.remove("disabled");
      }else{
        homeBtn.style.visibility = "visible";
        homeBtn.textContent = "Inventory: None In Stock";
        homeBtn.setAttribute("href", "contact.html");
        homeBtn.setAttribute("aria-disabled", "true");
        homeBtn.classList.add("disabled");
      }
    }

    // If user directly opens inventory.html while empty, show a friendly notice
    const wrap = document.getElementById("inventoryWrap");
    if(wrap && !hasInStock){
      let note = document.getElementById("invEmptyNote");
      if(!note){
        note = document.createElement("div");
        note.id = "invEmptyNote";
        note.className = "card";
        note.style.marginBottom = "14px";
        note.innerHTML = `
          <div class="card-inner">
            <h2 style="margin:0 0 6px 0">No Inventory In Stock</h2>
            <p style="margin:0">We don’t have any items available right now. Check back soon or reach out through the Contact page.</p>
          </div>
        `;
        wrap.prepend(note);
      }
    }else{
      const note = document.getElementById("invEmptyNote");
      if(note) note.remove();
    }
  }catch(_){
    // If we can't reach the server, don't hide anything (avoids false negatives).
  }
}
async function loadServerSchedule(){
  try{
    const url = `${getServerBase()}/api/schedule`;
    const j = await fetchJson(url, { method:"GET" });
    serverSchedule.booked = Array.isArray(j.booked) ? j.booked : [];
    serverSchedule.pending = Array.isArray(j.pending) ? j.pending : [];
    serverSchedule.online = true;

    console.log(`[schedule] server online. booked=${serverSchedule.booked.length} pending=${serverSchedule.pending.length}`);
    try{
      console.table([
        ...serverSchedule.booked.map(a => ({ status:"booked", startISO:a.startISO, id:a.id, name:a.name })),
        ...serverSchedule.pending.map(a => ({ status:"pending", startISO:a.startISO, id:a.id, name:a.name })),
      ].sort((a,b)=>String(a.startISO).localeCompare(String(b.startISO))));
    }catch(_){}
  }catch(err){
    serverSchedule.online = false;
    serverSchedule.booked = [];
    serverSchedule.pending = [];
    console.warn("[schedule] server offline/unreachable:", err);
  }
  return serverSchedule.online;
}

async function loadServerAvailability(){
  try{
    const url = `${getServerBase()}/api/availability`;
    const j = await fetchJson(url, { method:"GET" });
    const a = j && j.availability ? j.availability : j;
    serverAvailability.weekly = (a && typeof a.weekly === "object" && a.weekly) ? a.weekly : {};
    serverAvailability.blocks = (a && typeof a.blocks === "object" && a.blocks) ? a.blocks : {};
    serverAvailability.online = true;
    console.log(`[availability] server online. blockedDays=${Object.keys(serverAvailability.blocks||{}).length}`);
  }catch(err){
    serverAvailability.online = false;
    serverAvailability.weekly = {};
    serverAvailability.blocks = {};
    console.warn("[availability] server offline/unreachable:", err);
  }
  return serverAvailability.online;
}

async function loadServerInventory(){
  try{
    const url = `${getServerBase()}/api/inventory`;
    const j = await fetchJson(url, { method:"GET" });
    serverInventory.items = Array.isArray(j.items) ? j.items : [];
    serverInventory.online = true;
    console.log(`[inventory] server online. items=${serverInventory.items.length}`);
  }catch(err){
    serverInventory.online = false;
    serverInventory.items = [];
    console.warn("[inventory] server offline/unreachable:", err);
  }
  return serverInventory.online;
}

async function loadServerGallery(){
  try{
    const url = `${getServerBase()}/api/gallery`;
    const j = await fetchJson(url, { method:"GET" });
    serverGallery.photos = Array.isArray(j.photos) ? j.photos : [];
    serverGallery.online = true;
    console.log(`[gallery] server online. photos=${serverGallery.photos.length}`);
  }catch(err){
    serverGallery.online = false;
    serverGallery.photos = [];
    console.warn("[gallery] server offline/unreachable:", err);
  }
  return serverGallery.online;
}

async function postGallery(path, payload){
  const url = `${getServerBase()}${path}`;
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
}

async function postInventory(path, payload){
  const url = `${getServerBase()}${path}`;
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
}

async function postAvailability(path, payload){
  const url = `${getServerBase()}${path}`;
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
}

function serverOnline(){
  return !!(serverSchedule.online && serverAvailability.online);
}

function getAllScheduleRows(){
  // Normalized for existing UI (status: pending/accepted)
  const booked = serverSchedule.booked.map(a => ({ ...a, status:"accepted" }));
  const pending = serverSchedule.pending.map(a => ({ ...a, status:"pending" }));
  return [...pending, ...booked];
}

async function postSchedule(path, payload){
  const url = `${getServerBase()}${path}`;
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
}

// -------------------------------------------------------------------


const STORAGE_KEY = "dsd_site_v1";
const ADMIN_MODE_KEY = "dsd_admin_mode_v1";

function getPersistedAdmin(){
  try{ return localStorage.getItem(ADMIN_MODE_KEY) === "1"; }
  catch(e){ return false; }
}
function setPersistedAdmin(v){
  try{
    if(v) localStorage.setItem(ADMIN_MODE_KEY, "1");
    else localStorage.removeItem(ADMIN_MODE_KEY);
  }catch(e){}
}


const DEFAULT_STATE = {
  business: {
    name: "Dune Sea Diagnostics",
    phone: "(913) 213-1439",
    email: "service@duneseadiagnostics.com",
    area: "Kansas City Metro",
    addressLine: "Kansas City, MO",
  },
  settings: {
    slotMinutes: 120,
    openHour: 8,
    closeHour: 18,
    daysShown: 7, // week view
    leadDays: 1, // earliest booking is tomorrow
    appointmentDurationSlots: 1, // 2 slots of slotMinutes each
  },
  availability: {
    // weekly template (0=Sun..6=Sat) - true means generally available
    weekly: {
      0: { enabled:false, start:8, end:18 },
      1: { enabled:true,  start:8, end:18 },
      2: { enabled:true,  start:8, end:18 },
      3: { enabled:true,  start:8, end:18 },
      4: { enabled:true,  start:8, end:18 },
      5: { enabled:true,  start:8, end:18 },
      6: { enabled:false, start:8, end:18 },
    },
    // specific blocks: {dateISO: ["09:00","10:00"]} etc
    blocks: {}
  },
  inventory: [],
  appointments: [] // {id, startISO, slots, name, phone, email, serviceType, appliance, notes, status: pending|accepted|rejected, createdISO}
};

function uid(){
  return Math.random().toString(16).slice(2)+Date.now().toString(16);
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){
      const s = structuredClone(DEFAULT_STATE);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return s;
    }
    const parsed = JSON.parse(raw);
    // Lightweight merge for new fields
    const merged = deepMerge(structuredClone(DEFAULT_STATE), parsed);
    // Migration: business contact info is code-owned (not user-editable).
    // If a prior version persisted different values in localStorage, force it back.
    merged.business = structuredClone(DEFAULT_STATE.business);
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); }catch(e){}
    return merged;
  }catch(e){
    console.warn("State load failed; resetting.", e);
    const s = structuredClone(DEFAULT_STATE);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return s;
  }
}

function saveState(s){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function deepMerge(a,b){
  if(typeof a !== "object" || a===null) return b;
  if(typeof b !== "object" || b===null) return a;
  for(const k of Object.keys(b)){
    if(Array.isArray(b[k])) a[k] = b[k];
    else if(typeof b[k] === "object" && b[k] !== null){
      a[k] = deepMerge(a[k] ?? {}, b[k]);
    }else{
      a[k] = b[k];
    }
  }
  return a;
}

function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

function setText(sel, val){ const el = $(sel); if(el) el.textContent = val; }
function setHref(sel, val){ const el = $(sel); if(el) el.href = val; }
function setDisplay(sel, val){ const el = $(sel); if(el) el.style.display = val; }

function toast(msg){
  const t = $("#toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove("show"), 2800);
}

function fmtDate(d){
  const opts = { weekday:"short", month:"short", day:"numeric" };
  return d.toLocaleDateString(undefined, opts);
}
function fmtTime(h,m){
  const d = new Date();
  d.setHours(h,m,0,0);
  return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}
function toISODate(d){
  const z = new Date(d);
  z.setHours(0,0,0,0);
  return z.toISOString().slice(0,10);
}
function parseISODate(s){
  const [y,m,d]=s.split("-").map(Number);
  return new Date(y, m-1, d);
}
function addDays(d,n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

let state = loadState();
let isAdmin = false;
let viewStart = startOfWeek(new Date());

function startOfWeek(d){
  const x = new Date(d);
  const day = x.getDay(); // 0..6
  x.setDate(x.getDate() - day);
  x.setHours(0,0,0,0);
  return x;
}

async function init(){
  // Load authoritative schedule from server
  await loadServerSchedule();
  await applyInventoryVisibility();
  // Availability is also authoritative on the server
  if(serverSchedule.online){
    await loadServerAvailability();
    // Cache the latest server availability into local state so admin UI
    // can render the current config even if the user refreshes.
    if(serverAvailability.online){
      state.availability.weekly = structuredClone(serverAvailability.weekly);
      state.availability.blocks = structuredClone(serverAvailability.blocks);
      saveState(state);
    }
  }

  // Inventory is server-backed
  await loadServerInventory();

  // Gallery is server-backed
  await loadServerGallery();

  // Fill business info
  setText("#bizName", state.business.name);
  setText("#bizName2", state.business.name);
  setText("#bizArea", state.business.area);
  setText("#bizArea2", state.business.area);
  setText("#bizPhone", state.business.phone);
  setText("#bizPhone2", state.business.phone);
  setText("#bizEmail", state.business.email);
  setText("#bizAddress", state.business.addressLine);

  // Links
  setHref("#phoneLink", `tel:${state.business.phone.replace(/[^\d+]/g,"") || ""}`);
  setHref("#phoneLink2", `tel:${state.business.phone.replace(/[^\d+]/g,"") || ""}`);
  setHref("#emailLink", `mailto:${state.business.email}`);

  // Admin
  const adminBtn = $("#adminBtn");
  if(adminBtn) adminBtn.addEventListener("click", ()=>openAdmin());
  const adminLogoutBtn = $("#adminLogoutBtn");
  if(adminLogoutBtn) adminLogoutBtn.addEventListener("click", ()=>setAdmin(false));

  // Hotkey: Ctrl+Shift+A toggles admin mode (opens PIN when OFF; turns OFF when ON)
  if(!window.__dsdAdminHotkeyBound){
    window.__dsdAdminHotkeyBound = true;
    document.addEventListener("keydown", (e)=>{
      if(e.ctrlKey && e.shiftKey && (e.key === "A" || e.key === "a")){
        const t = e.target;
        const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
        const isTyping = tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable);
        if(isTyping) return;
        e.preventDefault();
        if(isAdmin){ setAdmin(false); toast("Management mode disabled."); }
        else{ openAdmin(); }
      }
    });
  }


  // Inventory render
  if($("#inventoryWrap")) renderInventory();
  if($("#invAdminBtn") || $("#inventoryAdminPanel")) wireInventoryAdmin();

  // Gallery render
  if($("#jobsGallery")) renderGallery();
  if($("#galleryAdminPanel")) wireGalleryAdmin();

  // Contact page
  if($("#contactFormNew")) wireContactForm();

  // Calendar
  const calPrev = $("#calPrev");
  if(calPrev) calPrev.addEventListener("click", ()=>{ viewStart = addDays(viewStart, -7); renderCalendar(); });
  const calNext = $("#calNext");
  if(calNext) calNext.addEventListener("click", ()=>{ viewStart = addDays(viewStart, 7); renderCalendar(); });
  const calToday = $("#calToday");
  if(calToday) calToday.addEventListener("click", ()=>{ viewStart = startOfWeek(new Date()); renderCalendar(); });

  // Request modal
  const modalClose = $("#modalClose");
  if(modalClose) modalClose.addEventListener("click", closeModal);
  const modalBackdrop = $("#modalBackdrop");
  if(modalBackdrop) modalBackdrop.addEventListener("click", (e)=>{ if(e.target.id==="modalBackdrop") closeModal(); });

  const requestForm = $("#requestForm");
  if(requestForm) requestForm.addEventListener("submit", onSubmitRequest);

  // Admin panels
  const adminPinForm = $("#adminPinForm");
  if(adminPinForm) adminPinForm.addEventListener("submit", (e)=>{
    e.preventDefault();
    const pin = $("#adminPin").value.trim();
    if(pin === ADMIN_PIN){
      setAdmin(true);
      closeModal();
      toast("Management mode enabled.");
    }else{
      toast("Wrong PIN.");
    }
  });

  const availabilityForm = $("#availabilityForm");
  if(availabilityForm) availabilityForm.addEventListener("submit", onSaveAvailability);
  const blockDateBtn = $("#blockDateBtn");
  if(blockDateBtn) blockDateBtn.addEventListener("click", onBlockDate);

  const resetBtn = $("#resetBtn");
  if(resetBtn) resetBtn.addEventListener("click", async ()=>{
    if(confirm("Reset ALL local data on this browser? (Inventory/availability/appointments)")){
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      isAdmin = false;
      viewStart = startOfWeek(new Date());
      await init();
      toast("Local data reset.");
    }
  });

    // Persist admin mode across pages (schedule/inventory) using localStorage
  if(getPersistedAdmin()) setAdmin(true);
if($("#calGrid")) renderCalendar();
  if($("#adminPanel")) renderAdminPanels();
  if($("#pendingTableBody") || $("#acceptedTableBody")) renderAppointmentsTables();
}

function renderInventory(){
  const wrap = $("#inventoryWrap");
  wrap.innerHTML = "";
  if(!serverInventory.online){
    wrap.innerHTML = `<div class="card panel"><div style="font-weight:800">Inventory offline</div><div class="small">Can't load inventory because the server is unreachable.</div></div>`;
    return;
  }
  const items = Array.isArray(serverInventory.items) ? serverInventory.items : [];
  if(items.length === 0){
    wrap.innerHTML = `<div class="card panel"><div style="font-weight:800">No inventory yet</div><div class="small">Check back soon.</div></div>`;
    return;
  }
  for(const it of items){
    const div = document.createElement("div");
    div.className = "card item";
    div.innerHTML = `
      <img src="${escapeHtml(getServerBase() + (it.imagePath || '/uploads/default.png'))}" alt="Inventory item photo">
      <div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <h3>${escapeHtml(it.title)}</h3>
          <span class="pill ${it.status==='available' ? 'avail' : 'unavail'}">${it.status==='available' ? 'Available' : 'Unavailable'}</span>
        </div>
        <p>
          ${it.model ? `<strong>Model:</strong> ${escapeHtml(it.model)} • ` : ``}
          ${it.buyPrice != null ? `<strong>Buy:</strong> $${Number(it.buyPrice).toFixed(0)} ` : ``}
          ${it.rentPrice != null ? `${it.buyPrice != null ? `• ` : ``}<strong>Rent:</strong> $${Number(it.rentPrice).toFixed(0)}/mo` : ``}
          ${it.buyPrice == null && it.rentPrice == null ? `<span class="small">No pricing set</span>` : ``}
        </p>
        <p>${escapeHtml(it.note || "")}</p>
      </div>
    `;
    wrap.appendChild(div);
  }
}

function renderGallery(){
  const g = $("#jobsGallery");
  g.innerHTML = "";

  if(!serverGallery.online){
    g.innerHTML = `<div class="card panel"><div style="font-weight:800">Gallery offline</div><div class="small">Can't load photos because the server is unreachable.</div></div>`;
    return;
  }

  const photos = Array.isArray(serverGallery.photos) ? serverGallery.photos : [];
  if(photos.length === 0){
    g.innerHTML = `<div class="card panel"><div style="font-weight:800">No photos yet</div><div class="small">Add some from management mode (Ctrl+Shift+A).</div></div>`;
    return;
  }

  for(const p of photos){
    const wrap = document.createElement("div");
    wrap.className = "gallery-item";
    const src = getServerBase() + (p.imagePath || "/uploads/default.png");
    wrap.innerHTML = `
      <img src="${escapeHtml(src)}" alt="Gallery photo">
      ${p.caption ? `<div class="gallery-cap">${escapeHtml(p.caption)}</div>` : ``}
      ${isAdmin ? `<button class="gallery-del" data-id="${escapeHtml(p.id)}" title="Delete">✕</button>` : ``}
    `;
    g.appendChild(wrap);
  }

  if(isAdmin){
    g.querySelectorAll(".gallery-del").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const id = btn.getAttribute("data-id");
        if(!id) return;
        if(!confirm("Delete this photo?")) return;
        try{
          await postGallery("/api/gallery/delete", { id });
          await loadServerGallery();
          renderGallery();
          toast("Photo deleted.");
        }catch(err){
          toast(String(err?.message || err || "Delete failed"));
        }
      });
    });
  }
}

function renderCalendar(){
  $("#calRange").textContent = `${fmtDate(viewStart)} → ${fmtDate(addDays(viewStart, 6))}`;

  const slotMin = state.settings.slotMinutes;
  const rows = [];
  const heads = [];

  // Header row
  const d0 = new Date(viewStart);
  heads.push(`<div class="cal-head"></div>`);
  for(let i=0;i<7;i++){
    const d = addDays(d0, i);
    const iso = toISODate(d);
    const label = `${d.toLocaleDateString(undefined,{weekday:"short"})} ${d.getMonth()+1}/${d.getDate()}`;
    heads.push(`<div class="cal-head" data-date="${iso}">${label}</div>`);
  }

  // Time rows
  const open = state.settings.openHour;
  const close = state.settings.closeHour;

  const startDay = new Date(viewStart);
  startDay.setHours(0,0,0,0);

  const numSlots = Math.ceil(((close - open) * 60) / slotMin);
  const now = new Date();

  for(let s=0;s<numSlots;s++){
    const minutesFromOpen = s*slotMin;
    const hh = open + Math.floor(minutesFromOpen/60);
    const mm = minutesFromOpen%60;

    rows.push(`<div class="cal-time">${fmtTime(hh,mm)}</div>`);

    for(let i=0;i<7;i++){
      const day = addDays(startDay, i);
      const dayISO = toISODate(day);
      const start = new Date(day);
      start.setHours(hh, mm, 0, 0);

      const online = serverOnline();
      const appt = online ? findAppointmentByStart(start.toISOString()) : null;
      const dow = day.getDay();
      const weeklyConf = (online ? (serverAvailability.weekly?.[String(dow)] ?? serverAvailability.weekly?.[dow]) : null);
      const weeklyEnabled = !!weeklyConf?.enabled;
      const wStart = Number(weeklyConf?.start ?? state.availability.weekly?.[String(dow)]?.start ?? state.settings.openHour);
      const wEnd = Number(weeklyConf?.end ?? state.availability.weekly?.[String(dow)]?.end ?? state.settings.closeHour);
      const withinWeekly = (weeklyEnabled && hh >= wStart && hh < wEnd);
      const blocked = online ? isBlockedServer(dayISO, hh, mm) : false;

      let cls = "slot";
      let text = "Available";
      let btn = "";

      if(!online){
        cls += " unavail";
        text = "Temporarily Unavailable";
      }else if(appt){
        if(appt.status === "pending"){
          cls += " pending";
          text = "Awaiting Confirmation";
        }else if(appt.status === "accepted"){
          cls += " taken";
          text = "Reserved";
        }
      }else if(blocked){
        cls += " blocked";
        text = (isAdmin ? "Blocked" : "Unavailable");
      }else if(!withinWeekly){
        cls += " unavail";
        text = "Unavailable";
      }
const data = `data-start="${start.toISOString()}" data-date="${dayISO}" data-h="${hh}" data-m="${mm}"`;
      if(online && text==="Available"){
        if(isAdmin) btn = `<button class="sbtn" ${data} data-action="book">Book</button>`;
        else btn = `<button class="sbtn" ${data} data-action="request">Request</button>`;
      }else if(online && isAdmin && !appt){
        // Admin convenience: allow toggling blocks directly from the grid
        if(blocked) btn = `<button class="sbtn" ${data} data-action="unblock">Unblock</button>`;
        else btn = `<button class="sbtn" ${data} data-action="block">Block</button>`;
      }else{
        btn = "";
      }
rows.push(`<div class="${cls}" ${data}><span>${text}</span>${btn}</div>`);
    }
  }

  const grid = $("#calGrid");
  if(!grid) return;
  grid.innerHTML = heads.join("") + rows.join("");

  // Bind buttons
  $all(".sbtn").forEach(b=>{
    b.addEventListener("click", ()=>{
      const startISO = b.getAttribute("data-start");
      const action = b.getAttribute("data-action") || "request";
      if(action === "request" || action === "book"){
        openRequestModal(startISO);
      }else if(action === "block"){
        if(!isAdmin) return;
        blockSlotServer(startISO, true);
      }else if(action === "unblock"){
        if(!isAdmin) return;
        blockSlotServer(startISO, false);
      }
    });
  });
}

function startOfDay(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function isBlockedServer(dateISO, hh, mm){
  const key = dateISO;
  const t = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
  const blocks = serverAvailability.blocks || {};
  return (blocks[key] ?? []).includes(t);
}

function blockSlotServer(startISO, shouldBlock){
  if(!serverOnline()){
    toast("Server offline.");
    return;
  }

  const d = new Date(startISO);
  const dateISO = toISODate(d);
  const t = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

  // Start from current server availability, then mutate, then push back.
  const next = {
    weekly: structuredClone(serverAvailability.weekly || {}),
    blocks: structuredClone(serverAvailability.blocks || {})
  };
  const arr = next.blocks[dateISO] ? [...next.blocks[dateISO]] : [];
  const has = arr.includes(t);

  if(shouldBlock && !has){
    arr.push(t);
    arr.sort();
    next.blocks[dateISO] = arr;
  }
  if(!shouldBlock && has){
    const filtered = arr.filter(x=>x!==t);
    if(filtered.length) next.blocks[dateISO] = filtered;
    else delete next.blocks[dateISO];
  }

  postAvailability("/api/availability/set", { availability: next })
    .then(loadServerAvailability)
    .then(()=>{
      // Cache latest
      if(serverAvailability.online){
        state.availability.weekly = structuredClone(serverAvailability.weekly);
        state.availability.blocks = structuredClone(serverAvailability.blocks);
        saveState(state);
      }
      renderCalendar();
      if($("#adminPanel")) renderAdminPanels();
      toast(shouldBlock ? "Blocked slot." : "Unblocked slot.");
    })
    .catch(err=>{
      console.warn("[availability] update failed:", err);
      toast(String(err?.message || "Server error"));
      loadServerAvailability().then(()=>{ renderCalendar(); if($("#adminPanel")) renderAdminPanels(); });
    });
}

function findAppointmentByStart(startISO){
  const all = getAllScheduleRows();
  return all.find(a => a.startISO === startISO && (a.status==="pending" || a.status==="accepted")) || null;
}

function openRequestModal(startISO){
  // Pre-fill
  setText("#modalTitle", isAdmin ? "Book an Appointment" : "Request an Appointment");
  try{
    const btn = document.querySelector("#requestForm button[type=\"submit\"]");
    if(btn) btn.textContent = isAdmin ? "Book" : "Submit Request";
  }catch(e){}
  setDisplay("#adminGate", "none");
  setDisplay("#jobDetailsGate", "none");
  setDisplay("#requestGate", "block");

  $("#reqStart").value = startISO;
  const d = new Date(startISO);
  setText("#reqWhen", `${fmtDate(d)} at ${d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}`);
  $("#requestForm").reset();
  $("#reqStart").value = startISO;

  showModal();
}

function openAdmin(){
  setText("#modalTitle", "Management Mode");
  setDisplay("#requestGate", "none");
  setDisplay("#jobDetailsGate", "none");
  setDisplay("#adminGate", "block");
  $("#adminPin").value = "";
  showModal();
}


function openJobDetailsModal(apptId){
  if(!isAdmin) return;
  const a = getAllScheduleRows().find(x=>x.id===apptId);
  if(!a) return;

  const d = new Date(a.startISO);
  const when = `${fmtDate(d)} at ${d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}`;
  setText("#modalTitle", "Job Details");
  setDisplay("#requestGate", "none");
  setDisplay("#adminGate", "none");
  setDisplay("#jobDetailsGate", "block");

  // Fill fields
  setText("#jobWhen", when);
  setText("#jobStatus", a.status || "");
  setText("#jobName", a.name || "");
  setText("#jobContact", `${a.phone || ""}${(a.phone && a.email) ? " • " : ""}${a.email || ""}`);
  setText("#jobService", a.serviceType || "");
  setText("#jobAppliance", a.appliance || "");
  setText("#jobNotes", a.notes || "");

  // Buttons: show/hide based on status
  const isPending = (a.status === "pending");
  const isAccepted = (a.status === "accepted");
setDisplay("#jobAcceptBtn", isPending ? "inline-flex" : "none");
  setDisplay("#jobRejectBtn", isPending ? "inline-flex" : "none");
// Delete is always available in admin (for cleanup)
  setDisplay("#jobDeleteBtn", "inline-flex");

  // Wire actions (overwrite handlers each open)
  const acceptBtn = $("#jobAcceptBtn");
  const rejectBtn = $("#jobRejectBtn");
const delBtn = $("#jobDeleteBtn");
  const closeBtn = $("#jobCloseBtn");

  if(acceptBtn) acceptBtn.onclick = ()=>{ acceptAppt(apptId); closeModal(); };
  if(rejectBtn) rejectBtn.onclick = ()=>{ rejectAppt(apptId); closeModal(); };

  if(delBtn) delBtn.onclick = ()=>{ deleteAppt(apptId); closeModal(); };
  if(closeBtn) closeBtn.onclick = ()=> closeModal();

  showModal();
}

function showModal(){
  const mb = $("#modalBackdrop");
  if(!mb) return;
  mb.classList.add("show");
}
function closeModal(){
  const mb2 = $("#modalBackdrop");
  if(!mb2) return;
  mb2.classList.remove("show");
}

function setAdmin(v){
  isAdmin = v;
  setPersistedAdmin(v);
  document.body.dataset.admin = v ? "1" : "0";

  // Public pages should not show any admin indicator unless admin is ON.
  setText("#adminPill", "Management: ON");
  setDisplay("#adminPill", v ? "inline-flex" : "none");

  const ap = $("#adminPill");
  if(ap) ap.className = "badge";
  if(ap) ap.style.borderColor = "rgba(34,197,94,.35)";
  if(ap) ap.style.color = "#86efac";

  // Admin panels
  setDisplay("#adminLogoutBtn", "none"); // button removed; keep hidden if it exists
  setDisplay("#adminPanel", v ? "block" : "none");
  // Appointment management tables are admin-only
  setDisplay("#apptTables", v ? "grid" : "none");

  saveState(state);
  if($("#calGrid")) renderCalendar();
  if($("#adminPanel")) renderAdminPanels();
  if($("#pendingTableBody") || $("#acceptedTableBody")) renderAppointmentsTables();
  try{ document.dispatchEvent(new CustomEvent("dsd_admin_change", { detail: { isAdmin: v } })); }catch(e){}
}

function onSubmitRequest(e){
  e.preventDefault();

  if(!serverSchedule.online){
    toast("Server offline — cannot submit requests right now.");
    closeModal();
    renderCalendar();
    return;
  }

  const startISO = $("#reqStart").value;
  const slots = clamp(Number(state.settings.appointmentDurationSlots) || 2, 1, 8);

  // Server-backed check: only booked/pending matters
  const existing = findAppointmentByStart(startISO);
  if(existing){
    toast("That slot is no longer available.");
    closeModal();
    renderCalendar();
    return;
  }

  const appt = {
    id: uid(),
    startISO,
    slots,
    name: $("#reqName").value.trim(),
    phone: $("#reqPhone").value.trim(),
    email: $("#reqEmail").value.trim(),
    serviceType: $("#reqServiceType").value,
    appliance: $("#reqAppliance").value.trim(),
    notes: $("#reqNotes").value.trim(),
    createdISO: new Date().toISOString()
  };

  // Persist to server (pending for customers, booked for admin)
  const endpoint = isAdmin ? "/api/schedule/book" : "/api/schedule/request";

  postSchedule(endpoint, appt)
    .then(async ()=>{
      await loadServerSchedule();
      closeModal();
      toast(isAdmin ? "Booked." : "Request submitted!");
      renderCalendar();
      renderAppointmentsTables();
    })
    .catch(err=>{
      console.warn("[schedule] submit failed:", err);
      toast(String(err?.message || "Server error"));
      // Refresh view anyway (in case someone else booked it)
      loadServerSchedule().then(()=>{
        closeModal();
        renderCalendar();
        renderAppointmentsTables();
      });
    });
}


function renderAppointmentsTables(){
  const hasTables = ($("#pendingTableBody") || $("#acceptedTableBody") || $("#completedTableBody"));
  if(!hasTables) return;

  // Admin-only visibility for tables
  setDisplay("#apptTables", isAdmin ? "grid" : "none");
  if(!isAdmin) return;

  const all = getAllScheduleRows();
  const pending = all.filter(a=>a.status==="pending").sort((a,b)=>String(a.startISO).localeCompare(String(b.startISO)));
  const accepted = all.filter(a=>a.status==="accepted").sort((a,b)=>String(a.startISO).localeCompare(String(b.startISO)));


  setText("#pendingCount", String(pending.length));
  setText("#bookedCount", String(accepted.length));
const tp = $("#pendingTableBody");
  const ta = $("#acceptedTableBody");
if(tp) tp.innerHTML = "";
  if(ta) ta.innerHTML = "";
function whenStr(a){
    const d = new Date(a.startISO);
    return `${toISODate(d)} ${d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}`;
  }

  function makeActions(a){
    const td = document.createElement("td");
    const id = a.id;

    // Minimal list view: actions happen inside Details modal.
td.innerHTML = `<button class="btn" data-act="details" data-id="${id}">Details</button>`;
    return td;
  }


  function row(a){
    const tr = document.createElement("tr");

    const when = escapeHtml(whenStr(a));
    const customer = escapeHtml(a.name || "");
    const service = `${escapeHtml(a.serviceType || "")}<div class="small">${escapeHtml(a.appliance || "")}</div>`;
    // Pending / Booked: minimal list; see full details & actions in Details modal
    tr.innerHTML = `
        <td>${when}</td>
        <td>${customer}</td>
        <td>${service}</td>
      `;

    tr.appendChild(makeActions(a));
    return tr;
  }

  for(const a of pending) if(tp) tp.appendChild(row(a));
  for(const a of accepted) if(ta) ta.appendChild(row(a));
// bind action buttons
  $all("[data-act]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if(!isAdmin) return;
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      if(act==="delete") deleteAppt(id);
      if(act==="details") openJobDetailsModal(id);
    });
  });
}

function acceptAppt(id){
  if(!serverSchedule.online){
    toast("Server offline.");
    return;
  }
  postSchedule("/api/schedule/accept", { id })
    .then(loadServerSchedule)
    .then(()=>{
      toast("Appointment accepted (booked).");
      renderCalendar();
      renderAppointmentsTables();
    })
    .catch(err=>{
      console.warn("[schedule] accept failed:", err);
      toast(String(err?.message || "Server error"));
      loadServerSchedule().then(()=>{
        renderCalendar();
        renderAppointmentsTables();
      });
    });
}


function rejectAppt(id){
  if(!serverSchedule.online){
    toast("Server offline.");
    return;
  }
  postSchedule("/api/schedule/reject", { id })
    .then(loadServerSchedule)
    .then(()=>{
      toast("Request rejected. Slot reopened.");
      renderCalendar();
      renderAppointmentsTables();
    })
    .catch(err=>{
      console.warn("[schedule] reject failed:", err);
      toast(String(err?.message || "Server error"));
      loadServerSchedule().then(()=>{
        renderCalendar();
        renderAppointmentsTables();
      });
    });
}


function cancelAppt(id){
  if(!serverSchedule.online){
    toast("Server offline.");
    return;
  }
  postSchedule("/api/schedule/cancel", { id })
    .then(loadServerSchedule)
    .then(()=>{
      toast("Booking canceled. Slot reopened.");
      renderCalendar();
      renderAppointmentsTables();
    })
    .catch(err=>{
      console.warn("[schedule] cancel failed:", err);
      toast(String(err?.message || "Server error"));
      loadServerSchedule().then(()=>{
        renderCalendar();
        renderAppointmentsTables();
      });
    });
}



function deleteAppt(id){
  // Delete does the right thing based on where the row exists (pending vs booked)
  if(!serverSchedule.online){
    toast("Server offline.");
    return;
  }
  const inPending = serverSchedule.pending.some(x=>x.id===id);
  const inBooked = serverSchedule.booked.some(x=>x.id===id);

  const endpoint = inPending ? "/api/schedule/reject" : (inBooked ? "/api/schedule/cancel" : null);
  if(!endpoint){
    toast("Not found on server.");
    return;
  }

  postSchedule(endpoint, { id })
    .then(loadServerSchedule)
    .then(()=>{
      toast("Deleted.");
      renderCalendar();
      renderAppointmentsTables();
    })
    .catch(err=>{
      console.warn("[schedule] delete failed:", err);
      toast(String(err?.message || "Server error"));
      loadServerSchedule().then(()=>{
        renderCalendar();
        renderAppointmentsTables();
      });
    });
}

function renderAdminPanels(){
  // Availability weekly inputs
  for(let dow=0; dow<7; dow++){
    const row = document.querySelector(`[data-dow="${dow}"]`);
    if(!row) continue;
    const conf = state.availability.weekly[String(dow)] ?? {enabled:false,start:9,end:18};
    row.querySelector(".dowEnabled").checked = !!conf.enabled;
    row.querySelector(".dowStart").value = conf.start;
    row.querySelector(".dowEnd").value = conf.end;
  }

  // Blocks list
  const list = $("#blocksList");
  list.innerHTML = "";
  const keys = Object.keys(state.availability.blocks).sort();
  if(keys.length === 0){
    list.innerHTML = `<div class="small">No blocked slots yet.</div>`;
  }else{
    for(const k of keys){
      const times = (state.availability.blocks[k] ?? []).join(", ");
      const div = document.createElement("div");
      div.className = "feature";
      div.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <div style="font-weight:800">${escapeHtml(k)}</div>
            <div class="small">${escapeHtml(times)}</div>
          </div>
          <button class="btn danger" data-clear="${escapeHtml(k)}">Clear day</button>
        </div>
      `;
      list.appendChild(div);
    }
    $all("[data-clear]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const k = b.getAttribute("data-clear");
        if(!serverOnline()){
          toast("Server offline.");
          return;
        }
        const next = {
          weekly: structuredClone(serverAvailability.weekly || {}),
          blocks: structuredClone(serverAvailability.blocks || {})
        };
        delete next.blocks[k];
        postAvailability("/api/availability/set", { availability: next })
          .then(loadServerAvailability)
          .then(()=>{
            if(serverAvailability.online){
              state.availability.weekly = structuredClone(serverAvailability.weekly);
              state.availability.blocks = structuredClone(serverAvailability.blocks);
              saveState(state);
            }
            renderCalendar();
            renderAdminPanels();
            toast("Cleared blocked slots for that day.");
          })
          .catch(err=>{
            console.warn("[availability] clear day failed:", err);
            toast(String(err?.message || "Server error"));
            loadServerAvailability().then(()=>{ renderCalendar(); renderAdminPanels(); });
          });
      });
    });
  }
}

function onSaveAvailability(e){
  e.preventDefault();
  if(!serverOnline()){
    toast("Server offline.");
    return;
  }

  const nextWeekly = {};
  for(let dow=0; dow<7; dow++){
    const row = document.querySelector(`[data-dow="${dow}"]`);
    const enabled = row.querySelector(".dowEnabled").checked;
    const start = clamp(Number(row.querySelector(".dowStart").value || 9), 0, 23);
    const end = clamp(Number(row.querySelector(".dowEnd").value || 18), 1, 24);
    nextWeekly[String(dow)] = { enabled, start: Math.min(start,end-1), end: Math.max(end,start+1) };
  }

  const next = {
    weekly: nextWeekly,
    blocks: structuredClone(serverAvailability.blocks || {})
  };

  postAvailability("/api/availability/set", { availability: next })
    .then(loadServerAvailability)
    .then(()=>{
      if(serverAvailability.online){
        state.availability.weekly = structuredClone(serverAvailability.weekly);
        state.availability.blocks = structuredClone(serverAvailability.blocks);
        saveState(state);
      }
      renderCalendar();
      renderAdminPanels();
      toast("Availability saved.");
    })
    .catch(err=>{
      console.warn("[availability] save failed:", err);
      toast(String(err?.message || "Server error"));
      loadServerAvailability().then(()=>{ renderCalendar(); renderAdminPanels(); });
    });
}

function onBlockDate(){
  const date = $("#blockDate").value;
  if(!date){
    toast("Pick a date first.");
    return;
  }
  // Block all slots for that date within global open/close
  const open = state.settings.openHour;
  const close = state.settings.closeHour;
  const slotMin = state.settings.slotMinutes;
  const numSlots = Math.ceil(((close - open) * 60) / slotMin);

  const arr = [];
  for(let s=0;s<numSlots;s++){
    const minutesFromOpen = s*slotMin;
    const hh = open + Math.floor(minutesFromOpen/60);
    const mm = minutesFromOpen%60;
    arr.push(`${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`);
  }
  if(!serverOnline()){
    toast("Server offline.");
    return;
  }

  const next = {
    weekly: structuredClone(serverAvailability.weekly || {}),
    blocks: structuredClone(serverAvailability.blocks || {})
  };
  next.blocks[date] = arr;

  postAvailability("/api/availability/set", { availability: next })
    .then(loadServerAvailability)
    .then(()=>{
      if(serverAvailability.online){
        state.availability.weekly = structuredClone(serverAvailability.weekly);
        state.availability.blocks = structuredClone(serverAvailability.blocks);
        saveState(state);
      }
      renderCalendar();
      renderAdminPanels();
      toast("Blocked full day.");
    })
    .catch(err=>{
      console.warn("[availability] block day failed:", err);
      toast(String(err?.message || "Server error"));
      loadServerAvailability().then(()=>{ renderCalendar(); renderAdminPanels(); });
    });
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll("\"","&quot;")
    .replaceAll("'","&#039;");
}

// Start
document.addEventListener("DOMContentLoaded", async ()=>{
  // Mobile nav (hamburger)
  try{
    const btn = document.querySelector(".navToggle");
    const nav = document.getElementById("topNav") || document.querySelector(".nav-links");
    if(btn && nav){
      const setOpen = (open)=>{
        nav.classList.toggle("open", !!open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      };
      btn.addEventListener("click", ()=> setOpen(!nav.classList.contains("open")));
      // Close menu after clicking a link (mobile)
      nav.addEventListener("click", (e)=>{
        const a = e.target.closest && e.target.closest("a");
        if(a) setOpen(false);
      });
      // Close if window resized up to desktop
      window.addEventListener("resize", ()=>{
        if(window.innerWidth > 820) setOpen(false);
      });
    }
  }catch(_){ /* no-op */ }

  // If there's no admin persisted, keep off
  setDisplay("#adminLogoutBtn", "none");
  setDisplay("#adminPanel", "none");
  setText("#adminPill", "Management: ON");
  setDisplay("#adminPill", "none");
  setDisplay("#apptTables", "none");
  init();
});


function wireInventoryAdmin(){
  const btn = $("#invAdminBtn");
  const logout = $("#invAdminLogout");

  if(btn){
    btn.addEventListener("click", ()=>openAdmin());
  }
  if(logout){
    logout.addEventListener("click", ()=>setAdmin(false));
  }

  const form = $("#invForm");
  const list = $("#invAdminList");
  const clearBtn = $("#invClear");
  let editImagePath = "";

  const sync = ()=>{
    setDisplay("#inventoryAdminPanel", isAdmin ? "block" : "none");
    setDisplay("#invAdminPill", isAdmin ? "inline-flex" : "none");
    setDisplay("#invAdminLogout", isAdmin ? "inline-flex" : "none");
  };
  sync();

  function clearForm(){
    const f = $("#invId");
    if(!f) return;
    $("#invId").value = "";
    $("#invTitle").value = "";
    $("#invModel").value = "";
    $("#invBuy").value = "";
    $("#invRent").value = "";
    $("#invStatus").value = "available";
    $("#invNote").value = "";
    const img = $("#invImage");
    if(img) img.value = "";
    editImagePath = "";
  }

  function renderAdminList(){
    if(!list) return;
    list.innerHTML = "";
    if(!serverInventory.online){
      list.innerHTML = `<div class="small">Inventory server offline.</div>`;
      return;
    }
    const items = Array.isArray(serverInventory.items) ? serverInventory.items.slice() : [];
    if(items.length === 0){
      list.innerHTML = `<div class="small">No inventory items yet.</div>`;
      return;
    }
    for(const it of items){
      const div = document.createElement("div");
      div.className = "feature";
      const buy = (it.buyPrice != null && it.buyPrice !== "") ? `$${Number(it.buyPrice).toFixed(0)}` : "—";
      const rent = (it.rentPrice != null && it.rentPrice !== "") ? `$${Number(it.rentPrice).toFixed(0)}/mo` : "—";
      div.innerHTML = `
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
          <div>
            <div style="font-weight:800">${escapeHtml(it.title || "(Untitled)")}</div>
            <div class="small">Model: ${escapeHtml(it.model || "—")} • Buy: ${buy} • Rent: ${rent} • Status: ${escapeHtml(it.status || "unavailable")}</div>
            <div class="small">${escapeHtml(it.note || "")}</div>
            <div class="small">Image: ${escapeHtml(it.imagePath || "")}</div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn" data-inv-edit="${escapeHtml(it.id)}">Edit</button>
            <button class="btn danger" data-inv-del="${escapeHtml(it.id)}">Delete</button>
          </div>
        </div>
      `;
      list.appendChild(div);
    }

    $all("[data-inv-edit]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const id = b.getAttribute("data-inv-edit");
        const it = serverInventory.items.find(x=>x.id===id);
        if(!it) return;
        $("#invId").value = it.id;
        $("#invTitle").value = it.title ?? "";
        $("#invModel").value = it.model ?? "";
        $("#invBuy").value = (it.buyPrice ?? "") === null ? "" : (it.buyPrice ?? "");
        $("#invRent").value = (it.rentPrice ?? "") === null ? "" : (it.rentPrice ?? "");
        $("#invStatus").value = it.status ?? "unavailable";
        $("#invNote").value = it.note ?? "";
        const img = $("#invImage");
        if(img) img.value = "";
        editImagePath = it.imagePath || "";
        toast("Loaded item for editing.");
      });
    });

    $all("[data-inv-del]").forEach(b=>{
      b.addEventListener("click", async ()=>{
        const id = b.getAttribute("data-inv-del");
        const it = serverInventory.items.find(x=>x.id===id);
        if(!it) return;
        if(!confirm(`Delete "${it.title}"?`)) return;
        if(!serverInventory.online){ toast("Server offline."); return; }
        try{
          await postInventory("/api/inventory/delete", { id });
          await loadServerInventory();
          if($("#inventoryWrap")) renderInventory();
          renderAdminList();
          toast("Item deleted.");
        }catch(err){
          console.warn("[inventory] delete failed:", err);
          toast(String(err?.message || "Server error"));
        }
      });
    });
  }

  if(clearBtn){
    clearBtn.addEventListener("click", ()=>clearForm());
  }

  async function fileToDataUrl(file){
    return new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onerror = ()=>reject(new Error("Failed to read file"));
      r.onload = ()=>resolve(String(r.result || ""));
      r.readAsDataURL(file);
    });
  }

  if(form){
    form.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if(!isAdmin){ toast("Admin only."); return; }
      if(!serverInventory.online){ toast("Server offline."); return; }

      const id = $("#invId").value || uid();
      const title = $("#invTitle").value.trim();
      const model = $("#invModel").value.trim();
      const buyRaw = $("#invBuy").value;
      const rentRaw = $("#invRent").value;
      const buyPrice = buyRaw === "" ? null : Number(buyRaw);
      const rentPrice = rentRaw === "" ? null : Number(rentRaw);
      const status = $("#invStatus").value;
      const note = $("#invNote").value.trim();

      const imgInput = $("#invImage");
      const file = (imgInput && imgInput.files && imgInput.files[0]) ? imgInput.files[0] : null;
      let imageDataUrl = null;
      let imageName = null;
      if(file){
        // Base64 data URLs inflate size ~33%. Keep uploads reasonably small.
        const MAX_MB = 5;
        if((file.size || 0) > MAX_MB * 1024 * 1024){
          toast(`Image is too large. Please use a smaller file (under ${MAX_MB}MB).`);
          return;
        }
        imageDataUrl = await fileToDataUrl(file);
        imageName = file.name;
      }

      const item = { id, title, model, buyPrice, rentPrice, status, note, imagePath: editImagePath };

      try{
        await postInventory("/api/inventory/upsert", { item, imageDataUrl, imageName });
        await loadServerInventory();
        if($("#inventoryWrap")) renderInventory();
        renderAdminList();
        clearForm();
        toast("Item saved.");
      }catch(err){
        console.warn("[inventory] save failed:", err);
        toast(String(err?.message || "Server error"));
      }
    });
  }

  // When admin toggles via schedule/inventory, re-sync UI
  const _setAdmin = setAdmin;
  setAdmin = function(v){
    _setAdmin(v);
    sync();
    renderAdminList();
  };

  renderAdminList();
}

function wireGalleryAdmin(){
  const panel = $("#galleryAdminPanel");
  if(!panel) return;

  function sync(){
    panel.style.display = isAdmin ? "block" : "none";
  }

  async function fileToDataUrl(file){
    return new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onerror = ()=>reject(new Error("Failed to read file"));
      r.onload = ()=>resolve(String(r.result || ""));
      r.readAsDataURL(file);
    });
  }

  const form = $("#galleryUploadForm");
  if(form){
    form.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if(!isAdmin){ toast("Admin only."); return; }
      if(!serverGallery.online){ toast("Server offline."); return; }

      const caption = $("#galleryCaption")?.value?.trim() || "";
      const input = $("#galleryFile");
      const file = (input && input.files && input.files[0]) ? input.files[0] : null;
      if(!file){ toast("Choose a photo first."); return; }

      const MAX_MB = 6;
      if((file.size || 0) > MAX_MB * 1024 * 1024){
        toast(`Image is too large. Please use a smaller file (under ${MAX_MB}MB).`);
        return;
      }

      try{
        const imageDataUrl = await fileToDataUrl(file);
        await postGallery("/api/gallery/add", { caption, imageDataUrl, imageName: file.name });
        await loadServerGallery();
        renderGallery();
        if(input) input.value = "";
        const cap = $("#galleryCaption");
        if(cap) cap.value = "";
        toast("Photo uploaded.");
      }catch(err){
        console.warn("[gallery] upload failed:", err);
        toast(String(err?.message || err || "Upload failed"));
      }
    });
  }

  // When admin toggles via other pages, re-sync UI
  const _setAdmin = setAdmin;
  setAdmin = function(v){
    _setAdmin(v);
    sync();
    renderGallery();
  };

  sync();
}

function wireContactForm(){
  const form = $("#contactFormNew");
  if(!form) return;
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const name = $("#cName")?.value?.trim() || "";
    const email = $("#cEmail")?.value?.trim() || "";
    const type = $("#cType")?.value?.trim() || "";
    const description = $("#cDesc")?.value?.trim() || "";

    if(!name || !email || !type || !description){
      toast("Please fill out all fields.");
      return;
    }

    try{
      await fetchJson(`${getServerBase()}/api/contact`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ name, email, type, description })
      });
      form.reset();
      toast("Message sent.");
    }catch(err){
      console.warn("[contact] send failed:", err);
      toast(String(err?.message || err || "Send failed"));
    }
  });
}