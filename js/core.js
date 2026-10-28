/* OFFIADS core — données (localStorage + IndexedDB), auth, tarification, wallet, helpers UI.
   Toute la persistance passe par ce fichier : pour migrer vers Supabase, on ne change que ici. */
(function (w) {
'use strict';
const KEY = 'offiads_db_v1', SES = 'offiads_session_v1';
const SUPABASE_URL = 'https://hxmrvodbirqlihsjblgr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GudmaonttbHsxS332AGb-Q_tFSC04iN';
const sb = w.supabase && w.supabase.createClient ? w.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let remoteMode = !!sb, remoteSession = null;

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
function D() { return remoteMode ? db : (load() || db); }
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

function mapCampaign(c) {
  return { id:c.id, userId:c.user_id, name:c.name, format:c.format, zoneMode:c.zone_mode, region:c.region||'', wilaya:c.wilaya||'', network:c.network_id||'all', pharmacies:Number(c.pharmacies), days:Number(c.days), freq:Number(c.freq), headline:c.headline||'', cta:c.cta||'Découvrir', url:c.url||'', mediaUrl:c.media_url||'', mediaType:c.media_type||'', mediaName:c.media_name||'', thumb:c.thumb_url||'', cpm:Number(c.cpm||0), imp:Number(c.imp_target||0), budget:Number(c.budget||0), fee:Number(c.fee||0), total:Number(c.total||0), spent:Number(c.spent||0), impressions:Number(c.impressions||0), clicks:Number(c.clicks||0), status:c.status, reason:c.reason||'', endReason:c.end_reason||'', invoiceNo:c.invoice_no, created:c.created_at ? new Date(c.created_at).getTime() : Date.now(), startAt:c.start_at ? new Date(c.start_at).getTime() : null, endAt:c.end_at ? new Date(c.end_at).getTime() : null, pausedAt:c.paused_at ? new Date(c.paused_at).getTime() : null, daily:{}, byWilaya:{} };
}
function mapProfile(p) { return { id:p.id, email:p.email, role:p.role, name:p.name, company:p.company, phone:p.phone||'', status:p.status, created:p.created_at ? new Date(p.created_at).getTime() : Date.now(), wallet:{available:Number(p.available||0),reserved:Number(p.reserved||0),spent:Number(p.spent||0)} }; }
function mapTx(t) { return {id:t.id,userId:t.user_id,type:t.type,amount:Number(t.amount||0),label:t.label,status:t.status,date:t.created_at?new Date(t.created_at).getTime():Date.now(),method:t.method,ref:t.ref,proofUrl:t.proof_url||'',campaignId:t.campaign_id}; }
async function loadRemoteData() {
  if (!sb) throw new Error('Supabase JS ne se charge pas. Vérifiez votre connexion Internet.');
  const {data:{session}} = await sb.auth.getSession(); remoteSession=session;
  db = {version:2, settings:JSON.parse(JSON.stringify(DEFAULTS)), pharmacies:seedPharmacies(), users:[], campaigns:[], transactions:[], logs:[], messages:[], seq:{invoice:0}};
  const [st, nw, rg, wl] = await Promise.all([
    sb.from('settings').select('*').limit(1).maybeSingle(), sb.from('networks').select('*').eq('active',true), sb.from('regions').select('*'), sb.from('wilayas').select('*')
  ]);
  for (const r of [st,nw,rg,wl]) if (r.error) throw r.error;
  if(st.data){const x=st.data;db.settings={cpm:Number(x.cpm),fee:Number(x.fee),zone:{national:Number(x.zone_national),wilaya:Number(x.zone_wilaya),regions:Object.fromEntries((rg.data||[]).map(a=>[a.name,Number(a.coef)]))},format:{image:Number(x.format_image),video:Number(x.format_video)},networks:(nw.data||[]).map(n=>({id:n.id,name:n.name,coef:Number(n.coef)})),maxFreq:Number(x.max_freq),minBudget:Number(x.min_budget),minPharm:Number(x.min_pharm),maxPharm:Number(x.max_pharm),payInfo:x.pay_info||''};}
  if (remoteSession) {
    const meRes=await sb.from('profiles').select('*').eq('id',remoteSession.user.id).maybeSingle();
    if(meRes.error) throw meRes.error;
    if(meRes.data) db.users.push(mapProfile(meRes.data));
    const [cs,tx,allProfiles] = await Promise.all([
      sb.from('campaigns').select('*').order('created_at',{ascending:false}),
      sb.from('transactions').select('*').order('created_at',{ascending:false}),
      meRes.data?.role==='admin' ? sb.from('profiles').select('*').order('created_at',{ascending:false}) : Promise.resolve({data:[],error:null})
    ]);
    for(const r of [cs,tx,allProfiles]) if(r.error) throw r.error;
    db.campaigns=(cs.data||[]).map(mapCampaign); db.transactions=(tx.data||[]).map(mapTx);
    // Charger les tables d'agrégats utilisées par les graphiques. Les KPI viennent de campaigns,
    // mais les courbes/cartes utilisent campaign_daily et campaign_wilaya.
    const [dailyRes, wilayaRes] = await Promise.all([
      sb.from('campaign_daily').select('campaign_id,day,impressions,clicks'),
      sb.from('campaign_wilaya').select('campaign_id,wilaya,impressions')
    ]);
    if(dailyRes.error) console.warn('OFFIADS campaign_daily:', dailyRes.error.message);
    if(wilayaRes.error) console.warn('OFFIADS campaign_wilaya:', wilayaRes.error.message);
    const byId = new Map(db.campaigns.map(c => [c.id, c]));
    (dailyRes.data||[]).forEach(r => { const c=byId.get(r.campaign_id); if(!c)return; const day=String(r.day).slice(0,10); c.daily[day]={i:Number(r.impressions||0),c:Number(r.clicks||0)}; });
    (wilayaRes.data||[]).forEach(r => { const c=byId.get(r.campaign_id); if(!c)return; c.byWilaya[r.wilaya]=Number(r.impressions||0); });
    db.users=(allProfiles.data||[]).map(mapProfile); if(!db.users.some(u=>u.id===meRes.data?.id)&&meRes.data)db.users.unshift(mapProfile(meRes.data));
    if(meRes.data?.role==='admin') {
      const ph=await sb.from('pharmacies').select('id,name,wilaya_code,network_id,active,token,wilayas(name,region)');
      if(ph.error) throw ph.error;
      db.pharmacies=(ph.data||[]).map(x=>({id:x.id,name:x.name,wilaya:x.wilayas?.name||'',region:x.wilayas?.region||'',network:x.network_id,active:x.active,token:x.token}));
      const logs=await sb.from('activity_logs').select('*').order('created_at',{ascending:false}).limit(400); if(!logs.error)db.logs=(logs.data||[]).map(x=>({id:x.id,userId:x.user_id,action:x.action,date:new Date(x.created_at).getTime()}));
      const msgs=await sb.from('messages').select('*').order('created_at',{ascending:false}); if(!msgs.error)db.messages=(msgs.data||[]).map(x=>({id:x.id,name:x.name,email:x.email,msg:x.message,date:new Date(x.created_at).getTime(),read:x.read}));
    }
  }
  return db;
}
async function init() {
  if (!sb) { throw new Error('Impossible de charger Supabase. Vérifiez Internet puis rechargez la page.'); }
  await loadRemoteData();
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
  const email=(o.email||'').trim().toLowerCase();
  if(!(o.name||'').trim()||!(o.company||'').trim())throw new Error('Nom et entreprise obligatoires.');
  if(!validEmail(email))throw new Error('Adresse e-mail invalide.');
  if(!validPw(o.password))throw new Error('Mot de passe : 8 caractères minimum, avec lettres et chiffres.');
  if(!sb)throw new Error('Connexion Supabase indisponible.');
  const {data,error}=await sb.auth.signUp({email,password:o.password,options:{data:{name:o.name.trim(),company:o.company.trim(),phone:(o.phone||'').trim()}}});
  if(error)throw error;
  if(!data.session)throw new Error('Compte créé. Vérifiez votre e-mail pour confirmer le compte, puis connectez-vous.');
  await loadRemoteData(); const u=me(); if(!u)throw new Error('Compte créé mais profil pas encore disponible. Réessayez dans quelques secondes.'); return u;
}
async function login(email,pw) {
  if(!sb)throw new Error('Connexion Supabase indisponible.');
  const {data,error}=await sb.auth.signInWithPassword({email:(email||'').trim().toLowerCase(),password:pw||''});
  if(error)throw new Error('E-mail ou mot de passe incorrect.');
  remoteSession=data.session; await loadRemoteData();
  const u=me(); if(!u)throw new Error('Profil introuvable. Vérifiez la table profiles dans Supabase.');
  if(u.status==='pending'){await sb.auth.signOut();throw new Error('Votre compte annonceur est en attente de validation par OFFIADS.');}
  if(u.status==='rejected'){await sb.auth.signOut();throw new Error('Votre demande de création de compte a été refusée. Contactez OFFIADS.');}
  if(u.status==='suspended'){await sb.auth.signOut();throw new Error('Ce compte est suspendu. Contactez OFFIADS.');}
  return u;
}
function me() {
  if(remoteMode && remoteSession) return (db?.users||[]).find(u=>u.id===remoteSession.user.id)||null;
  return null;
}
function logout() { if(sb) sb.auth.signOut().finally(()=>{remoteSession=null;location.href='login.html';}); else location.href='login.html'; }
function guard(role) {
  const u=me();
  if(!u){location.replace('login.html?next='+encodeURIComponent(location.pathname.split('/').pop()+location.hash));return null;}
  if(u.role!==role){location.replace(u.role==='admin'?'admin.html':'app.html');return null;} return u;
}
async function changePassword(userId, oldPw, newPw) {
  if(!validPw(newPw))throw new Error('Nouveau mot de passe : 8 caractères minimum, avec lettres et chiffres.');
  const u=me(); if(!u||u.id!==userId)throw new Error('Session invalide.');
  const {error}=await sb.auth.updateUser({password:newPw}); if(error)throw error;
  log(userId,'Changement de mot de passe');
}
async function resetPassword(email) {
  if(!validEmail((email||'').trim()))throw new Error('Adresse e-mail invalide.');
  const {error}=await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:location.origin+location.pathname}); if(error)throw error;
}
async function updateProfile(userId, o) {
  const {data,error}=await sb.from('profiles').update({name:o.name.trim(),company:o.company.trim(),phone:(o.phone||'').trim()}).eq('id',userId).select('*').single(); if(error)throw error; const u=mapProfile(data); const i=db.users.findIndex(x=>x.id===userId); if(i>=0)db.users[i]=u; else db.users.push(u); return u;
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
async function requestRecharge(userId, amount, method, ref, proofUrl) {
  amount=Math.round(Number(amount)); if(!(amount>=1000))throw new Error('Montant minimum : 1 000 DA.');
  if(!proofUrl) throw new Error('Le justificatif de paiement est obligatoire.');
  const {error}=await sb.rpc('request_recharge',{p_amount:amount,p_method:method||'virement',p_ref:ref||null,p_proof_url:proofUrl}); if(error)throw error; await loadRemoteData();
}
async function resolveRecharge(txId, ok, adminId) {
  const {error}=await sb.rpc('resolve_recharge',{p_tx:Number(txId),p_ok:!!ok}); if(error)throw error; await loadRemoteData();
}
async function manualCredit(userId, amount, adminId) {
  amount=Math.round(Number(amount)); if(!(amount>0))throw new Error('Montant invalide.');
  const {error}=await sb.rpc('manual_credit',{p_user:userId,p_amount:amount}); if(error)throw error; await loadRemoteData();
}
async function setUserStatus(userId, status) {
  const {error}=await sb.rpc('set_user_status',{p_user:userId,p_status:status}); if(error)throw error; await loadRemoteData();
}
async function setPharmacyActive(id, active) { const {error}=await sb.from('pharmacies').update({active:!!active}).eq('id',id); if(error)throw error; await loadRemoteData(); }
async function createCampaign(userId, o, id) {
  const payload={id:id||uid('C'),name:o.name,format:o.format,zoneMode:o.zoneMode,wilaya:o.wilaya||'',region:o.region||'',network:o.network||'all',pharmacies:Number(o.pharmacies),days:Number(o.days),freq:Number(o.freq),headline:o.headline||'',cta:o.cta||'Découvrir',url:o.url||'',mediaUrl:o.mediaUrl||'',mediaType:o.mediaType||'',mediaName:o.mediaName||'',thumb:o.thumb||''};
  const {data,error}=await sb.rpc('create_campaign',{p:payload}); if(error)throw error;
  await loadRemoteData(); return mapCampaign(Array.isArray(data)?data[0]:data);
}
async function campaignAction(kind, id, actorId, reason) {
  const rpcKind=kind==='cancel'?'cancel':kind;
  const {data,error}=await sb.rpc('campaign_action',{p_id:id,p_kind:rpcKind,p_reason:reason||null}); if(error)throw error;
  await loadRemoteData(); return mapCampaign(Array.isArray(data)?data[0]:data);
}
function tick() { // la clôture de production est gérée par la fonction PostgreSQL close_expired()
  if (remoteMode) return;
  load(); let ch = false; const now = Date.now();
  db.campaigns.forEach(c => {
    if (c.status === 'active' && (now >= c.endAt || c.spent >= c.budget - 1e-9)) { endC(db, c, now >= c.endAt ? 'Durée écoulée' : 'Budget épuisé'); ch = true; }
  });
  if (ch) save();
}
async function record(cid, pid, kind, token) {
  if(!sb)return false;
  const {data,error}=await sb.rpc('record_event',{p_campaign:cid,p_pharmacy:pid,p_token:token||'',p_kind:kind==='click'?'click':'imp'});
  if(error) { console.error(error); return false; }
  if(data) await loadRemoteData(); return !!data;
}
async function pickAd(pid, token) {
  if(!sb)return null;
  const {data,error}=await sb.rpc('pick_ad',{p_pharmacy:pid,p_token:token||''});
  if(error){console.error(error);return null;}
  const c=Array.isArray(data)?data[0]:data; if(!c)return null;
  return {id:c.id,format:c.format,headline:c.headline,cta:c.cta,url:c.url,mediaUrl:c.media_url};
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
async function saveSettings(s, adminId) { const patch={cpm:s.cpm,fee:s.fee,zone_national:s.zone.national,zone_wilaya:s.zone.wilaya,format_image:s.format.image,format_video:s.format.video,max_freq:s.maxFreq,min_budget:s.minBudget,min_pharm:s.minPharm,max_pharm:s.maxPharm,pay_info:s.payInfo}; const {error}=await sb.from('settings').update(patch).eq('id',true); if(error)throw error; await loadRemoteData(); }
async function resetSettings(adminId) { const pi=db.settings.payInfo; const s=JSON.parse(JSON.stringify(DEFAULTS)); s.payInfo=pi; await saveSettings(s,adminId); }
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
  REGIONS, WILAYAS, WILAYA_LIST, GEO: G, byRegion, pharmByWilaya, DURATIONS, DEFAULTS, D, ready: init(), register, login, me, logout, guard, changePassword, resetPassword, updateProfile, validEmail, validPw, refresh: loadRemoteData,
  eligible, price, requestRecharge, resolveRecharge, manualCredit, setUserStatus, setPharmacyActive, createCampaign, campaignAction, tick, record, pickAd, simulate, addMessage, saveSettings, resetSettings, series, byWilaya, media, mutate, log
};
})(window);
