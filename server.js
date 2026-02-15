const http = require("http");
const { WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 8787;

// -------------------- Static site root detection --------------------
// Depending on how the repo was uploaded to Render, the site files may live in the repo root
// or inside a nested folder. We auto-detect by looking for index.html.
const SITE_ROOT = (() => {
  const candidates = [
    __dirname,
    path.join(__dirname, "REPO"),
    path.join(__dirname, "dune-sea-diagnostics-main"),
    path.join(__dirname, "public"),
    path.join(__dirname, "site"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "index.html"))) return dir;
    } catch {}
  }
  return __dirname;
})();

// -------------------- Email (Google Workspace / Gmail SMTP) --------------------
// Set these environment variables on Render:
//   GMAIL_USER=service@duneseadiagnostics.com
//   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   (App Password; no spaces is fine)
// Optional:
//   MAIL_TO=service@duneseadiagnostics.com   (where to receive contact form emails)
//   MAIL_FROM=service@duneseadiagnostics.com (from address shown)
// If not configured, the server will still store messages in data/messages.json.
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
const MAIL_TO = process.env.MAIL_TO || GMAIL_USER || "";
const MAIL_FROM = process.env.MAIL_FROM || GMAIL_USER || "";

const mailer =
  (GMAIL_USER && GMAIL_APP_PASSWORD)
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      })
    : null;

async function sendContactEmail(msg){
  if(!mailer || !MAIL_TO || !MAIL_FROM) return { ok:false, skipped:true };
  const safe = (v) => String(v || "").replace(/[<>]/g, "");
  const subject = `New website contact: ${safe(msg.name) || "Unknown"} (${safe(msg.type) || "General"})`;

  const html = `
    <h2>New Contact Message</h2>
    <p><strong>Name:</strong> ${safe(msg.name)}</p>
    <p><strong>Email:</strong> ${safe(msg.email)}</p>
    <p><strong>Type:</strong> ${safe(msg.type)}</p>
    <p><strong>Received:</strong> ${safe(msg.createdISO)}</p>
    <hr />
    <p style="white-space:pre-wrap">${safe(msg.description)}</p>
  `;

  try{
    await mailer.sendMail({
      from: `"Dune Sea Diagnostics" <${MAIL_FROM}>`,
      to: MAIL_TO,
      replyTo: msg.email ? safe(msg.email) : undefined,
      subject,
      html
    });
    return { ok:true };
  }catch(e){
    console.error("[MAIL] send failed:", e);
    return { ok:false, error:String(e) };
  }
}



async function sendScheduleRequestEmail(appt){
  if(!mailer || !MAIL_TO || !MAIL_FROM) return { ok:false, skipped:true };
  const safe = (v) => String(v || "").replace(/[<>]/g, "");
  const subject = `New booking request: ${safe(appt.startISO) || "Unknown time"} (${safe(appt.name) || "Unknown"})`;

  const html = `
    <h2>New Booking Request</h2>
    <p><strong>Requested slot:</strong> ${safe(appt.startISO)}</p>
    <p><strong>Name:</strong> ${safe(appt.name)}</p>
    <p><strong>Phone:</strong> ${safe(appt.phone)}</p>
    <p><strong>Email:</strong> ${safe(appt.email)}</p>
    <p><strong>Service Type:</strong> ${safe(appt.serviceType)}</p>
    <p><strong>Appliance:</strong> ${safe(appt.appliance)}</p>
    <p><strong>Slots:</strong> ${safe(appt.slots)}</p>
    <p><strong>Received:</strong> ${safe(appt.createdISO)}</p>
    <hr />
    <p><strong>Notes:</strong></p>
    <p style="white-space:pre-wrap">${safe(appt.notes) || "None"}</p>
  `;

  try{
    await mailer.sendMail({
      from: `"Dune Sea Diagnostics" <${MAIL_FROM}>`,
      to: MAIL_TO,
      replyTo: appt.email ? safe(appt.email) : undefined,
      subject,
      html
    });
    return { ok:true };
  }catch(e){
    console.error("[MAIL] booking request send failed:", e);
    return { ok:false, error:String(e) };
  }
}


// -------------------- Persistence helpers --------------------
const DATA_DIR = path.join(__dirname, "data");
const BOOKED_FILE = path.join(DATA_DIR, "booked.json");
const PENDING_FILE = path.join(DATA_DIR, "pending.json");
const AVAIL_FILE = path.join(DATA_DIR, "availability.json");

// Gallery + Contact
const GALLERY_FILE = path.join(DATA_DIR, "gallery.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

// Inventory
const INVENTORY_FILE = path.join(DATA_DIR, "inventory.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DEFAULT_IMAGE_FILE = "default.png";

// Availability shape:
// {
//   weekly: { 0:{enabled,start,end}, ... 6:{...} },
//   blocks: { "YYYY-MM-DD": ["08:00","10:00", ...] }
// }

function ensureDataDir(){
  try{ fs.mkdirSync(DATA_DIR, { recursive:true }); }catch(_){}
  try{ fs.mkdirSync(UPLOAD_DIR, { recursive:true }); }catch(_){}
}
function safeReadJson(filePath, fallback){
  try{
    if(!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    if(!raw.trim()) return fallback;
    return JSON.parse(raw);
  }catch(e){
    console.warn("[DATA] failed to read", filePath, e);
    return fallback;
  }
}
function safeWriteJson(filePath, obj){
  try{
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
    return true;
  }catch(e){
    console.warn("[DATA] failed to write", filePath, e);
    return false;
  }
}
function makeId(){
  try{
    const { randomUUID } = require("crypto");
    if(typeof randomUUID === "function") return randomUUID();
  }catch(_){}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}
function nowStamp(){ return new Date().toISOString(); }

function safeContentTypeFromExt(ext){
  const e = String(ext||"").toLowerCase();
  if(e === ".png") return "image/png";
  if(e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if(e === ".webp") return "image/webp";
  if(e === ".gif") return "image/gif";
  if(e === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function saveUploadedImage({ dataUrl, filenameHint, id, prefix }){
  // Accepts data: URL or raw base64. Returns an /uploads/... path.
  if(!dataUrl) return `/uploads/${DEFAULT_IMAGE_FILE}`;

  let mime = "";
  let b64 = "";
  const s = String(dataUrl);

  const m = s.match(/^data:([^;]+);base64,(.*)$/i);
  if(m){
    mime = m[1];
    b64 = m[2];
  }else{
    // assume raw base64
    b64 = s;
  }

  let ext = "";
  if(mime.includes("png")) ext = ".png";
  else if(mime.includes("jpeg") || mime.includes("jpg")) ext = ".jpg";
  else if(mime.includes("webp")) ext = ".webp";
  else if(mime.includes("gif")) ext = ".gif";
  else {
    // try hint
    const hinted = path.extname(String(filenameHint||"")).toLowerCase();
    if([".png",".jpg",".jpeg",".webp",".gif"].includes(hinted)) ext = hinted === ".jpeg" ? ".jpg" : hinted;
  }
  if(!ext) ext = ".png";

  try{
    const buf = Buffer.from(b64, "base64");
    if(!buf || buf.length < 8) return `/uploads/${DEFAULT_IMAGE_FILE}`;
    const safeId = String(id || makeId()).replace(/[^a-z0-9_-]/gi, "");
    const pfx = String(prefix || "inv").replace(/[^a-z0-9_-]/gi, "");
    const name = `${pfx}_${safeId}_${Date.now()}${ext}`;
    const full = path.join(UPLOAD_DIR, name);
    fs.writeFileSync(full, buf);
    return `/uploads/${name}`;
  }catch(e){
    console.warn("[INV] failed to save upload", e);
    return `/uploads/${DEFAULT_IMAGE_FILE}`;
  }
}

ensureDataDir();

let BOOKED = safeReadJson(BOOKED_FILE, []);
let PENDING = safeReadJson(PENDING_FILE, []);
if(!Array.isArray(BOOKED)) BOOKED = [];
if(!Array.isArray(PENDING)) PENDING = [];

const DEFAULT_AVAILABILITY = {
  weekly: {
    0: { enabled:false, start:8, end:18 },
    1: { enabled:true,  start:8, end:18 },
    2: { enabled:true,  start:8, end:18 },
    3: { enabled:true,  start:8, end:18 },
    4: { enabled:true,  start:8, end:18 },
    5: { enabled:true,  start:8, end:18 },
    6: { enabled:false, start:8, end:18 },
  },
  blocks: {}
};

let AVAILABILITY = safeReadJson(AVAIL_FILE, DEFAULT_AVAILABILITY);
if(!AVAILABILITY || typeof AVAILABILITY !== "object") AVAILABILITY = DEFAULT_AVAILABILITY;
if(!AVAILABILITY.weekly || typeof AVAILABILITY.weekly !== "object") AVAILABILITY.weekly = DEFAULT_AVAILABILITY.weekly;
if(!AVAILABILITY.blocks || typeof AVAILABILITY.blocks !== "object") AVAILABILITY.blocks = {};

// Inventory shape:
// [
//   { id, title, model, buyPrice, rentPrice, status, note, imagePath }
// ]
let INVENTORY = safeReadJson(INVENTORY_FILE, []);
if(!Array.isArray(INVENTORY)) INVENTORY = [];

// Gallery shape:
// [ { id, imagePath, caption, createdISO } ]
let GALLERY = safeReadJson(GALLERY_FILE, []);
if(!Array.isArray(GALLERY)) GALLERY = [];

// Contact messages shape:
// [ { id, name, email, type, description, createdISO } ]
let MESSAGES = safeReadJson(MESSAGES_FILE, []);
if(!Array.isArray(MESSAGES)) MESSAGES = [];

function normalizeInventoryItem(input){
  const id = String(input?.id || makeId());
  const title = String(input?.title || "").trim();
  const model = String(input?.model || "").trim();
  const buyPrice = (input?.buyPrice === "" || input?.buyPrice == null) ? null : Number(input.buyPrice);
  const rentPrice = (input?.rentPrice === "" || input?.rentPrice == null) ? null : Number(input.rentPrice);
  const status = (String(input?.status || "unavailable") === "available") ? "available" : "unavailable";
  const note = String(input?.note || "").trim();
  let imagePath = String(input?.imagePath || "").trim();
  if(!imagePath) imagePath = `/uploads/${DEFAULT_IMAGE_FILE}`;
  // Only allow serving from /uploads
  if(!imagePath.startsWith("/uploads/")) imagePath = `/uploads/${DEFAULT_IMAGE_FILE}`;
  return { id, title, model, buyPrice, rentPrice, status, note, imagePath };
}

function persist(){
  safeWriteJson(BOOKED_FILE, BOOKED);
  safeWriteJson(PENDING_FILE, PENDING);
  safeWriteJson(AVAIL_FILE, AVAILABILITY);
  safeWriteJson(INVENTORY_FILE, INVENTORY);
  safeWriteJson(GALLERY_FILE, GALLERY);
  safeWriteJson(MESSAGES_FILE, MESSAGES);
}

function normalizeAvailability(input){
  const out = { weekly: {}, blocks: {} };

  const w = input?.weekly && typeof input.weekly === "object" ? input.weekly : DEFAULT_AVAILABILITY.weekly;
  for(let dow=0; dow<7; dow++){
    const conf = w[String(dow)] ?? w[dow] ?? DEFAULT_AVAILABILITY.weekly[dow];
    const enabled = !!conf?.enabled;
    const start = Math.max(0, Math.min(23, Number(conf?.start ?? DEFAULT_AVAILABILITY.weekly[dow].start)));
    const endRaw = Math.max(1, Math.min(24, Number(conf?.end ?? DEFAULT_AVAILABILITY.weekly[dow].end)));
    const end = Math.max(endRaw, start+1);
    out.weekly[String(dow)] = { enabled, start, end };
  }

  const b = input?.blocks && typeof input.blocks === "object" ? input.blocks : {};
  for(const k of Object.keys(b)){
    const arr = Array.isArray(b[k]) ? b[k].map(String) : [];
    const uniq = Array.from(new Set(arr)).filter(Boolean).sort();
    if(uniq.length) out.blocks[String(k)] = uniq;
  }

  return out;
}

function normalizeAppt(a, status){
  // store the same shape the client uses, but ensure required fields exist
  const startISO = String(a?.startISO || "");
  const slots = Number(a?.slots || 1);
  return {
    id: String(a?.id || makeId()),
    startISO,
    slots,
    name: String(a?.name || ""),
    phone: String(a?.phone || ""),
    email: String(a?.email || ""),
    serviceType: String(a?.serviceType || ""),
    appliance: String(a?.appliance || ""),
    notes: String(a?.notes || ""),
    status,
    createdISO: String(a?.createdISO || nowStamp())
  };
}

function hasStart(list, startISO){
  const target = Date.parse(String(startISO || ""));
  if(!Number.isFinite(target)) return false;
  return list.some(x => {
    const t = Date.parse(String(x?.startISO || ""));
    return Number.isFinite(t) && t === target;
  });
}

// -------------------- tiny HTTP helpers --------------------
function send(res, status, headers, body){
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj){
  send(res, status, {
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Allow-Methods":"POST,OPTIONS,GET",
  }, JSON.stringify(obj));
}
function readBodyJson(req, res, cb){
  // Inventory image uploads are sent as base64 data URLs.
  // Those can easily exceed 2MB, especially with phone JPGs.
  // We allow up to ~15MB here. If we hit the limit, return a 413
  // instead of hard-dropping the socket (which shows as "Failed to fetch").
  const MAX = 15 * 1024 * 1024;
  let raw = "";
  let responded = false;

  req.on("data", (chunk) => {
    if(responded) return;
    raw += chunk;
    if(raw.length > MAX){
      responded = true;
      try{ json(res, 413, { ok:false, error:"Payload too large. Please use a smaller image (try exporting under ~5MB)." }); }catch(_){ }
      try{ req.pause(); }catch(_){ }
      try{ req.destroy(); }catch(_){ }
    }
  });

  req.on("end", () => {
    if(responded) return;
    let payload = {};
    try{ payload = raw ? JSON.parse(raw) : {}; }
    catch(e){ payload = { _parseError:String(e), _raw:raw }; }
    cb(payload);
  });
}

// -------------------- HTTP server --------------------
const server = http.createServer((req, res) => {
  // CORS preflight
  if(req.method === "OPTIONS"){
    return send(res, 204, {
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"Content-Type",
      "Access-Control-Allow-Methods":"POST,OPTIONS,GET",
    }, "");
  }

  // Health
  if(req.method === "GET" && (req.url === "/health")){
    return send(res, 200, {
      "Content-Type":"text/plain; charset=utf-8",
      "Access-Control-Allow-Origin":"*",
    }, "ok");
  }

  // Static uploads (inventory images)
  if(req.method === "GET" && req.url && req.url.startsWith("/uploads/")){
    const rel = decodeURIComponent(req.url.replace(/^\/uploads\//, ""));
    const safe = rel.replace(/[^a-z0-9._-]/gi, "");
    const full = path.join(UPLOAD_DIR, safe || DEFAULT_IMAGE_FILE);
    const fallback = path.join(UPLOAD_DIR, DEFAULT_IMAGE_FILE);
    try{
      const p = (fs.existsSync(full) ? full : fallback);
      const ext = path.extname(p);
      const buf = fs.readFileSync(p);
      return send(res, 200, {
        "Content-Type": safeContentTypeFromExt(ext),
        "Cache-Control":"public, max-age=86400",
        "Access-Control-Allow-Origin":"*",
      }, buf);
    }catch(e){
      return send(res, 404, {
        "Content-Type":"text/plain; charset=utf-8",
        "Access-Control-Allow-Origin":"*",
      }, "not found");
    }
  }
  // -------------------- Static site --------------------
  // Serve the website (HTML/CSS/JS) from the repo root.
  // NOTE: API routes live under /api/*
  if(req.method === "GET" && req.url && !req.url.startsWith("/api/") && !req.url.startsWith("/uploads/")){
    const PUBLIC_DIR = SITE_ROOT;
    const urlPath = decodeURIComponent(req.url.split("?")[0] || "/");
    const safePath = urlPath.replace(/^\/+/, ""); // remove leading /
    let filePath = safePath ? path.join(PUBLIC_DIR, safePath) : path.join(PUBLIC_DIR, "index.html");

    // If someone hits "/" or a directory, serve index.html
    try{
      if(urlPath === "/" || urlPath.endsWith("/")){
        filePath = path.join(PUBLIC_DIR, "index.html");
      }else{
        // If no extension and an .html file exists, serve that (e.g. "/services" -> "services.html")
        if(!path.extname(filePath)){
          const htmlPath = filePath + ".html";
          if(fs.existsSync(htmlPath)) filePath = htmlPath;
        }
      }

      // Prevent directory traversal
      const resolved = path.resolve(filePath);
      if(!resolved.startsWith(path.resolve(PUBLIC_DIR))){
        return send(res, 403, {"Content-Type":"text/plain; charset=utf-8"}, "Forbidden");
      }
      if(!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()){
        return send(res, 404, {"Content-Type":"text/plain; charset=utf-8"}, "Not Found");
      }

      const ext = path.extname(resolved).toLowerCase();
      const MIME = {
        ".html":"text/html; charset=utf-8",
        ".css":"text/css; charset=utf-8",
        ".js":"application/javascript; charset=utf-8",
        ".json":"application/json; charset=utf-8",
        ".png":"image/png",
        ".jpg":"image/jpeg",
        ".jpeg":"image/jpeg",
        ".webp":"image/webp",
        ".svg":"image/svg+xml",
        ".ico":"image/x-icon",
        ".txt":"text/plain; charset=utf-8"
      };
      const ct = MIME[ext] || "application/octet-stream";
      const body = fs.readFileSync(resolved);
      return send(res, 200, {"Content-Type": ct}, body);
    }catch(e){
      console.error("[STATIC] error", e);
      return send(res, 500, {"Content-Type":"text/plain; charset=utf-8"}, "Server Error");
    }
  }



  // ✅ Load schedule table
  // Returns the authoritative server schedule (booked + pending)
  if(req.method === "GET" && req.url === "/api/schedule"){
    return json(res, 200, { ok:true, booked: BOOKED, pending: PENDING });
  }

  // ✅ Load availability (weekly + blocked slots)
  if(req.method === "GET" && req.url === "/api/availability"){
    return json(res, 200, { ok:true, availability: AVAILABILITY });
  }

  // ✅ Replace availability (admin)
  if(req.method === "POST" && req.url === "/api/availability/set"){
    return readBodyJson(req, res, async (payload)=>{
      const next = normalizeAvailability(payload?.availability ?? payload);
      AVAILABILITY = next;
      persist();
      console.log(`\n[AVAIL] set weekly+blocks  blocksDays=${Object.keys(AVAILABILITY.blocks||{}).length}`);
      return json(res, 200, { ok:true });
    });
  }

  // ✅ Load inventory
  if(req.method === "GET" && req.url === "/api/inventory"){
    return json(res, 200, { ok:true, items: INVENTORY });
  }

  // ✅ Create/update inventory item (admin)
  // Payload:
  // { item: {...}, imageDataUrl?: "data:image/png;base64,...", imageName?: "..." }
  if(req.method === "POST" && req.url === "/api/inventory/upsert"){
    return readBodyJson(req, res, (payload)=>{
      const rawItem = payload?.item ?? payload;
      let item = normalizeInventoryItem(rawItem);

      // If an image was uploaded, save it and set imagePath
      const imageDataUrl = payload?.imageDataUrl || payload?.image || payload?.imageBase64;
      if(imageDataUrl){
        item.imagePath = saveUploadedImage({
          dataUrl: imageDataUrl,
          filenameHint: payload?.imageName || rawItem?.imageName || "upload",
          id: item.id
        });
      }else{
        // If no image provided and no previous imagePath, ensure default
        if(!item.imagePath) item.imagePath = `/uploads/${DEFAULT_IMAGE_FILE}`;
      }

      const idx = INVENTORY.findIndex(x => x.id === item.id);
      if(idx >= 0) INVENTORY[idx] = item;
      else INVENTORY.push(item);

      persist();
      console.log(`\n[INV] upsert id=${item.id} title="${item.title}"`);
      return json(res, 200, { ok:true, item });
    });
  }

  // ✅ Delete inventory item (admin)
  if(req.method === "POST" && req.url === "/api/inventory/delete"){
    return readBodyJson(req, res, (payload)=>{
      const id = String(payload?.id || "");
      if(!id) return json(res, 400, { ok:false, error:"Missing id" });

      const idx = INVENTORY.findIndex(x => x.id === id);
      if(idx < 0) return json(res, 404, { ok:false, error:"Not found" });

      const item = INVENTORY[idx];
      INVENTORY.splice(idx, 1);

      // Best-effort: delete the image file if it's not the default
      try{
        const p = String(item?.imagePath || "");
        if(p.startsWith("/uploads/") && !p.endsWith(`/${DEFAULT_IMAGE_FILE}`)){
          const rel = p.replace(/^\/uploads\//, "");
          const safe = rel.replace(/[^a-z0-9._-]/gi, "");
          const full = path.join(UPLOAD_DIR, safe);
          if(full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) fs.unlinkSync(full);
        }
      }catch(_){ }

      persist();
      console.log(`\n[INV] delete id=${id}`);
      return json(res, 200, { ok:true });
    });
  }

  // ✅ Load gallery
  if(req.method === "GET" && req.url === "/api/gallery"){
    return json(res, 200, { ok:true, photos: GALLERY });
  }

  // ✅ Add a gallery photo (admin)
  // Payload: { caption?, imageDataUrl, imageName? }
  if(req.method === "POST" && req.url === "/api/gallery/add"){
    return readBodyJson(req, res, (payload)=>{
      const caption = String(payload?.caption || "").trim();
      const imageDataUrl = payload?.imageDataUrl || payload?.image || payload?.imageBase64;
      if(!imageDataUrl) return json(res, 400, { ok:false, error:"Missing imageDataUrl" });

      const id = makeId();
      const imagePath = saveUploadedImage({
        dataUrl: imageDataUrl,
        filenameHint: payload?.imageName || "gallery",
        id,
        prefix: "gal"
      });

      const item = { id, imagePath, caption, createdISO: nowStamp() };
      GALLERY.unshift(item);
      persist();
      console.log(`\n[GALLERY] add id=${id} path=${imagePath}`);
      return json(res, 200, { ok:true, photo: item });
    });
  }

  // ✅ Delete gallery photo (admin)
  if(req.method === "POST" && req.url === "/api/gallery/delete"){
    return readBodyJson(req, res, (payload)=>{
      const id = String(payload?.id || "");
      if(!id) return json(res, 400, { ok:false, error:"Missing id" });

      const idx = GALLERY.findIndex(x => x.id === id);
      if(idx < 0) return json(res, 404, { ok:false, error:"Not found" });

      const photo = GALLERY[idx];
      GALLERY.splice(idx, 1);

      // Best-effort: delete the image file if it's not the default
      try{
        const p = String(photo?.imagePath || "");
        if(p.startsWith("/uploads/") && !p.endsWith(`/${DEFAULT_IMAGE_FILE}`)){
          const rel = p.replace(/^\/uploads\//, "");
          const safe = rel.replace(/[^a-z0-9._-]/gi, "");
          const full = path.join(UPLOAD_DIR, safe);
          if(full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) fs.unlinkSync(full);
        }
      }catch(_){ }

      persist();
      console.log(`\n[GALLERY] delete id=${id}`);
      return json(res, 200, { ok:true });
    });
  }

  // ✅ Receive contact message (stores to data/messages.json and emails service inbox if configured)
// Payload: { name, email, type, description }
  if(req.method === "POST" && req.url === "/api/contact"){
    return readBodyJson(req, res, (payload)=>{
      const msg = {
        id: makeId(),
        name: String(payload?.name || "").trim(),
        email: String(payload?.email || "").trim(),
        type: String(payload?.type || "").trim(),
        description: String(payload?.description || "").trim(),
        createdISO: nowStamp()
      };
      MESSAGES.unshift(msg);
      persist();

      console.log("\n[CONTACT] new message:");
      console.log(msg);

      // Fire-and-forget email (we do not block the HTTP response on email success)
      // If you want to block until email sends, we can switch this behavior.
      sendContactEmail(msg).then((r)=>{
        if(r?.ok) console.log("[MAIL] contact email sent");
        else if(r?.skipped) console.log("[MAIL] skipped (mailer not configured)");
        else console.log("[MAIL] failed", r?.error || "");
      });

      return json(res, 200, { ok:true });
    });
  }

  // ✅ Create a new pending request
  if(req.method === "POST" && req.url === "/api/schedule/request"){
    return readBodyJson(req, res, async (payload)=>{
      const appt = normalizeAppt(payload, "pending");
      if(!appt.startISO){
        return json(res, 400, { ok:false, error:"Missing startISO" });
      }
      if(hasStart(BOOKED, appt.startISO)){
        return json(res, 409, { ok:false, error:"Slot already booked" });
      }
      if(hasStart(PENDING, appt.startISO)){
        return json(res, 409, { ok:false, error:"Slot already pending" });
      }
      PENDING.push(appt);
      persist();
      console.log(`\n[SCHEDULE] pending request  ${appt.startISO}  id=${appt.id}`);
      const mailRes = await sendScheduleRequestEmail(appt);
      if(mailRes?.skipped) console.log("[MAIL] skipped (mailer not configured)");
      else if(mailRes?.ok) console.log("[MAIL] booking request email sent");
      else console.log("[MAIL] failed", mailRes?.error || "");
      return json(res, 200, { ok:true, id: appt.id, pendingCount: PENDING.length });
    });
  }

  // ✅ Book a job immediately (admin)
  if(req.method === "POST" && req.url === "/api/schedule/book"){
    return readBodyJson(req, res, (payload)=>{
      const appt = normalizeAppt(payload, "accepted");
      if(!appt.startISO){
        return json(res, 400, { ok:false, error:"Missing startISO" });
      }
      if(hasStart(BOOKED, appt.startISO)){
        return json(res, 409, { ok:false, error:"Slot already booked" });
      }
      // If it existed as pending, remove that pending entry
      PENDING = PENDING.filter(x => x.startISO !== appt.startISO);
      BOOKED.push(appt);
      persist();
      console.log(`\n[SCHEDULE] booked job       ${appt.startISO}  id=${appt.id}`);
      return json(res, 200, { ok:true, id: appt.id, bookedCount: BOOKED.length });
    });
  }

  // ✅ Accept a pending request (move pending -> booked)
  if(req.method === "POST" && req.url === "/api/schedule/accept"){
    return readBodyJson(req, res, (payload)=>{
      const id = String(payload?.id || "");
      if(!id) return json(res, 400, { ok:false, error:"Missing id" });

      const idx = PENDING.findIndex(x => x.id === id);
      if(idx < 0) return json(res, 404, { ok:false, error:"Pending id not found" });

      const reqAppt = PENDING[idx];
      if(hasStart(BOOKED, reqAppt.startISO)){
        // booked already: drop the pending
        PENDING.splice(idx, 1);
        persist();
        return json(res, 409, { ok:false, error:"Slot already booked" });
      }

      PENDING.splice(idx, 1);
      const appt = { ...reqAppt, status:"accepted" };
      BOOKED.push(appt);
      persist();
      console.log(`\n[SCHEDULE] accepted request ${appt.startISO}  id=${appt.id}`);
      return json(res, 200, { ok:true, id: appt.id });
    });
  }

  // ✅ Reject a pending request (delete from pending)
  if(req.method === "POST" && req.url === "/api/schedule/reject"){
    return readBodyJson(req, res, (payload)=>{
      const id = String(payload?.id || "");
      if(!id) return json(res, 400, { ok:false, error:"Missing id" });
      const before = PENDING.length;
      PENDING = PENDING.filter(x => x.id !== id);
      if(PENDING.length === before) return json(res, 404, { ok:false, error:"Pending id not found" });
      persist();
      console.log(`\n[SCHEDULE] rejected request id=${id}`);
      return json(res, 200, { ok:true });
    });
  }

  // ✅ Cancel a booked job (delete from booked)
  if(req.method === "POST" && req.url === "/api/schedule/cancel"){
    return readBodyJson(req, res, (payload)=>{
      const id = String(payload?.id || "");
      if(!id) return json(res, 400, { ok:false, error:"Missing id" });
      const before = BOOKED.length;
      BOOKED = BOOKED.filter(x => x.id !== id);
      if(BOOKED.length === before) return json(res, 404, { ok:false, error:"Booked id not found" });
      persist();
      console.log(`\n[SCHEDULE] canceled booking id=${id}`);
      return json(res, 200, { ok:true });
    });
  }

  return send(res, 404, {
    "Content-Type":"text/plain; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
  }, "not found");
});

// WebSocket kept for later; no-op for now
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  console.log("[WS] client connected");
  ws.on("close", () => console.log("[WS] client disconnected"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[NET] listening on", PORT);
  console.log(`[DATA] booked=${BOOKED.length} pending=${PENDING.length}  dir=${DATA_DIR}`);
});
