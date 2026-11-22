const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const QRCode = require("qrcode");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "salon123";
const DB_FILE = path.join(__dirname, "data.json");
const DEMO_OTP = "123456";
const CHECKIN_OPEN_HOUR = 10;
const CHECKIN_CLOSE_HOUR = 23;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function initialDb() {
  return {
    customers: {},
    settings: { dailyCode: "4821", codeUpdatedAt: new Date().toISOString() },
    activity: []
  };
}
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return initialDb();
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    console.error("Could not read data.json:", e.message);
    return initialDb();
  }
}
let db = readDb();
function saveDb() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}
const sessions = new Map();
const otpChallenges = new Map();

function token() { return crypto.randomBytes(32).toString("hex"); }
function indiaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour), minute: Number(o.minute) };
}
function addMonths(dateString, months) {
  const [y, m, d] = dateString.split("-").map(Number);
  const targetMonth = m - 1 + months;
  const targetYear = y + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
  return `${targetYear}-${String(monthIndex + 1).padStart(2,"0")}-${String(Math.min(d,lastDay)).padStart(2,"0")}`;
}
function newCard() {
  return { id: crypto.randomUUID(), stamps: [], startedAt: null, status: "active", reward: null, createdAt: new Date().toISOString() };
}
function log(type, phone, detail = {}) {
  db.activity.unshift({ id: crypto.randomUUID(), type, phone, detail, at: new Date().toISOString(), indiaDate: indiaNow().date });
  db.activity = db.activity.slice(0, 500);
}
function expireIfNeeded(customer) {
  const card = customer.activeCard;
  if (!card || !card.startedAt) return false;
  const today = indiaNow().date;
  if (today > addMonths(card.startedAt, 3)) {
    card.status = "expired";
    card.expiredAt = today;
    customer.completedCards.push(card);
    customer.activeCard = newCard();
    log("card_expired", customer.phone, { cardId: card.id });
    saveDb();
    return true;
  }
  return false;
}
function safeCustomer(c) {
  expireIfNeeded(c);
  return {
    phone: c.phone,
    createdAt: c.createdAt,
    activeCard: c.activeCard,
    completedCards: c.completedCards,
    lastVisit: c.activeCard.stamps.at(-1)?.date || null
  };
}
function requireCustomer(req, res, next) {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const s = sessions.get(t);
  if (!s || s.role !== "customer") return res.status(401).json({ error: "Please log in again." });
  const c = db.customers[s.phone];
  if (!c) return res.status(401).json({ error: "Customer account not found." });
  req.customer = c;
  next();
}
function requireAdmin(req, res, next) {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const s = sessions.get(t);
  if (!s || s.role !== "admin") return res.status(401).json({ error: "Admin session expired. Log in again." });
  next();
}
function localUrls() {
  const result = [];
  const nets = os.networkInterfaces();
  for (const [name, entries] of Object.entries(nets)) {
    for (const n of entries || []) {
      if (n.family === "IPv4" && !n.internal) result.push({ name, url: `http://${n.address}:${PORT}` });
    }
  }
  return result;
}

app.get("/api/info", (req, res) => res.json({ localUrls: localUrls(), port: PORT }));
app.post("/api/auth/send-otp", (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number." });
  const challenge = token();
  otpChallenges.set(challenge, { phone, expires: Date.now() + 5 * 60 * 1000 });
  res.json({ challenge, demoOtp: DEMO_OTP, message: "Demo OTP created. No SMS was sent." });
});
app.post("/api/auth/verify-otp", (req, res) => {
  const challenge = otpChallenges.get(String(req.body.challenge || ""));
  if (!challenge || challenge.expires < Date.now()) return res.status(400).json({ error: "Code expired. Request a new OTP." });
  if (String(req.body.otp || "") !== DEMO_OTP) return res.status(400).json({ error: "Incorrect demo OTP." });
  otpChallenges.delete(String(req.body.challenge));
  let c = db.customers[challenge.phone];
  if (!c) {
    c = db.customers[challenge.phone] = {
      phone: challenge.phone, createdAt: new Date().toISOString(),
      activeCard: newCard(), completedCards: []
    };
    log("customer_created", challenge.phone);
    saveDb();
  }
  expireIfNeeded(c);
  const t = token();
  sessions.set(t, { role: "customer", phone: c.phone });
  res.json({ token: t, customer: safeCustomer(c) });
});
app.get("/api/me", requireCustomer, (req, res) => res.json({ customer: safeCustomer(req.customer) }));
app.post("/api/auth/logout", (req, res) => {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  sessions.delete(t);
  res.json({ ok: true });
});
app.post("/api/checkin", requireCustomer, (req, res) => {
  const c = req.customer;
  expireIfNeeded(c);
  const now = indiaNow();
  if (now.hour < CHECKIN_OPEN_HOUR || now.hour >= CHECKIN_CLOSE_HOUR)
    return res.status(400).json({ error: "Check-in is available from 10:00 AM to 11:00 PM IST." });
  const card = c.activeCard;
  if (card.stamps.some(s => s.date === now.date))
    return res.status(409).json({ error: "You have already collected today's stamp." });
  if (String(req.body.code || "").trim() !== db.settings.dailyCode)
    return res.status(400).json({ error: "Incorrect salon code. Ask the salon team for today's code." });
  if (!card.startedAt) card.startedAt = now.date;
  if (card.stamps.length >= 5) return res.status(409).json({ error: "This card is complete. Claim your reward first." });
  card.stamps.push({ date: now.date, at: new Date().toISOString() });
  log("stamp_added", c.phone, { cardId: card.id, stampNumber: card.stamps.length });
  saveDb();
  res.json({ customer: safeCustomer(c), completed: card.stamps.length === 5 });
});
app.post("/api/rewards/claim", requireCustomer, (req, res) => {
  const c = req.customer;
  expireIfNeeded(c);
  const card = c.activeCard;
  const reward = String(req.body.reward || "");
  if (card.stamps.length !== 5) return res.status(400).json({ error: "Collect all five stamps before claiming a reward." });
  if (!["Basic haircut", "Beard trim / set"].includes(reward)) return res.status(400).json({ error: "Choose one of the available rewards." });
  card.status = "redeemed";
  card.reward = reward;
  card.completedAt = indiaNow().date;
  card.redemptionId = crypto.randomBytes(4).toString("hex").toUpperCase();
  c.completedCards.push(card);
  c.activeCard = newCard();
  log("reward_claimed", c.phone, { reward, redemptionId: card.redemptionId });
  saveDb();
  res.json({ customer: safeCustomer(c), redemptionId: card.redemptionId });
});
app.post("/api/admin/login", (req, res) => {
  if (String(req.body.password || "") !== ADMIN_PASSWORD) return res.status(401).json({ error: "Incorrect admin password." });
  const t = token();
  sessions.set(t, { role: "admin" });
  res.json({ token: t });
});
app.get("/api/admin/overview", requireAdmin, (req, res) => {
  Object.values(db.customers).forEach(expireIfNeeded);
  const customers = Object.values(db.customers);
  res.json({
    totalCustomers: customers.length,
    totalStamps: db.activity.filter(a => a.type === "stamp_added").length,
    completedCards: customers.reduce((n,c)=>n+c.completedCards.filter(x=>x.status==="redeemed").length,0),
    dailyCode: db.settings.dailyCode,
    codeUpdatedAt: db.settings.codeUpdatedAt,
    customers: customers.map(safeCustomer).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),
    activity: db.activity.slice(0,30)
  });
});
app.post("/api/admin/rotate-code", requireAdmin, (req, res) => {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  db.settings.dailyCode = code;
  db.settings.codeUpdatedAt = new Date().toISOString();
  log("daily_code_rotated", "ADMIN");
  saveDb();
  res.json({ dailyCode: code });
});
app.get("/api/admin/qr", requireAdmin, async (req, res) => {
  const base = String(req.query.base || "").replace(/\/+$/, "");
  if (!/^http:\/\/(localhost|127\.0\.0\.1|[\d.]+):\d+$/.test(base)) return res.status(400).json({ error: "Choose a local network URL first." });
  try {
    const dataUrl = await QRCode.toDataURL(base, { width: 360, margin: 2, color: { dark: "#191919", light: "#ffffff" } });
    res.json({ dataUrl, url: base });
  } catch (e) { res.status(500).json({ error: "Could not generate QR code." }); }
});
app.get("/api/admin/export", requireAdmin, (req, res) => {
  res.setHeader("Content-Disposition", 'attachment; filename="saurashtra-loyalty-backup.json"');
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(db, null, 2));
});
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log("\nSAURASHTRA MEN'S SALON — LOCAL TEST SERVER");
  console.log(`Laptop: http://localhost:${PORT}`);
  localUrls().forEach(x => console.log(`Phone (${x.name}): ${x.url}`));
  console.log(`Admin: http://localhost:${PORT}/admin`);
  console.log("Demo customer OTP: 123456 | Daily salon code: 4821");
  console.log(`Admin password: ${ADMIN_PASSWORD} (change via ADMIN_PASSWORD environment variable)\n`);
});
