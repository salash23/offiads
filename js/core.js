/* OFFIADS core — données (localStorage + IndexedDB), auth, tarification, wallet, helpers UI.
   Toute la persistance passe par ce fichier : pour migrer vers Supabase, on ne change que ici. */
(function (w) {
'use strict';
const KEY = 'offiads_db_v1', SES = 'offiads_session_v1';

/* ---------- Géographie : 69 wilayas, 5 régions (js/geo.js) ---------- */
const G = w.GEO;
const REGIONS = G.RW, WILAYAS = G.REG;
const WILAYA_LIST = G.WL.slice(); // ordre officiel (code 01 → 69)
const isSud = r => /^Sud/.test(r);

/* ---------- Paramètres de tarification par défaut (rapport de tarification) ---------- */
const DEFAULTS = {
  cpm: 500, fee: 2000,
  zone: { national: 1, wilaya: 1.2, regions: { Centre: 1.1, Est: 1.1, Ouest: 1.1, 'Sud-Est': 1.3, 'Sud-Ouest': 1.3 } },
  format: { image: 1, video: 1.5 },
  networks: [
    { id: 'N1', name: 'Logiciel partenaire 1', coef: 1.1 },
    { id: 'N2', name: 'Logiciel partenaire 2', coef: 1.1 },
    { id: 'N3', name: 'Logiciel partenaire 3', coef: 1.1 }
  ],
  maxFreq: 20, minBudget: 1000, minPharm: 10, maxPharm: 500,
  payInfo: 'Coordonnées bancaires : à renseigner dans Admin › Tarification.'
};
const DURATIONS = [7, 15, 30, 60, 90];

/* ---------- Utilitaires ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('fr-FR');
const da = n => fmt(Math.round(n || 0)) + ' DA';
const dt = t => t ? new Date(t).toLocaleDateString('fr-FR') : '—';
const dtt = t => t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const uid = p => p + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- Base de données locale ---------- */
let db = null;
function load() { try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; } return db; }
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
function D() { return load() || db; }
function mutate(fn) { load(); const d = db, r = fn(d); db = d; save(); return r; } // db = d : les lectures D() imbriquées ne doivent pas écraser l'objet modifié

async function hash(pw, salt) {
  const d = new TextEncoder().encode(salt + ':' + pw);
  if (w.crypto && w.crypto.subtle) {
    const b = await w.crypto.subtle.digest('SHA-256', d);
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; d.forEach(c => { h = ((h << 5) + h + c) >>> 0; }); return 'x' + h;
}

function seedPharmacies() {
  const big = { Alger: 40, Oran: 25, Constantine: 18, 'Sétif': 16, Annaba: 14, Blida: 12, 'Tizi Ouzou': 12, 'Béjaïa': 10, Batna: 10, Tlemcen: 10 };
  const names = ['El Chifa','Ibn Sina','Ennour','El Amel','Errahma','Ibn Rochd','El Baraka','Essalam','El Wiam','Ibn Khaldoun','Ennadjah','El Hayat','El Chorouk','Ibn Zohr','El Amane'];
  const out = []; let i = 0;
  Object.keys(WILAYAS).forEach(wn => {
    const reg = WILAYAS[wn], n = big[wn] || (isSud(reg) ? 3 : 6);
    for (let k = 0; k < n; k++) {
      i++;
      out.push({ id: 'PH-' + String(i).padStart(4, '0'), name: 'Pharmacie ' + names[(i * 7 + k) % names.length], wilaya: wn, region: reg, network: 'N' + (i % 3 + 1), active: i % 9 !== 0 });
    }
  });
  return out;
}

async function init() {
  if (load() && db.version === 2) return db;
  if (db && db.version === 1) { // migration : 69 wilayas / 5 régions, comptes et campagnes conservés
    db.version = 2; db.pharmacies = seedPharmacies();
    db.settings.zone.regions = Object.assign({}, DEFAULTS.zone.regions, { 'Sud-Est': db.settings.zone.regions.Sud || 1.3, 'Sud-Ouest': db.settings.zone.regions.Sud || 1.3 });
    delete db.settings.zone.regions.Sud;
    db.campaigns.forEach(c => { if (c.region === 'Sud') c.region = 'Sud-Est'; });
    save(); return db;
  }
  db = {
    version: 2, settings: JSON.parse(JSON.stringify(DEFAULTS)), pharmacies: seedPharmacies(),
    users: [], campaigns: [], transactions: [], logs: [], messages: [], seq: { invoice: 0 }
  };
  const mk = async (id, email, pw, role, name, company, bal) => db.users.push({
    id, email, salt: id, hash: await hash(pw, id), role, name, company, phone: '', status: 'active', created: Date.now(),
    wallet: { available: bal, reserved: 0, spent: 0 }
  });
  await mk('U-ADMIN', 'admin@offiads.dz', 'Admin@2026', 'admin', 'Administrateur OFFIADS', 'OFFIADS', 0);
  await mk('U-DEMO', 'demo@offiads.dz', 'Demo@2026', 'advertiser', 'Annonceur Démo', 'Laboratoire Démo', 120000);
  db.transactions.push({ id: uid('T'), userId: 'U-DEMO', type: 'recharge', amount: 120000, label: 'Crédit initial (compte démo)', status: 'ok', date: Date.now() });
  save();
  return db;
}

/* ---------- Auth ---------- */
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const validPw = p => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
function log(userId, action) {
  db.logs.unshift({ id: uid('L'), userId, action, date: Date.now() });
  if (db.logs.length > 400) db.logs.length = 400;
}
async function register(o) {
  const email = (o.email || '').trim().toLowerCase();
  if (!(o.name || '').trim() || !(o.company || '').trim()) throw new Error('Nom et entreprise obligatoires.');
  if (!validEmail(email)) throw new Error('Adresse e-mail invalide.');
  if (!validPw(o.password)) throw new Error('Mot de passe : 8 caractères minimum, avec lettres et chiffres.');
  load();
  if (db.users.some(u => u.email === email)) throw new Error('Un compte existe déjà avec cet e-mail.');
  const id = uid('U');
  const u = { id, email, salt: id, hash: await hash(o.password, id), role: 'advertiser', name: o.name.trim(), company: o.company.trim(), phone: (o.phone || '').trim(), status: 'active', created: Date.now(), wallet: { available: 0, reserved: 0, spent: 0 } };
  db.users.push(u); log(id, 'Création du compte annonceur'); save();
  localStorage.setItem(SES, JSON.stringify({ id }));
  return u;
}
async function login(email, pw) {
  email = (email || '').trim().toLowerCase(); load();
  const u = db.users.find(x => x.email === email);
  if (!u || u.hash !== await hash(pw || '', u.salt)) throw new Error('E-mail ou mot de passe incorrect.');
  if (u.status === 'suspended') throw new Error('Ce compte est suspendu. Contactez OFFIADS.');
  localStorage.setItem(SES, JSON.stringify({ id: u.id })); log(u.id, 'Connexion'); save();
  return u;
}
function me() {
  let s; try { s = JSON.parse(localStorage.getItem(SES)); } catch (e) { s = null; }
  if (!s) return null;
  const u = D().users.find(x => x.id === s.id);
  return u && u.status !== 'suspended' ? u : null;
}
function logout() { localStorage.removeItem(SES); location.href = 'login.html'; }
function guard(role) {
  const u = me();
  if (!u) { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.hash)); return null; }
  if (u.role !== role) { location.replace(u.role === 'admin' ? 'admin.html' : 'app.html'); return null; }
  return u;
}
async function changePassword(userId, oldPw, newPw) {
  load(); const u = db.users.find(x => x.id === userId);
  if (!u || u.hash !== await hash(oldPw || '', u.salt)) throw new Error('Mot de passe actuel incorrect.');
  if (!validPw(newPw)) throw new Error('Nouveau mot de passe : 8 caractères minimum, avec lettres et chiffres.');
  u.hash = await hash(newPw, u.salt); log(userId, 'Changement de mot de passe'); save();
}
async function resetPassword(email, newPw) { // mode local uniquement (pas d'e-mail envoyé)
  email = (email || '').trim().toLowerCase(); load();
  const u = db.users.find(x => x.email === email);
  if (!u) throw new Error('Aucun compte avec cet e-mail.');
  if (u.role === 'admin') throw new Error("Le mot de passe administrateur ne peut pas être réinitialisé ici.");
  if (!validPw(newPw)) throw new Error('Nouveau mot de passe : 8 caractères minimum, avec lettres et chiffres.');
  u.hash = await hash(newPw, u.salt); log(u.id, 'Réinitialisation du mot de passe'); save();
}
function updateProfile(userId, o) {
  return mutate(d => { const u = d.users.find(x => x.id === userId); u.name = o.name.trim(); u.company = o.company.trim(); u.phone = (o.phone || '').trim(); log(userId, 'Profil modifié'); return u; });
}

/* ---------- Tarification (rapport de tarification) ---------- */
function eligible(o) {
  return D().pharmacies.filter(p => p.active &&
    (!o.network || o.network === 'all' || p.network === o.network) &&
    (o.zoneMode === 'national' || (o.zoneMode === 'region' && p.region === o.region) || (o.zoneMode === 'wilaya' && p.wilaya === o.wilaya)));
}
function price(o, s) {
  s = s || D().settings;
  const zc = o.zoneMode === 'national' ? s.zone.national : o.zoneMode === 'wilaya' ? s.zone.wilaya : (s.zone.regions[o.region] || 1);
  const net = (s.networks || []).find(n => n.id === o.network);
  const nc = o.network && o.network !== 'all' && net ? net.coef : 1;
  const fc = s.format[o.format] || 1;
  const cpm = Math.round(s.cpm * zc * fc * nc);
  const imp = Math.round(o.pharmacies * o.freq * o.days);
  const budget = Math.round(imp / 1000 * cpm);
  return { zc, fc, nc, cpm, imp, budget, fee: s.fee, total: budget + s.fee };
}

/* ---------- Wallet & campagnes ---------- */
function addTx(d, userId, type, amount, label, status, extra) {
  const t = Object.assign({ id: uid('T'), userId, type, amount, label, status: status || 'ok', date: Date.now() }, extra || {});
  d.transactions.unshift(t); return t;
}
function requestRecharge(userId, amount, method, ref) {
  amount = Math.round(Number(amount));
  if (!(amount >= 1000)) throw new Error('Montant minimum : 1 000 DA.');
  return mutate(d => { log(userId, 'Demande de recharge ' + da(amount)); return addTx(d, userId, 'recharge', amount, 'Recharge par ' + method + (ref ? ' — réf. ' + ref : ''), 'pending', { method, ref }); });
}
function resolveRecharge(txId, ok, adminId) {
  return mutate(d => {
    const t = d.transactions.find(x => x.id === txId && x.status === 'pending');
    if (!t) throw new Error('Demande introuvable ou déjà traitée.');
    t.status = ok ? 'ok' : 'rejected'; t.date = Date.now();
    if (ok) d.users.find(u => u.id === t.userId).wallet.available += t.amount;
    log(adminId, (ok ? 'Recharge confirmée ' : 'Recharge refusée ') + da(t.amount)); return t;
  });
}
function manualCredit(userId, amount, adminId) {
  amount = Math.round(Number(amount));
  if (!(amount > 0)) throw new Error('Montant invalide.');
  return mutate(d => { d.users.find(u => u.id === userId).wallet.available += amount; addTx(d, userId, 'recharge', amount, 'Crédit manuel par OFFIADS'); log(adminId, 'Crédit manuel ' + da(amount)); });
}
function createCampaign(userId, o, id) {
  return mutate(d => {
    const s = d.settings, u = d.users.find(x => x.id === userId);
    if (!u || u.status !== 'active') throw new Error('Compte inactif.');
    if (!(o.name || '').trim()) throw new Error('Donnez un nom à la campagne.');
    if (o.zoneMode === 'wilaya' && !WILAYAS[o.wilaya]) throw new Error('Wilaya invalide.');
    if (o.zoneMode === 'region' && !REGIONS[o.region]) throw new Error('Région invalide.');
    const avail = eligible(o).length;
    if (avail < s.minPharm) throw new Error('Pas assez de pharmacies actives dans cette zone (minimum ' + s.minPharm + ').');
    if (!(o.pharmacies >= s.minPharm && o.pharmacies <= Math.min(s.maxPharm, avail))) throw new Error('Nombre de pharmacies hors limites (' + s.minPharm + ' à ' + Math.min(s.maxPharm, avail) + ').');
    if (!(o.freq >= 1 && o.freq <= s.maxFreq)) throw new Error('Fréquence maximale : ' + s.maxFreq + ' / jour.');
    if (!DURATIONS.includes(o.days)) throw new Error('Durée invalide.');
    const p = price(o, s);
    if (p.budget < s.minBudget) throw new Error('Budget publicitaire minimum : ' + da(s.minBudget) + ' (actuel : ' + da(p.budget) + ').');
    if (u.wallet.available < p.total) throw new Error('Solde insuffisant : ' + da(p.total) + ' requis, ' + da(u.wallet.available) + ' disponibles.');
    u.wallet.available -= p.total; u.wallet.reserved += p.budget;
    d.seq.invoice++;
    const c = Object.assign({}, o, {
      id: id || uid('C'), userId, cpm: p.cpm, imp: p.imp, budget: p.budget, fee: p.fee, total: p.total,
      status: 'pending', created: Date.now(), spent: 0, impressions: 0, clicks: 0, daily: {}, byWilaya: {},
      invoiceNo: 'OFF-' + new Date().getFullYear() + '-' + String(d.seq.invoice).padStart(4, '0')
    });
    d.campaigns.unshift(c);
    addTx(d, userId, 'fee', -p.fee, 'Frais fixe — ' + c.name, 'ok', { ref: c.id });
    addTx(d, userId, 'reserve', -p.budget, 'Budget réservé — ' + c.name, 'ok', { ref: c.id });
    log(userId, 'Campagne créée : ' + c.name); return c;
  });
}
function endC(d, c, why, st) { // clôture + libération du budget non consommé
  const u = d.users.find(x => x.id === c.userId), rest = Math.max(0, c.budget - c.spent);
  u.wallet.reserved = Math.max(0, u.wallet.reserved - rest); u.wallet.available += rest;
  if (rest >= 1) addTx(d, c.userId, 'release', Math.round(rest), 'Budget non consommé libéré — ' + c.name, 'ok', { ref: c.id });
  c.status = st || 'ended'; c.endedAt = Date.now(); c.endReason = why;
}
function campaignAction(kind, id, actorId, reason) {
  return mutate(d => {
    const c = d.campaigns.find(x => x.id === id);
    if (!c) throw new Error('Campagne introuvable.');
    const actor = d.users.find(x => x.id === actorId), isAdmin = actor && actor.role === 'admin';
    if (!isAdmin && c.userId !== actorId) throw new Error('Action non autorisée.');
    const st = c.status, u = d.users.find(x => x.id === c.userId), now = Date.now();
    if (kind === 'approve' || kind === 'reject') {
      if (!isAdmin) throw new Error('Réservé à OFFIADS.'); if (st !== 'pending') throw new Error('Campagne déjà traitée.');
      if (kind === 'approve') { c.status = 'active'; c.startAt = now; c.endAt = now + c.days * 864e5; }
      else {
        if (!(reason || '').trim()) throw new Error('Indiquez le motif du rejet.');
        u.wallet.reserved = Math.max(0, u.wallet.reserved - c.budget); u.wallet.available += c.total;
        addTx(d, c.userId, 'refund', c.total, 'Remboursement (campagne rejetée) — ' + c.name, 'ok', { ref: c.id }); c.status = 'rejected'; c.reason = reason.trim();
      }
    } else if (kind === 'cancel') {
      if (st !== 'pending') throw new Error('Seule une campagne en attente peut être annulée.');
      u.wallet.reserved = Math.max(0, u.wallet.reserved - c.budget); u.wallet.available += c.total;
      addTx(d, c.userId, 'refund', c.total, 'Remboursement (campagne annulée) — ' + c.name, 'ok', { ref: c.id }); c.status = 'cancelled';
    } else if (kind === 'pause') {
      if (st !== 'active') throw new Error('Campagne non active.'); c.status = 'paused'; c.pausedAt = now;
    } else if (kind === 'resume') {
      if (st !== 'paused') throw new Error('Campagne non en pause.'); c.endAt += now - c.pausedAt; c.status = 'active'; delete c.pausedAt;
    } else if (kind === 'stop') {
      if (st !== 'active' && st !== 'paused') throw new Error('Campagne non en cours.'); endC(d, c, isAdmin ? 'Arrêtée par OFFIADS' : 'Arrêtée par l\'annonceur');
    } else throw new Error('Action inconnue.');
    log(actorId, kind + ' : ' + c.name); return c;
  });
}
function tick() { // clôture automatique (durée écoulée / budget épuisé)
  load(); let ch = false; const now = Date.now();
  db.campaigns.forEach(c => {
    if (c.status === 'active' && (now >= c.endAt || c.spent >= c.budget - 1e-9)) { endC(db, c, now >= c.endAt ? 'Durée écoulée' : 'Budget épuisé'); ch = true; }
  });
  if (ch) save();
}
function record(cid, pid, kind) { // appelé par le lecteur (player.html)
  load();
  const c = db.campaigns.find(x => x.id === cid), p = db.pharmacies.find(x => x.id === pid);
  if (!c || !p || c.status !== 'active') return false;
  if (Date.now() >= c.endAt) { endC(db, c, 'Durée écoulée'); save(); return false; }
  const day = today(), dd = c.daily[day] || (c.daily[day] = { i: 0, c: 0 });
  if (kind === 'click') { c.clicks++; dd.c++; }
  else {
    const cost = c.cpm / 1000;
    if (c.spent + cost > c.budget + 1e-9) { endC(db, c, 'Budget épuisé'); save(); return false; }
    c.impressions++; dd.i++; c.spent += cost; c.byWilaya[p.wilaya] = (c.byWilaya[p.wilaya] || 0) + 1;
    const u = db.users.find(x => x.id === c.userId); u.wallet.reserved = Math.max(0, u.wallet.reserved - cost); u.wallet.spent += cost;
    if (c.spent >= c.budget - 1e-9) endC(db, c, 'Budget épuisé');
  }
  save(); return true;
}
function pickAd(pid) { // choix de la publicité à afficher pour une pharmacie
  tick(); const d = D(), p = d.pharmacies.find(x => x.id === pid);
  if (!p || !p.active) return null;
  const list = d.campaigns.filter(c => c.status === 'active' && (c.network === 'all' || !c.network || c.network === p.network) &&
    (c.zoneMode === 'national' || (c.zoneMode === 'region' && c.region === p.region) || (c.zoneMode === 'wilaya' && c.wilaya === p.wilaya)));
  if (!list.length) return null;
  list.sort((a, b) => (a.impressions / (a.imp || 1)) - (b.impressions / (b.imp || 1))); // le moins servi d'abord
  return list[0];
}
function simulate(n) { // outil de test admin : génère des affichages réalistes
  tick(); const d = D(); let imp = 0, clk = 0;
  const act = d.campaigns.filter(c => c.status === 'active');
  act.forEach(c => {
    const ph = eligible(c); if (!ph.length) return;
    for (let i = 0; i < n; i++) {
      const p = ph[Math.floor(Math.random() * ph.length)];
      if (!record(c.id, p.id, 'imp')) break; imp++;
      if (Math.random() < 0.03 && record(c.id, p.id, 'click')) clk++;
    }
  });
  return { campaigns: act.length, imp, clk };
}

/* ---------- Autres données ---------- */
function addMessage(o) { return mutate(d => { d.messages.unshift({ id: uid('M'), name: o.name, email: o.email, msg: o.msg, date: Date.now(), read: false }); }); }
function saveSettings(s, adminId) { return mutate(d => { d.settings = s; log(adminId, 'Tarification modifiée'); }); }
function resetSettings(adminId) { return mutate(d => { const pi = d.settings.payInfo; d.settings = JSON.parse(JSON.stringify(DEFAULTS)); d.settings.payInfo = pi; log(adminId, 'Tarification réinitialisée'); }); }
function series(cs, n) {
  const labels = [], imp = [], clk = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    labels.push(k.slice(8) + '/' + k.slice(5, 7));
    imp.push(cs.reduce((s, c) => s + ((c.daily[k] || {}).i || 0), 0)); clk.push(cs.reduce((s, c) => s + ((c.daily[k] || {}).c || 0), 0));
  }
  return { labels, imp, clk };
}
function byRegion(cs) { const m = {}; byWilaya(cs).forEach(x => { const r = WILAYAS[x.label]; if (r) m[r] = (m[r] || 0) + x.value; }); return G.REGS.map(r => ({ label: r, value: m[r] || 0, color: G.RCOL[r] })); }
function pharmByWilaya(list) { const m = {}; (list || D().pharmacies).forEach(p => m[p.wilaya] = (m[p.wilaya] || 0) + 1); return m; }
function byWilaya(cs) { const m = {}; cs.forEach(c => Object.keys(c.byWilaya).forEach(k => m[k] = (m[k] || 0) + c.byWilaya[k])); return Object.keys(m).map(k => ({ label: k, value: m[k] })).sort((a, b) => b.value - a.value); }

/* ---------- Média (IndexedDB) ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('offiads_media', 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const media = {
  put: async (id, blob) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('m', 'readwrite'); t.objectStore('m').put(blob, id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  get: async id => { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction('m').objectStore('m').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); },
  del: async id => { const d = await idb(); return new Promise(res => { const t = d.transaction('m', 'readwrite'); t.objectStore('m').delete(id); t.oncomplete = () => res(); }); },
  thumb: file => new Promise(res => {
    if (!file.type.startsWith('image/')) return res('');
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const r = Math.min(1, 160 / img.width), c = document.createElement('canvas'); c.width = img.width * r; c.height = img.height * r; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .7)); };
    img.onerror = () => res(''); img.src = url;
  }),
  duration: file => new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(v.duration); }; v.onerror = () => res(NaN); v.src = URL.createObjectURL(file); })
};

/* ---------- UI : classes, icônes, toasts, dialogues ---------- */
const K = {
  btn: 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#009668] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#00835b] transition disabled:opacity-50 disabled:cursor-not-allowed',
  btn2: 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition',
  danger: 'inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition',
  mini: 'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition',
  ok: 'inline-flex items-center gap-1 rounded-lg bg-[#009668] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#00835b] transition',
  input: 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-[#009668] focus:outline-none focus:ring-2 focus:ring-[#009668]/20',
  card: 'rounded-2xl border border-slate-100 bg-white p-5 shadow-sm',
  th: 'px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500',
  td: 'px-4 py-3'
};
const ICONS = {
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10', plus: 'M12 5v14M5 12h14', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M18 20V10M12 20V4M6 20v-6', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8', card: 'M1 4h22v16H1z M1 10h22',
  set: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
  act: 'M22 12h-4l-3 9L9 3l-3 9H2', mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6', out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', check: 'M20 6L9 17l-5-5', x: 'M18 6L6 18M6 6l12 12', pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  play: 'M5 3l14 9-14 9z', stop: 'M3 3h18v18H3z', dl: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3', trash: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6',
  menu: 'M3 12h18M3 6h18M3 18h18', print: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', play2: 'M5 3l14 9-14 9z',
  wallet: 'M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7 M16 14h.01', edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3'
};
const ic = (n, c) => `<svg class="${c || 'h-4 w-4'} shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="${ICONS[n] || ''}"/></svg>`;
const STATUS = {
  pending: ['En attente', 'bg-amber-100 text-amber-800'], active: ['Active', 'bg-emerald-100 text-emerald-800'], paused: ['En pause', 'bg-slate-200 text-slate-700'],
  ended: ['Terminée', 'bg-sky-100 text-sky-800'], rejected: ['Rejetée', 'bg-red-100 text-red-700'], cancelled: ['Annulée', 'bg-slate-200 text-slate-600'],
  ok: ['Validée', 'bg-emerald-100 text-emerald-800'], suspended: ['Suspendu', 'bg-red-100 text-red-700']
};
const badge = s => { const b = STATUS[s] || [s, 'bg-slate-100 text-slate-700']; return `<span class="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${b[1]}">${b[0]}</span>`; };

function toast(msg, type) {
  let box = $('#toast-box');
  if (!box) { box = document.createElement('div'); box.id = 'toast-box'; box.className = 'fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'pointer-events-auto flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs text-white shadow-xl max-w-sm';
  t.innerHTML = `<span class="h-2 w-2 shrink-0 rounded-full ${type === 'err' ? 'bg-red-500' : 'bg-[#00c58a]'}"></span><span>${esc(msg)}</span>`;
  box.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, type === 'err' ? 5000 : 3000);
}
const fail = e => { console.error(e); toast(e && e.message ? e.message : String(e), 'err'); };

function dialog(title, body, buttons, wide) { // buttons: [{label, cls, fn}] — fn() === false garde le dialogue ouvert
  const o = document.createElement('div');
  o.className = 'fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/60 p-4';
  o.innerHTML = `<div class="max-h-[90vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" role="dialog">
    <div class="mb-4 flex items-center justify-between"><h3 class="text-base font-bold text-slate-900">${esc(title)}</h3><button data-x class="text-slate-400 hover:text-slate-700" aria-label="Fermer">${ic('x')}</button></div>
    <div data-body class="text-sm text-slate-700">${body}</div><div data-btns class="mt-5 flex flex-wrap justify-end gap-2"></div></div>`;
  document.body.appendChild(o);
  const close = () => { o.remove(); document.removeEventListener('keydown', esc_); if (api.onClose) api.onClose(); };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  o.addEventListener('mousedown', e => { if (e.target === o) close(); });
  $('[data-x]', o).onclick = close;
  (buttons || []).forEach(b => {
    const el = document.createElement('button'); el.className = b.cls || K.btn; el.textContent = b.label;
    el.onclick = async () => { el.disabled = true; try { const r = b.fn ? await b.fn(o) : true; if (r !== false) close(); } catch (e) { fail(e); } el.disabled = false; };
    $('[data-btns]', o).appendChild(el);
  });
  const api = { el: o, close }; return api;
}
function ask(title, msg, okLabel, danger) {
  return new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const d = dialog(title, `<p>${msg}</p>`, [{ label: 'Annuler', cls: K.btn2, fn: () => { fin(false); } }, { label: okLabel || 'Confirmer', cls: danger ? 'rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700' : K.btn, fn: () => { fin(true); } }]);
    d.onClose = () => fin(false);
  });
}
function printHTML(html) {
  let p = $('#print-area');
  if (!p) { p = document.createElement('div'); p.id = 'print-area'; p.style.display = 'none'; document.body.appendChild(p);
    const st = document.createElement('style'); st.textContent = '@media print{body>*:not(#print-area){display:none!important}#print-area{display:block!important;padding:24px;color:#000}}'; document.head.appendChild(st); }
  p.innerHTML = html; w.print();
}
function csv(rows, name) {
  const t = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + t], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- Graphiques SVG ---------- */
function line(el, labels, series, colors) {
  const max = Math.max.apply(null, [1].concat(series.map(s => Math.max.apply(null, s.concat(0))))), W = 640, H = 230, L = 44, R = 10, T = 12, B = 26;
  if (series.every(s => s.every(v => !v))) { el.innerHTML = '<div class="flex h-48 items-center justify-center text-sm text-slate-400">Aucune donnée pour le moment</div>'; return; }
  const nice = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / nice) * nice, x = i => L + i * (W - L - R) / Math.max(1, labels.length - 1), y = v => T + (H - T - B) * (1 - v / top);
  let g = ''; for (let i = 0; i <= 4; i++) { const v = top * i / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8f0"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="#94a3b8">${v >= 1000 ? (v / 1000) + 'k' : Math.round(v)}</text>`; }
  const step = Math.ceil(labels.length / 7); labels.forEach((l, i) => { if (i % step === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#94a3b8">${l}</text>`; });
  series.forEach((s, k) => {
    const pts = s.map((v, i) => x(i) + ',' + y(v)).join(' '), col = (colors || ['#009668', '#00a3ff'])[k];
    if (k === 0) g += `<polygon points="${x(0)},${y(0)} ${pts} ${x(s.length - 1)},${y(0)}" fill="${col}" opacity=".12"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>` + s.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${col}"><title>${labels[i]} : ${fmt(v)}</title></circle>`).join('');
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="w-full">${g}</svg>`;
}
function donut(el, items) {
  const tot = sum(items, 'value'); if (!tot) { el.innerHTML = '<div class="py-8 text-center text-sm text-slate-400">Aucune donnée</div>'; return; }
  let off = 0, arcs = '';
  items.forEach(it => { const f = it.value / tot * 251.33; arcs += `<circle r="40" cx="60" cy="60" fill="none" stroke="${it.color}" stroke-width="18" stroke-dasharray="${f} ${251.33 - f}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += f; });
  el.innerHTML = `<div class="flex items-center gap-5"><svg viewBox="0 0 120 120" class="h-32 w-32 shrink-0">${arcs}</svg><div class="space-y-2 text-xs">${items.map(it => `<div class="flex items-center gap-2"><span class="h-3 w-3 rounded-sm" style="background:${it.color}"></span><span class="text-slate-600">${esc(it.label)}</span><b class="text-slate-900">${Math.round(it.value / tot * 100)}%</b></div>`).join('')}</div></div>`;
}
function hbars(el, items, max) {
  if (!items.length) { el.innerHTML = '<div class="py-6 text-center text-sm text-slate-400">Aucune donnée</div>'; return; }
  const m = max || Math.max.apply(null, items.map(i => i.value)) || 1;
  el.innerHTML = items.map(i => `<div class="mb-2.5"><div class="mb-1 flex justify-between text-xs"><span class="text-slate-600">${esc(i.label)}</span><b>${fmt(i.value)}</b></div><div class="h-2 rounded-full bg-slate-100"><div class="h-2 rounded-full bg-[#009668]" style="width:${Math.max(2, i.value / m * 100)}%${i.color ? ';background:' + i.color : ''}"></div></div></div>`).join('');
}

/* ---------- Coquille d'application (sidebar + topbar + routeur par #hash) ---------- */
let SH = null, VIEWS = null, DEF = null;
function shell(cfg) {
  SH = cfg;
  document.body.className = 'min-h-screen bg-[#F4F7FA] text-slate-800 antialiased';
  document.body.innerHTML = `
  <div id="overlay" class="fixed inset-0 z-30 hidden bg-slate-900/40 lg:hidden"></div>
  <aside id="side" class="fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0">
    <div class="px-5 py-5"><a href="index.html"><img src="assets/logo.png" alt="OFFIADS" class="h-9"></a>${cfg.tag ? `<span class="mt-2 inline-block rounded-full bg-[#081726] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">${cfg.tag}</span>` : ''}</div>
    <nav id="nav" class="flex-1 space-y-1 overflow-y-auto px-3">${cfg.nav.map(n => `<a href="#/${n[0]}" data-nav="${n[0]}" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">${ic(n[2], 'h-[18px] w-[18px]')}<span class="flex-1">${n[1]}</span><span data-badge="${n[0]}"></span></a>`).join('')}</nav>
    <div class="border-t border-slate-100 p-4"><div id="who" class="mb-3 text-xs"></div><button id="btn-logout" class="${K.btn2} w-full">${ic('out')} Déconnexion</button></div>
  </aside>
  <div class="lg:pl-64"><header class="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-8">
    <button id="btn-menu" class="rounded-lg border border-slate-200 p-2 lg:hidden" aria-label="Menu">${ic('menu', 'h-5 w-5')}</button><div class="flex-1"></div><div id="top" class="flex items-center gap-3"></div></header>
    <main id="view" class="mx-auto max-w-7xl p-4 lg:p-8"></main></div>`;
  const side = $('#side'), ov = $('#overlay'), tgl = o => { side.classList.toggle('-translate-x-full', !o); ov.classList.toggle('hidden', !o); };
  $('#btn-menu').onclick = () => tgl(side.classList.contains('-translate-x-full')); ov.onclick = () => tgl(false);
  $('#nav').addEventListener('click', () => tgl(false)); $('#btn-logout').onclick = logout;
}
function start(views, def) {
  VIEWS = views; DEF = def; tick();
  w.addEventListener('hashchange', render); render();
}
function render() {
  tick(); const u = me();
  if (!u) { location.replace('login.html'); return; }
  const h = (location.hash || '').replace(/^#\//, '').split('/'), name = VIEWS[h[0]] ? h[0] : DEF;
  $$('[data-nav]').forEach(a => { const on = a.dataset.nav === name || (SH.alias && SH.alias[h[0]] === a.dataset.nav); a.className = 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ' + (on ? 'bg-emerald-50 text-[#009668]' : 'text-slate-600 hover:bg-slate-50'); });
  $('#who').innerHTML = `<div class="font-bold text-slate-900">${esc(u.name)}</div><div class="truncate text-slate-500">${esc(u.company)} · ${esc(u.email)}</div>`;
  if (SH.top) $('#top').innerHTML = SH.top(u);
  if (SH.badges) { const b = SH.badges(); $$('[data-badge]').forEach(e => { const n = b[e.dataset.badge]; e.innerHTML = n ? `<span class="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">${n}</span>` : ''; }); }
  let r; try { r = VIEWS[name](h[1], u); } catch (e) { console.error(e); r = `<div class="${K.card} text-red-600">Erreur d'affichage : ${esc(e.message)}</div>`; }
  const v = $('#view'); v.innerHTML = typeof r === 'string' ? r : r.html;
  if (r && r.after) { try { r.after(); } catch (e) { console.error(e); } }
  w.scrollTo(0, 0);
}
function pwdDialog(userId) {
  dialog('Changer le mot de passe', `<div class="space-y-3"><input id="pw0" type="password" placeholder="Mot de passe actuel" class="${K.input}" autocomplete="current-password"><input id="pw1" type="password" placeholder="Nouveau mot de passe (8+ car., lettres et chiffres)" class="${K.input}" autocomplete="new-password"><input id="pw2" type="password" placeholder="Confirmer le nouveau mot de passe" class="${K.input}" autocomplete="new-password"></div>`,
    [{ label: 'Annuler', cls: K.btn2 }, { label: 'Enregistrer', fn: async () => {
      if ($('#pw1').value !== $('#pw2').value) { toast('Les mots de passe ne correspondent pas.', 'err'); return false; }
      try { await changePassword(userId, $('#pw0').value, $('#pw1').value); toast('Mot de passe modifié.'); } catch (e) { fail(e); return false; } } }]);
}

/* ---------- Style de la carte (js/geo.js) ---------- */
(function () {
  if (document.getElementById('geo-css')) return;
  const st = document.createElement('style'); st.id = 'geo-css';
  st.textContent = '.dzm path{transition:opacity .15s,filter .15s;stroke:#fff;stroke-width:.7px;vector-effect:non-scaling-stroke;stroke-linejoin:round}.dzm path.s{stroke:#081726;stroke-width:2px}.dzm.clk path{cursor:pointer}.dzm.clk path:hover,.dzm.clk path:focus{opacity:1!important;outline:none;filter:brightness(1.12)}.zl{display:flex;gap:6px 12px;flex-wrap:wrap;margin-top:8px;font-size:11.5px;color:#64748b;justify-content:center}.zl i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}';
  document.head.appendChild(st);
})();

w.OFF = {
  $, $$, esc, fmt, da, dt, dtt, uid, sum, K, ic, badge, toast, fail, dialog, ask, printHTML, csv, line, donut, hbars, shell, start, render, pwdDialog,
  REGIONS, WILAYAS, WILAYA_LIST, GEO: G, byRegion, pharmByWilaya, DURATIONS, DEFAULTS, D, ready: init(), register, login, me, logout, guard, changePassword, resetPassword, updateProfile, validEmail, validPw,
  eligible, price, requestRecharge, resolveRecharge, manualCredit, createCampaign, campaignAction, tick, record, pickAd, simulate, addMessage, saveSettings, resetSettings, series, byWilaya, media, mutate, log
};
})(window);
