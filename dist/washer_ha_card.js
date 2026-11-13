/* ======================================================================
 * home-twin-waschmaschine-card – Haier-Waschmaschine (hOn) bedienen und anzeigen
 * Version 1.2.0 (2026-11-08) – Baustein bereiche (Umschalter Programm/Statistik/Pflege), Strom Maschine vs. Steckdose; 1.1.0: vier getrennte Bereiche, Tasten wie im Raum-Panel, Steckdose (Leistung/kWh), Knitterschutz, Verlauf
 *
 * Braucht die Integration washer_control (custom_components/washer_control, configuration.yaml washer_control:).
 * Daten über WebSocket washer_control/* (Programme, Start, Pause/Stop, Verlauf, Statistik, Wartung),
 * Aktualisierung bei Änderung von sensor.<washer>_status.
 *
 * Optionen (alle optional):
 *   washer: ku_washer          (id aus configuration.yaml)
 *   titel: Waschmaschine
 *   hintergrund: true          (false = ohne eigene Glasplatte, z. B. im raum-panel-Rahmen)
 *   bestaetigen: true          (Start/Abbrechen erst nach zweitem Tippen)
 *   teil: <Baustein>           (nur dieser Baustein – setzt raum-panel bei layout: custom)
 *
 * Bausteine (= Bereiche) für raum-panel (Brücke rp-extcard): uebersicht, bedienung, auswertung, pflege – je für sich in einen
 *   Rahmen (card: {…, teil: bedienung}) oder frei anordnen (layout: custom). platten: true = jeder Bereich eigene Glasplatte.
 * Alle Bausteine einer Maschine teilen sich Daten und die Programm-Auswahl (auch als getrennte Instanzen).
 * Stellt window.HT_WM.svg(live, zustand, opt) für andere Karten bereit (Küchengeräte-Karussell).
 * ====================================================================== */
(() => {
const VERSION = '1.2.0';
const TAG = 'home-twin-waschmaschine-card';

const DEF = { washer: 'ku_washer', titel: 'Waschmaschine', hintergrund: true, bestaetigen: true, platten: null };
const C = { ok: '#3ddc84', warn: '#ff9f2e', bad: '#ff5a5a', info: '#4da3ff', run: '#4dc3ff', off: '#5c6068', plan: '#b48cff' };

const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const hm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const tD = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
const dayT = d => {
  const n = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dd = Math.round((day(n) - day(d)) / 864e5);
  if (dd === 0) return `heute ${hm(d)}`;
  if (dd === 1) return `gestern ${hm(d)}`;
  if (dd === -1) return `morgen ${hm(d)}`;
  return `${WT[d.getDay()]} ${p2(d.getDate())}.${p2(d.getMonth() + 1)}. ${hm(d)}`;
};
const durM = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60); return h ? `${h}:${p2(m % 60)} h` : `${m} min`; };
const durHM = m => { m = Math.max(0, Math.round(m)); return `${Math.floor(m / 60)}:${p2(m % 60)}`; };
const sinceT = d => { const m = Math.round((Date.now() - d.getTime()) / 60000); if (m < 1) return 'gerade eben'; if (m < 60) return `seit ${m} Min.`; const h = Math.floor(m / 60); return h < 24 ? `seit ${h} Std.${m % 60 ? ` ${m % 60} Min.` : ''}` : `seit ${Math.floor(h / 24)} Tg.`; };
const fmt = (v, d = 0) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

const loadFonts = () => {
  if (document.getElementById('rtc-fonts')) return;
  const l = document.createElement('link'); l.id = 'rtc-fonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&display=swap';
  document.head.appendChild(l);
};

// ---------------------------------------------------------------- Zustände
const ST = {
  bereit: ['Bereit', C.info, 'mdi:washing-machine'], laeuft: ['Läuft', C.run, 'mdi:washing-machine'], pausiert: ['Pausiert', C.warn, 'mdi:pause-circle'],
  geplant: ['Geplant', C.plan, 'mdi:clock-outline'], fertig: ['Wäsche fertig', C.ok, 'mdi:check-circle'], beendet: ['Beendet', C.ok, 'mdi:check-circle'],
  fehler: ['Fehler', C.bad, 'mdi:alert-circle'], getrennt: ['Nicht verbunden', C.off, 'mdi:wifi-off'], aus: ['Aus', C.off, 'mdi:power'],
  test: ['Test', C.warn, 'mdi:test-tube'], unavailable: ['Nicht erreichbar', C.off, 'mdi:wifi-off'],
};
const KIND_TXT = { wash: 'Waschen', rinse: 'Spülen', spin: 'Schleudern', weigh: 'Wiegen', steam: 'Dampf', dry: 'Trocknen', heat: 'Heizen', tumble: 'Auflockern' };
const GRP_ICON = { geraet: 'mdi:washing-machine', alltag: 'mdi:tshirt-crew', kurz: 'mdi:timer-fast', textil: 'mdi:hanger', flecken: 'mdi:water-alert',
  hygiene: 'mdi:shield-check', marke: 'mdi:bottle-tonic', pflege: 'mdi:spray-bottle' };
const PROG_ICON = { hqd_cottons: 'mdi:tshirt-crew', hqd_synthetic_and_coloured: 'mdi:palette', hqd_eco_40_60_degrees: 'mdi:leaf', hqd_quick_15: 'mdi:timer-fast',
  hqd_quick_wash_57: 'mdi:timer-sand', hqd_mix: 'mdi:shuffle-variant', hqd_smart: 'mdi:brain', hqd_spin: 'mdi:rotate-right', hqd_rinse: 'mdi:water',
  hqd_handwash_wool: 'mdi:hand-wash', hqd_20_degrees: 'mdi:thermometer-low', hqd_shirts: 'mdi:tie', hqd_babycare: 'mdi:baby-face-outline',
  hqd_delicate_cradle: 'mdi:feather', hqd_allergy: 'mdi:flower-pollen', hqd_refresh: 'mdi:weather-windy', hqd_duvet: 'mdi:bed', hqd_autoclean: 'mdi:spray-bottle',
  hqd_sport: 'mdi:run', hqd_checkup: 'mdi:stethoscope' };

// Parameter der Programme (hOn-Schlüssel → Anzeige)
const PAR = {
  temp: { n: 'Temperatur', u: '°C', zero: 'Kalt', chips: 1, ord: 1 },
  spinSpeed: { n: 'Schleudern', u: 'U/min', zero: 'Aus', chips: 1, ord: 2 },
  rinseIterations: { n: 'Spülgänge', u: '×', ord: 3 },
  mainWashTime: { n: 'Waschdauer', u: 'min', ord: 4 },
  haier_SoakPrewashSelection: { n: 'Vorwäsche', sw: 1, ord: 5 },
  autoDetergentStatus: { n: 'Auto-Dosierung Waschmittel', sw: 1, ord: 6 },
  autoSoftenerStatus: { n: 'Auto-Dosierung Weichspüler', sw: 1, ord: 7 },
  nightWashStatus: { n: 'Nachtwäsche (leise)', sw: 1, ord: 8 },
  permanentPressStatus: { n: 'Knitterschutz', sw: 1, ord: 9 },
  steamStatus: { n: 'Dampf', sw: 1, ord: 10 }, steamType: { n: 'Dampf-Stufe', ord: 11 },
  energySavingStatus: { n: 'Energiesparen', sw: 1, ord: 12 }, speedUpStatus: { n: 'Schneller', sw: 1, ord: 13 },
  strongStatus: { n: 'Intensiv', sw: 1, ord: 14 }, extraRinse: { n: 'Extra spülen', sw: 1, ord: 15 }, antiAllergyStatus: { n: 'Anti-Allergie', sw: 1, ord: 16 },
  dryLevel: { n: 'Trocknen', ord: 17 }, dryTime: { n: 'Trockenzeit', u: 'min', ord: 18 }, weight: { n: 'Beladung', u: 'kg', ord: 19 },
  stainType: { n: 'Fleckenart', ord: 30, adv: 1 },
};
const HIDE = new Set(['delayTime', 'delayStatus', 'program', 'prCode', 'prPosition', 'onOffStatus', 'machMode']);

// ---------------------------------------------------------------- gemeinsamer Speicher je Maschine
const STORE = window.__htWmStore || (window.__htWmStore = new Map());
const S = w => {
  let s = STORE.get(w);
  if (!s) { s = { snap: null, at: 0, p: null, err: null, cat: null, catP: null, catErr: null, sel: null, subs: new Set(), key: null, busy: null, msg: null, ui: {} }; STORE.set(w, s); }
  return s;
};
const emit = w => { for (const el of S(w).subs) el._render(); };
const load = (hass, w, force) => {
  const s = S(w);
  if (s.p) return s.p;
  if (!force && s.snap && Date.now() - s.at < 15000) return Promise.resolve(s.snap);
  s.p = hass.callWS({ type: 'washer_control/get', washer: w, history: 60 })
    .then(r => { s.snap = r; s.at = Date.now(); s.err = null; s.p = null; emit(w); return r; })
    .catch(e => { s.p = null; s.err = (e && e.message) || String(e); emit(w); });
  return s.p;
};
const loadCat = (hass, w) => {
  const s = S(w);
  if (s.cat || s.catP) return s.catP;
  s.catP = hass.callWS({ type: 'washer_control/programs', washer: w })
    .then(r => { s.cat = r; s.catErr = null; emit(w); })
    .catch(e => { s.catP = null; s.catErr = (e && e.message) || String(e); emit(w); });
  return s.catP;
};
const progOf = (s, key) => s.cat && s.cat.programs.find(p => p.key === key);
// Auswahl (Programm + Werte) – Standard: erster Favorit bzw. zuletzt benutzte Werte
const selOf = s => {
  if (!s.cat || !s.snap) return null;
  if (!s.sel || !progOf(s, s.sel.program)) {
    const key = (s.snap.favorites || []).find(k => progOf(s, k)) || s.cat.programs[0].key;
    s.sel = { program: key, params: initParams(s, key), delay: 0 };
  }
  return s.sel;
};
const initParams = (s, key) => {
  const P = progOf(s, key), o = {};
  if (!P) return o;
  for (const [k, d] of Object.entries(P.params)) o[k] = String(d.default ?? (d.t === 'enum' ? d.values[0] : d.min));
  const last = (s.snap && s.snap.last_params && s.snap.last_params[key]) || {};
  for (const [k, v] of Object.entries(last)) if (k in P.params && valid(P.params[k], v)) o[k] = String(v);
  // Knitterschutz nach Programmende: Voreinstellung aus den Einstellungen (Standard an)
  const ac = P.params.permanentPressStatus;
  if (ac && s.snap && s.snap.settings && s.snap.settings.anti_crease != null) o.permanentPressStatus = String(s.snap.settings.anti_crease ? (ac.t === 'enum' ? ac.values[ac.values.length - 1] : ac.max) : (ac.t === 'enum' ? ac.values[0] : ac.min));
  return o;
};
// Dauer: aus dem Namen (15'), gelernt aus dem Verlauf, sonst grob aus Waschzeit/Spülgängen/Temperatur/Schleudern
const estMin = (s, P, params) => {
  if (!P) return 0;
  const m = /(\d+)'/.exec(P.name); if (m) return Number(m[1]);
  const L = s.snap && s.snap.stats && s.snap.stats.prog_minutes; if (L && L[P.key]) return L[P.key];
  const g = k => Number((params || {})[k] ?? (P.params[k] || {}).default ?? 0);
  return 10 + g('mainWashTime') + g('rinseIterations') * 11 + (g('spinSpeed') > 0 ? 12 : 0) + (g('temp') >= 60 ? 25 : g('temp') >= 40 ? 15 : g('temp') >= 30 ? 8 : 0) + (g('haier_SoakPrewashSelection') > 0 ? 20 : 0);
};
const valid = (d, v) => d.t === 'enum' ? d.values.map(String).includes(String(v)) : Number(v) >= d.min && Number(v) <= d.max;

// ---------------------------------------------------------------- Grafik der Maschine (SVG)
const RING_DOTS = Array.from({ length: 24 }, (_, i) => { const a = i / 24 * Math.PI * 2; return [150 + Math.cos(a) * 66, 222 + Math.sin(a) * 66]; });
function machineSvg(L, st, opt = {}) {
  L = L || {};
  const kind = st === 'laeuft' ? (L.phase_kind || 'wash') : 'idle';
  const col = (ST[st] || ST.bereit)[1];
  const open = !!L.door_open, lock = !!L.door_locked;
  let disp = '--:--', dcol = '#58d6ff';
  if (st === 'laeuft' || st === 'pausiert') disp = durHM(L.remaining || 0);
  else if (st === 'geplant') { disp = opt.start ? hm(opt.start) : durHM(L.remaining || 0); dcol = '#c9a6ff'; }
  else if (st === 'fertig' || st === 'beendet') { disp = 'End'; dcol = '#5dff9a'; }
  else if (st === 'fehler') { disp = `E${L.error || ''}`.slice(0, 5); dcol = '#ff6a6a'; }
  else if (st === 'getrennt' || st === 'aus' || st === 'unavailable') { disp = ''; }
  else if (opt.idleTime) disp = durHM(opt.idleTime);
  const id = opt.id || 'm';
  const water = ['wash', 'rinse', 'heat', 'weigh', 'steam'].includes(kind);
  const blobs = [['#3d7bd9', -38, 40, 26], ['#e25b5b', 0, 50, 24], ['#f2f2f2', 34, 42, 25], ['#3fb68e', -16, 30, 20], ['#e9b53c', 18, 30, 19]]
    .map(([c, x, y, r], i) => `<ellipse cx="${150 + x}" cy="${222 + y}" rx="${r}" ry="${r * .72}" fill="${c}" opacity=".93" transform="rotate(${i * 37 - 40} ${150 + x} ${222 + y})"/>`).join('');
  return `<svg class="wm k-${kind} s-${st}${open ? ' dopen' : ''}${opt.knit ? ' knit' : ''}" viewBox="0 0 300 380" xmlns="http://www.w3.org/2000/svg" style="--sc:${col};--dc:${dcol}">
  <defs>
    <linearGradient id="${id}b" x1="0" x2="1"><stop offset="0" stop-color="#e9ecef"/><stop offset=".55" stop-color="#fafbfc"/><stop offset="1" stop-color="#cfd4da"/></linearGradient>
    <linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f8"/><stop offset="1" stop-color="#dfe3e7"/></linearGradient>
    <radialGradient id="${id}r" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#4a4f57"/><stop offset=".7" stop-color="#22252a"/><stop offset="1" stop-color="#121417"/></radialGradient>
    <linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdfdfd"/><stop offset=".35" stop-color="#9aa1a9"/><stop offset=".6" stop-color="#e8ebee"/><stop offset="1" stop-color="#6d747c"/></linearGradient>
    <radialGradient id="${id}d" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#aab2ba"/><stop offset=".8" stop-color="#7d868f"/><stop offset="1" stop-color="#4b525a"/></radialGradient>
    <radialGradient id="${id}g" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="rgba(255,255,255,.35)"/><stop offset=".45" stop-color="rgba(255,255,255,.05)"/><stop offset="1" stop-color="rgba(0,0,0,.25)"/></radialGradient>
    <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(120,200,255,.55)"/><stop offset="1" stop-color="rgba(40,110,200,.75)"/></linearGradient>
    <pattern id="${id}h" width="11" height="11" patternUnits="userSpaceOnUse"><circle cx="5.5" cy="5.5" r="1.6" fill="rgba(30,34,40,.55)"/></pattern>
    <clipPath id="${id}k"><circle cx="150" cy="222" r="80"/></clipPath>
  </defs>
  <ellipse cx="150" cy="368" rx="128" ry="9" fill="rgba(0,0,0,.45)"/>
  <rect x="26" y="352" width="22" height="12" rx="3" fill="#2a2d31"/><rect x="252" y="352" width="22" height="12" rx="3" fill="#2a2d31"/>
  <rect x="10" y="10" width="280" height="348" rx="22" fill="url(#${id}b)" stroke="#aeb4bb" stroke-width="1.2"/>
  <rect x="10" y="10" width="280" height="80" rx="22" fill="url(#${id}p)"/><rect x="10" y="66" width="280" height="24" fill="url(#${id}p)"/>
  <line x1="14" y1="90" x2="286" y2="90" stroke="#c3c8ce" stroke-width="1.5"/>
  <!-- Waschmittelschublade -->
  <rect x="24" y="26" width="78" height="44" rx="7" fill="#eef0f2" stroke="#c0c5cb"/><rect x="36" y="58" width="54" height="5" rx="2.5" fill="#c7ccd2"/>
  <text x="63" y="45" text-anchor="middle" font-size="9" fill="${opt.tankWarn ? '#e0483f' : '#9aa0a7'}" font-family="Rajdhani,sans-serif" font-weight="700" letter-spacing="1.5">${opt.tankWarn ? 'NACHFÜLLEN' : 'HAIER'}</text>
  <!-- Display -->
  <rect x="112" y="24" width="112" height="48" rx="9" fill="#101215" stroke="#3a3f46"/>
  <text class="wdisp" x="168" y="56" text-anchor="middle" font-size="25" font-family="'Share Tech Mono',monospace" fill="var(--dc)">${escH(disp)}</text>
  ${lock ? `<g transform="translate(118 30)" fill="#ffb84d"><rect x="0" y="5" width="9" height="7" rx="1.5"/><path d="M2 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke="#ffb84d" stroke-width="1.4"/></g>` : ''}
  ${L.remote ? `<g transform="translate(206 30)" fill="none" stroke="#58d6ff" stroke-width="1.4"><path d="M1 5a7 7 0 0110 0M3 7.5a4 4 0 016 0"/><circle cx="6" cy="10" r="1" fill="#58d6ff"/></g>` : ''}
  <!-- Drehknopf -->
  <circle cx="258" cy="48" r="22" fill="#e4e7ea" stroke="#b9bfc5"/><circle cx="258" cy="48" r="16" fill="url(#${id}c)"/>
  <circle class="kled" cx="258" cy="48" r="20" fill="none" stroke="var(--sc)" stroke-width="2" stroke-dasharray="3 3.3" opacity=".9"/>
  <!-- Tür -->
  <g class="door">
    <circle cx="150" cy="222" r="108" fill="#d6dade"/>
    <circle cx="150" cy="222" r="102" fill="url(#${id}r)"/>
    <circle cx="150" cy="222" r="92" fill="none" stroke="url(#${id}c)" stroke-width="7"/>
    <circle cx="150" cy="222" r="84" fill="#1a1d21"/>
    <g clip-path="url(#${id}k)">
      <circle cx="150" cy="222" r="80" fill="url(#${id}d)"/>
      <g class="drum"><circle cx="150" cy="222" r="80" fill="url(#${id}h)"/>
        ${[0, 120, 240].map(a => `<rect x="146" y="144" width="8" height="18" rx="3" fill="#69717a" transform="rotate(${a} 150 222)"/>`).join('')}
        <g class="lsp">${blobs}</g></g>
      <g class="lw">${blobs}</g>
      ${water ? `<g class="water"><path class="wave" d="M40 250 q15 -7 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V320 H40Z" fill="url(#${id}w)"/>
        ${[0, 1, 2, 3, 4].map(i => `<circle class="bub b${i}" cx="${118 + i * 16}" cy="292" r="${2 + (i % 3)}" fill="rgba(255,255,255,.7)"/>`).join('')}</g>` : ''}
      ${kind === 'steam' ? `<g class="steam">${[0, 1, 2].map(i => `<path class="st${i}" d="M${130 + i * 20} 260 q-8 -15 0 -30 q8 -15 0 -30" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="5" stroke-linecap="round"/>`).join('')}</g>` : ''}
      <circle cx="150" cy="222" r="80" fill="url(#${id}g)"/>
    </g>
    <rect x="36" y="206" width="12" height="32" rx="5" fill="url(#${id}c)" stroke="#5d646c" stroke-width=".8"/>
  </g>
  <g class="dopening"><circle cx="150" cy="222" r="84" fill="#121417"/><circle cx="150" cy="222" r="76" fill="url(#${id}d)"/><circle cx="150" cy="222" r="76" fill="url(#${id}h)"/>
    <g>${blobs}</g></g>
  <!-- Statuslicht -->
  <rect class="sled" x="110" y="338" width="80" height="4" rx="2" fill="var(--sc)"/>
</svg>`;
}
window.HT_WM = Object.assign(window.HT_WM || {}, { svg: machineSvg, VERSION, ST });

const CSS = `
:host{display:block;height:100%;container-type:inline-size}
*{box-sizing:border-box;margin:0}
.root{height:100%;color:#c9ccd2;line-height:1.2;font-family:Rajdhani,'Segoe UI',sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  display:flex;flex-direction:column;gap:12px;padding:16px 18px;position:relative;overflow:hidden}
.root.plate,.sec.plate{border-radius:20px;background:linear-gradient(180deg,rgba(50,52,58,calc(.78 * var(--pt,1))),rgba(24,25,29,calc(.88 * var(--pt,1))));
  border:1px solid rgba(255,255,255,.07);box-shadow:0 0 0 1px #000,inset 0 1px 0 rgba(255,255,255,.14),inset 0 -1px 0 rgba(0,0,0,.6),0 20px 36px rgba(0,0,0,.55)}
.root.bare{padding:0}
.mono{font-family:'Share Tech Mono',monospace}
/* Bereiche (je eigene Fläche) */
.secs{flex:1;min-height:0;display:grid;gap:14px;grid-template-columns:minmax(0,.95fr) minmax(0,1.15fr) minmax(0,1fr);grid-template-rows:minmax(0,1.75fr) minmax(0,1fr);
  grid-template-areas:"u b a" "u b p"}
.secs.two{grid-template-columns:minmax(260px,.42fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);grid-template-areas:"u x"}.secs>.s-bereiche{grid-area:x}
.secs>.s-uebersicht{grid-area:u}.secs>.s-bedienung{grid-area:b}.secs>.s-auswertung{grid-area:a}.secs>.s-pflege{grid-area:p}
@container (max-width:900px){.secs{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto auto;grid-template-areas:"u b" "a p"}}
@container (max-width:560px){.secs{grid-template-columns:minmax(0,1fr);grid-template-areas:"u" "b" "a" "p"}}
.sec{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;height:100%;overflow:hidden}
.sec.plate{padding:14px 16px}
.sec.inset{padding:12px 14px;border-radius:16px;background:rgba(0,0,0,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 0 0 1px rgba(255,255,255,.04)}
.head{display:flex;align-items:center;gap:10px;min-height:26px;flex:none}
.head h2{font-size:17px;letter-spacing:2.5px;text-transform:uppercase;color:#e2e4e8;line-height:1.1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head .r{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:12.5px;color:#8d929b;font-family:'Share Tech Mono',monospace;white-space:nowrap}
.head .r ha-icon{--mdc-icon-size:17px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;letter-spacing:1.8px;font-weight:700;text-transform:uppercase;white-space:nowrap;
  color:var(--c);background:rgba(0,0,0,.3);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 45%,transparent)}
.cap{font-size:12px;letter-spacing:2.5px;color:#9a9fa8;font-weight:700;text-transform:uppercase;display:flex;align-items:center;gap:8px;flex:none;white-space:nowrap}
.cap .r{margin-left:auto;font-family:'Share Tech Mono',monospace;letter-spacing:0;font-weight:400;font-size:13px;color:#8d929b;overflow:hidden;text-overflow:ellipsis}
/* Tasten wie im Raum-Panel */
.hk{height:40px;border-radius:9px;display:flex;align-items:center;justify-content:center;gap:7px;padding:0 10px;font-size:13.5px;letter-spacing:1.8px;font-weight:700;text-transform:uppercase;color:#9a9ea6;
  background:linear-gradient(180deg,#34363b,#222327);box-shadow:0 4px 0 #0b0b0c,0 6px 10px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.1);cursor:pointer;transition:transform .08s;
  white-space:nowrap;overflow:hidden;min-width:0;border:0;font-family:inherit}
.hk i{width:14px;height:4px;border-radius:2px;background:#3a3c41;box-shadow:inset 0 1px 2px #000;flex:none}
.hk.on{transform:translateY(3px);color:#f0f1f3;box-shadow:0 1px 0 #0b0b0c,0 3px 6px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1)}
.hk.on i{background:var(--c,#4dc3ff);box-shadow:0 0 10px var(--c,#4dc3ff)}
.hk:active{transform:translateY(4px)}
.hk.sm{height:32px;font-size:12px;letter-spacing:1.4px;border-radius:8px;gap:6px;padding:0 6px;box-shadow:0 3px 0 #0b0b0c,0 5px 8px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1)}
.hk.sm.on{transform:translateY(2px);box-shadow:0 1px 0 #0b0b0c,0 3px 5px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1)}
.hk.sm i{width:10px;height:3px}
.hk.ic{width:40px;padding:0;flex:none;font-size:20px;letter-spacing:0}
.hk.busy,.na .hk,.hk.na{pointer-events:none}.hk.na,.na .hk{opacity:.5;filter:grayscale(.7)}
.hk.arm{color:#ff8a8a;animation:wmpulse .9s ease-in-out infinite}
.keys{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));grid-auto-flow:column;gap:8px;flex:none}
.rk{height:56px;border-radius:13px;position:relative;overflow:hidden;display:flex;align-items:center;gap:14px;padding:0 18px 4px;color:#9a9ea6;flex:none;cursor:pointer;
  background:linear-gradient(180deg,#36383d,#222327);box-shadow:0 5px 0 #0b0b0c,0 8px 14px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.1);transition:transform .08s}
.rk::before{content:"";position:absolute;inset:0;background:linear-gradient(125deg,rgba(255,255,255,.08),rgba(255,255,255,0) 38%);pointer-events:none}
.rk::after{content:"";position:absolute;left:18px;right:18px;bottom:6px;height:3px;border-radius:2px;background:var(--c,#3a3c41);box-shadow:0 0 10px var(--c,transparent)}
.rk ha-icon{--mdc-icon-size:26px;color:var(--c);filter:drop-shadow(0 0 5px var(--c));flex:none}
.rk .nm{font-size:12px;letter-spacing:2.5px;font-weight:700;text-transform:uppercase;color:#9a9ea6;line-height:1}
.rk .st{font-size:21px;letter-spacing:2.5px;font-weight:700;text-transform:uppercase;line-height:1.1;color:#e8e9ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rk .t{min-width:0}
.rk .since{margin-left:auto;text-align:right;font-family:'Share Tech Mono',monospace;font-size:12.5px;color:#8d929b;line-height:1.25;flex:none}
.rk .since b{display:block;font-weight:400;font-size:17px;color:#c9ccd2}
.rk:active{transform:translateY(4px)}
.rk.dis{cursor:default;opacity:.55;filter:grayscale(.6)}.rk.dis:active{transform:none}
.rk.busy{pointer-events:none;opacity:.7}
.tabs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px;padding:4px;border-radius:11px;background:rgba(0,0,0,.35);box-shadow:inset 0 2px 6px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.05);flex:none}
.tab{position:relative;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 8px;font-size:11.5px;letter-spacing:1.6px;font-weight:700;text-transform:uppercase;color:#9a9fa8;cursor:pointer;white-space:nowrap}
.tab.on{color:#f0f1f3;background:linear-gradient(180deg,#3a3c42,#26272b);box-shadow:0 3px 0 #0b0b0c,0 5px 10px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.12)}
.tab.on::after{content:"";position:absolute;left:12px;right:12px;bottom:3px;height:2px;border-radius:1px;background:var(--tc,#4dc3ff);box-shadow:0 0 6px var(--tc,#4dc3ff)}
/* Display wie im Raum-Panel */
.lcd{position:relative;border-radius:11px;padding:10px 13px;background:linear-gradient(180deg,rgba(17,14,10,var(--lcda,1)),rgba(6,5,4,var(--lcda,1)));
  box-shadow:inset 0 4px 10px rgba(0,0,0,var(--lcda,1)),0 1px 0 rgba(255,255,255,calc(.08 * var(--lcda,1)));overflow:hidden;min-width:0}
.lcd::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,calc(.18 * var(--lcda,1))) 0 1px,transparent 1px 3px),linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,0) 40%)}
.lcd .l1{display:flex;align-items:baseline;gap:8px;min-width:0}
.lcd .pn{font-size:19px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#e8e9ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.lcd .ph{margin-left:auto;font-size:12.5px;letter-spacing:1.8px;font-weight:700;text-transform:uppercase;color:var(--c);white-space:nowrap}
.lcd .big{font-family:'Share Tech Mono',monospace;font-size:34px;line-height:1;color:var(--c);text-shadow:0 0 16px color-mix(in srgb,var(--c) 60%,transparent);margin:6px 0 2px;white-space:nowrap}
.lcd .big small{font-size:16px;color:#8d929b;margin-left:6px}
.lcd .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:6px;margin-top:6px}
.lcd .row .k{font-size:10.5px;letter-spacing:1.8px;font-weight:700;color:#9a9fa8;text-transform:uppercase;white-space:nowrap}
.lcd .row .v{font-family:'Share Tech Mono',monospace;font-size:16px;color:#e8e9ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lcd .note{font-family:'Share Tech Mono',monospace;font-size:12.5px;color:#a6aab2;margin-top:6px;line-height:1.3}
.prog{height:6px;border-radius:3px;background:#15161a;box-shadow:inset 0 1px 2px #000;position:relative;overflow:hidden;margin-top:8px}
.prog i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--c);box-shadow:0 0 8px var(--c);transition:width 1s}
.phs{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}
.phs span{font-size:10.5px;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;color:#8a8f98;padding:2px 7px;border-radius:6px;background:rgba(255,255,255,.04)}
.phs span.on{color:#0b0c0e;background:var(--c);box-shadow:0 0 10px var(--c)}.phs span.dn{color:#9aa0a7}
.done .t1{font-size:24px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${C.ok};text-shadow:0 0 14px rgba(61,220,132,.5);animation:wmpulse 1.8s ease-in-out infinite}
/* Übersicht */
.ov{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;flex:none;min-height:0}
.pc{position:relative;flex:1 1 auto;min-height:56px;border-radius:11px;background:rgba(0,0,0,.22);box-shadow:inset 0 2px 5px rgba(0,0,0,.45);overflow:hidden;display:flex;flex-direction:column}
.pc .cap{padding:7px 10px 0}
.pc svg.sp{position:absolute;left:0;right:0;bottom:0;width:100%;height:calc(100% - 26px);opacity:.9}
.pc .empty{margin:auto}
.btabs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px;padding:4px;border-radius:12px;background:rgba(0,0,0,.35);box-shadow:inset 0 2px 6px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.05);flex:none}
.btabs .tab{height:40px;font-size:13.5px;letter-spacing:2px;gap:8px}
.btabs .tab em{font-style:normal;font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:0;min-width:20px;height:20px;line-height:20px;border-radius:10px;padding:0 6px;background:${C.bad};color:#fff;box-shadow:0 0 8px ${C.bad}}
.bbody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:hidden}
.sec{container-type:inline-size}
@container (max-width:380px){.head h2{font-size:14px;letter-spacing:1.4px}.head .chip{padding:2px 8px;font-size:11px;letter-spacing:1.2px}.keys .hk{letter-spacing:1px;font-size:12.5px}}
.bd2{display:grid;gap:10px 18px;flex:1 1 auto;min-height:0;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;grid-template-areas:"l" "r" "s"}
.bd2>.bl{grid-area:l;display:flex;flex-direction:column;gap:10px;min-width:0}.bd2>.br{grid-area:r;display:flex;flex-direction:column;gap:8px;min-height:0;min-width:0}.bd2>.bs{grid-area:s;display:flex;flex-direction:column;gap:6px;min-width:0}
@container (min-width:720px){.bd2{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);grid-template-rows:minmax(0,1fr) auto;grid-template-areas:"l r" "s r"}.bd2 .favs{grid-template-columns:repeat(2,minmax(0,1fr))}.bd2 .favs .hk{height:52px}}
.aw{display:flex;flex-direction:column;gap:10px;flex:1 1 auto;min-height:0}
.aw>.al,.aw>.ar{display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0}.aw>.al{flex:1 1 auto}.aw>.ar{flex:0 1 auto}
@container (min-width:720px){.aw{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px}.aw>.ar{flex:1 1 auto}.aw .tiles.t4{grid-template-columns:repeat(2,minmax(0,1fr))}.aw .hist{flex:1 1 auto}}
.chart .plot .pr2{flex:1;min-width:0;display:flex;align-items:flex-end;gap:1px;height:100%}
.chart .plot .pr2 i{flex:1}
.chart .plot i.m{--bc:#b48cff}
.lg{display:flex;gap:14px;font-size:11.5px;letter-spacing:1.4px;font-weight:700;text-transform:uppercase;color:#959aa3;flex-wrap:wrap}
.lg span{display:flex;align-items:center;gap:6px}.lg i{width:10px;height:10px;border-radius:3px;background:var(--c);box-shadow:0 0 6px var(--c)}
.cmp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;flex:none}
@container (min-width:720px){.tasks.wide{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:8px 12px}}
.mach{height:100%;min-height:0;display:flex;align-items:center;justify-content:center;width:clamp(96px,30cqw,150px)}
.mach svg{width:100%;height:auto;max-height:100%;overflow:visible;filter:drop-shadow(0 12px 18px rgba(0,0,0,.55))}
.ovr{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;justify-content:center}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;flex:none}
.tiles.t4{grid-template-columns:repeat(4,minmax(0,1fr))}
.tile{position:relative;overflow:hidden;border-radius:11px;padding:7px 10px;background:rgba(0,0,0,.25);box-shadow:inset 0 2px 5px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.05);min-width:0}
.tile .n{font-size:10.5px;letter-spacing:1.6px;font-weight:700;color:#8a8e96;text-transform:uppercase;display:flex;align-items:center;gap:5px;white-space:nowrap;overflow:hidden}
.tile .n ha-icon{--mdc-icon-size:14px;color:var(--ic,#959aa3)}
.tile .val{font-family:'Share Tech Mono',monospace;font-size:20px;color:var(--vc,#e8e9ec);line-height:1.1;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .val small{font-size:12px;color:#8a8e96}
.tile .sub{font-family:'Share Tech Mono',monospace;font-size:11.5px;color:#9a9fa8;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile svg.sp{position:absolute;left:0;right:0;bottom:0;width:100%;height:55%;opacity:.55;pointer-events:none}
.tk{display:flex;align-items:center;gap:7px;margin-top:4px;font-size:12.5px;font-weight:600;color:#c9ccd2;white-space:nowrap}
.tk i{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 7px var(--c);flex:none}
.tk b{margin-left:auto;font-family:'Share Tech Mono',monospace;font-weight:400;font-size:13px;color:var(--c)}
.tk small{font-family:'Share Tech Mono',monospace;font-size:10.5px;color:#959aa3}
.bar{height:6px;border-radius:3px;margin-top:5px;background:#15161a;box-shadow:inset 0 1px 2px #000;position:relative;overflow:hidden}
.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--vc);box-shadow:0 0 8px var(--vc)}
.warn{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:11px;background:rgba(255,159,46,.1);box-shadow:inset 0 0 0 1px rgba(255,159,46,.45);color:${C.warn};font-size:13.5px;font-weight:600;flex:none}
.warn ha-icon{--mdc-icon-size:20px}.warn .hk{margin-left:auto;height:32px}
/* Bedienung */
.favs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;flex:none}
.favs .hk{height:46px;flex-direction:column;gap:2px;justify-content:center;padding:4px 8px;letter-spacing:1.2px;font-size:12.5px}
.favs .hk span{display:flex;align-items:center;gap:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.favs .hk small{font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:0;font-weight:400;color:#9a9fa8;text-transform:none}
.opts{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0}
.ol{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;align-items:center}
.ol>label{font-size:11.5px;letter-spacing:1.6px;font-weight:700;color:#8a8e96;text-transform:uppercase;line-height:1.1}
.ol>label small{display:block;font-family:'Share Tech Mono',monospace;letter-spacing:0;font-weight:400;font-size:12px;color:#c9ccd2;text-transform:none;margin-top:2px}
.row2{display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr));gap:6px}
.step{display:grid;grid-template-columns:40px minmax(0,1fr) 40px;gap:6px;align-items:center}
.step .val{text-align:center;font-family:'Share Tech Mono',monospace;font-size:17px;color:#e8e9ec;background:rgba(0,0,0,.3);border-radius:8px;height:32px;line-height:32px;box-shadow:inset 0 1px 3px rgba(0,0,0,.6);white-space:nowrap;overflow:hidden}
.step .hk{height:32px;width:40px;padding:0;font-size:18px;letter-spacing:0}
.steps2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.steps2 .ol{grid-template-columns:minmax(0,1fr);gap:4px}
.sws{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.sws .hk{height:36px;font-size:11.5px;letter-spacing:1px;justify-content:flex-start;padding:0 9px}
.sws .hk span{overflow:hidden;text-overflow:ellipsis}
.locked{position:relative}.locked .opts,.locked .favs{opacity:.45;pointer-events:none;filter:grayscale(.5)}
.hint{font-family:'Share Tech Mono',monospace;font-size:12px;color:#8d929b;line-height:1.35;flex:none}
.hint.w{color:${C.warn}}.hint.e{color:#ff8a8a}.hint.ok{color:${C.ok}}
/* Auswertung */
.chart{position:relative;flex:1 1 auto;min-height:70px;display:flex;flex-direction:column}
.chart .plot{position:relative;flex:1;min-height:0;display:flex;align-items:flex-end;gap:2px;padding:14px 0 0;border-bottom:1px solid rgba(255,255,255,.08)}
.chart .plot i{flex:1;min-width:0;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,var(--bc),color-mix(in srgb,var(--bc) 35%,#000));box-shadow:0 0 6px color-mix(in srgb,var(--bc) 35%,transparent);min-height:1px;position:relative}
.chart .plot i.cur{background:linear-gradient(180deg,#fff,var(--bc))}
.chart .plot i b{position:absolute;top:-14px;left:50%;transform:translateX(-50%);font:400 10px 'Share Tech Mono',monospace;color:#a6aab2;white-space:nowrap}
.chart .avg{position:absolute;left:0;right:0;border-top:1px dashed rgba(255,255,255,.25);pointer-events:none}
.chart .avg span{position:absolute;right:0;top:-13px;font:400 10px 'Share Tech Mono',monospace;color:#8d929b}
.chart .ax{display:flex;gap:2px;margin-top:3px}.chart .ax span{flex:1;min-width:0;text-align:center;font-size:9.5px;letter-spacing:.5px;color:#959aa3;font-weight:700;white-space:nowrap;overflow:hidden}
.chart .sum{font-family:'Share Tech Mono',monospace;font-size:12px;color:#8d929b;margin-top:4px;display:flex;justify-content:space-between;gap:8px}
.hist{display:flex;flex-direction:column;gap:5px;overflow:hidden;min-height:0;flex:0 1 auto}
.hi{display:grid;grid-template-columns:auto minmax(0,1fr) 70px auto;gap:2px 10px;align-items:center;padding:5px 9px;border-radius:9px;background:rgba(0,0,0,.22);flex:none}
.hi ha-icon{--mdc-icon-size:18px;color:var(--c)}
.hi .a b{font-size:13px;font-weight:700;letter-spacing:.8px;color:#d6d8dc;text-transform:uppercase;white-space:nowrap}
.hi .a div{font-family:'Share Tech Mono',monospace;font-size:11.5px;color:#9a9fa8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hi svg{width:70px;height:24px}
.hi .z{text-align:right;font-family:'Share Tech Mono',monospace;font-size:11.5px;color:#a6aab2;line-height:1.3;white-space:nowrap}
.empty{font-family:'Share Tech Mono',monospace;font-size:12.5px;color:#959aa3;text-align:center;padding:10px}
/* Pflege */
.tasks{display:flex;flex-direction:column;gap:6px;overflow:hidden;min-height:0;flex:1 1 auto}
.ta{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1px 10px;align-items:center;padding:4px 9px;border-radius:9px;background:rgba(0,0,0,.22);flex:none}
.ta .nm{font-size:13px;font-weight:700;letter-spacing:.8px;color:#d6d8dc;text-transform:uppercase;display:flex;align-items:center;gap:7px;cursor:pointer;white-space:nowrap;overflow:hidden}
.ta .nm ha-icon{--mdc-icon-size:16px;color:var(--vc)}
.ta .nm .sb{margin-left:auto;padding-left:8px;text-transform:none;letter-spacing:0;font-weight:400}
.ta .sb{font-family:'Share Tech Mono',monospace;font-size:11.5px;color:#9a9fa8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ta .bar{grid-column:1/-1;margin-top:1px;height:4px}
.ta.due{box-shadow:inset 0 0 0 1px ${C.warn}}
.ta .hn{grid-column:1/-1;font-size:12px;color:#8d929b;line-height:1.3}
.setr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;flex:none}
.err{padding:12px;border-radius:12px;background:rgba(255,90,90,.12);color:#ff8a8a;font-size:13px}
/* Maschine (SVG) */
.wm .drum,.wm .lw,.wm .lsp{transform-box:view-box;transform-origin:150px 222px}
.wm .lsp{display:none}
.wm.k-wash .drum,.wm.k-rinse .drum,.wm.k-tumble .drum{animation:wmtumble 2.8s ease-in-out infinite alternate}
.wm.k-rinse .drum{animation-duration:3.4s}
.wm.k-wash .lw,.wm.k-rinse .lw,.wm.k-tumble .lw{animation:wmroll 2.8s ease-in-out infinite alternate}
.wm.k-spin .lw{display:none}.wm.k-spin .lsp{display:block}
.wm.k-spin .drum{animation:wmspin .32s linear infinite;filter:blur(.6px)}
.wm.k-weigh .drum,.wm.k-heat .drum,.wm.k-steam .drum{animation:wmtumble 5s ease-in-out infinite alternate}
.wm.knit .drum,.wm.knit .lw{animation:wmknit 10s ease-in-out infinite}
.wm.s-pausiert .drum,.wm.s-pausiert .lw,.wm.s-pausiert .wave,.wm.s-pausiert .bub{animation-play-state:paused}
.wm .wave{animation:wmwave 2.2s linear infinite}
.wm .bub{animation:wmbub 2.6s ease-in infinite;opacity:0}.wm .b1{animation-delay:.5s}.wm .b2{animation-delay:1.1s}.wm .b3{animation-delay:1.6s}.wm .b4{animation-delay:2.1s}
.wm .steam path{animation:wmsteam 2.4s ease-in-out infinite;opacity:0}.wm .st1{animation-delay:.8s}.wm .st2{animation-delay:1.6s}
.wm .sled{filter:drop-shadow(0 0 6px var(--sc))}
.wm.s-laeuft .kled{animation:wmled 3s linear infinite;transform-box:view-box;transform-origin:258px 48px}
.wm.s-fertig .sled,.wm.s-fertig .kled{animation:wmpulse 1.6s ease-in-out infinite}
.wm.s-fehler .sled{animation:wmpulse .8s ease-in-out infinite}
.wm .wdisp{filter:drop-shadow(0 0 4px var(--dc))}
.wm .dopening{display:none}.wm.dopen .dopening{display:block}
.wm.dopen .door{transform-box:view-box;transform-origin:42px 222px;transform:perspective(600px) rotateY(-62deg)}
.wm.s-getrennt,.wm.s-aus,.wm.s-unavailable{filter:grayscale(.6) brightness(.85)}
@keyframes wmtumble{from{transform:rotate(-80deg)}to{transform:rotate(80deg)}}
@keyframes wmroll{0%{transform:rotate(-28deg) translateY(4px)}50%{transform:rotate(0deg) translateY(-14px)}100%{transform:rotate(28deg) translateY(4px)}}
@keyframes wmspin{to{transform:rotate(360deg)}}
@keyframes wmknit{0%,70%{transform:rotate(0deg)}85%{transform:rotate(140deg)}100%{transform:rotate(0deg)}}
@keyframes wmwave{to{transform:translateX(-60px)}}
@keyframes wmbub{0%{opacity:0;transform:translateY(0)}15%{opacity:.9}100%{opacity:0;transform:translateY(-70px)}}
@keyframes wmsteam{0%{opacity:0;transform:translateY(10px)}40%{opacity:.8}100%{opacity:0;transform:translateY(-30px)}}
@keyframes wmled{to{transform:rotate(360deg)}}
@keyframes wmpulse{50%{opacity:.35}}
/* Baustein allein (teil:) */
.root.teil{padding:0;gap:8px;height:100%;min-height:0}
.teil>.sec{flex:1 1 auto}
`;

const OV_CSS = `
.wmov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(5,6,8,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-family:Rajdhani,'Segoe UI',sans-serif;-webkit-user-select:none;user-select:none}
.wmov .box{width:min(94vw,1180px);max-height:90vh;display:flex;flex-direction:column;border-radius:20px;padding:16px 18px;color:#c9ccd2;background:linear-gradient(180deg,rgba(50,52,58,.96),rgba(24,25,29,.98));
  border:1px solid rgba(255,255,255,.07);box-shadow:0 0 0 1px #000,inset 0 1px 0 rgba(255,255,255,.14),0 30px 60px rgba(0,0,0,.7)}
.wmov .hd{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.wmov h2{flex:1;font-size:19px;letter-spacing:2.5px;text-transform:uppercase;color:#e2e4e8}
.wmov .x{width:44px;height:40px;border:0;border-radius:10px;color:#c9ccd2;background:linear-gradient(180deg,#34363b,#222327);box-shadow:0 3px 0 #0b0b0c;cursor:pointer;font-size:20px}
.wmov .bd{overflow:auto;padding-right:4px}
.wmov h3{font-size:12.5px;letter-spacing:2.5px;color:#9a9fa8;font-weight:700;text-transform:uppercase;margin:12px 0 7px;display:flex;align-items:center;gap:7px}
.wmov h3 ha-icon{--mdc-icon-size:16px}
.wmov .gl{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.wmov .it{position:relative;display:flex;align-items:center;gap:8px;padding:10px 40px 10px 12px;border-radius:11px;cursor:pointer;min-height:48px;
  background:linear-gradient(180deg,#303237,#1f2024);box-shadow:0 3px 0 #0b0b0c,inset 0 1px 0 rgba(255,255,255,.08)}
.wmov .it b{font-size:14.5px;letter-spacing:.8px;color:#d6d8dc;text-transform:uppercase;line-height:1.1}
.wmov .it small{display:block;font-family:'Share Tech Mono',monospace;font-size:11.5px;color:#9a9fa8;font-weight:400;text-transform:none;letter-spacing:0}
.wmov .it.on{box-shadow:inset 0 0 0 1.5px #4dc3ff,0 0 14px rgba(77,195,255,.3)}
.wmov .st{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:#8a8f98;--mdc-icon-size:21px}
.wmov .st.on{color:#ffc34d;filter:drop-shadow(0 0 5px #ffc34d)}
.wmov .ed{display:grid;grid-template-columns:120px 1fr;gap:8px 10px;align-items:center;margin-top:6px}
.wmov .ed label{font-size:12px;letter-spacing:1.5px;font-weight:700;color:#8a8e96;text-transform:uppercase}
.wmov .ed input,.wmov .ed textarea{width:100%;background:#15161a;border:1px solid #33363c;border-radius:8px;color:#e8e9ec;padding:8px 10px;font-family:'Share Tech Mono',monospace;font-size:14px}
.wmov .bt{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
.wmov .bt button{border:0;border-radius:9px;height:42px;padding:0 18px;font-family:inherit;font-size:14px;letter-spacing:1.6px;font-weight:700;text-transform:uppercase;color:#c9ccd2;cursor:pointer;
  background:linear-gradient(180deg,#34363b,#222327);box-shadow:0 3px 0 #0b0b0c}
.wmov .bt button.pri{background:linear-gradient(180deg,#2a6d8f,#1b4a62);color:#fff}
.wmov .bt button.del{color:#ff8a8a;margin-right:auto}
`;

// Leistungskurve als kleine Linie: curve = [[Minute, Watt], …]
const spark = (curve, w, h, col, fill = true) => {
  if (!curve || curve.length < 2) return '';
  const xs = curve.map(c => c[0]), x0 = xs[0], x1 = Math.max(x0 + 1, xs[xs.length - 1]), mx = Math.max(50, ...curve.map(c => c[1]));
  const pts = curve.map(c => [((c[0] - x0) / (x1 - x0) * w).toFixed(1), (h - c[1] / mx * (h - 2) - 1).toFixed(1)]);
  const d = 'M' + pts.map(p => p.join(',')).join('L');
  return `<svg class="sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${fill ? `<path d="${d}L${w},${h}L0,${h}Z" fill="${col}" opacity=".25"/>` : ''}<path d="${d}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
};
// Stromverbrauch der Steckdose aus der HA-Langzeitstatistik (auch vor washer_control, z. B. seit 2023)
const loadPw = (hass, w, eid, per) => {
  const s = S(w); s.pw = s.pw || {};
  const key = `${eid}|${per}`, c = s.pw[key];
  if (!eid || (c && (c.p || Date.now() - c.at < 600000))) return;
  const n = new Date(), start = per === 'day' ? new Date(n.getFullYear(), n.getMonth(), n.getDate() - 29) : new Date(n.getFullYear(), n.getMonth() - 11, 1);
  s.pw[key] = { p: true, at: Date.now(), data: c && c.data };
  hass.callWS({ type: 'recorder/statistics_during_period', start_time: start.toISOString(), statistic_ids: [eid], period: per, types: ['change'], units: { energy: 'kWh' } })
    .then(r => { s.pw[key] = { at: Date.now(), data: (r[eid] || []).map(x => ({ t: new Date(x.start), v: Number(x.change) || 0 })) }; emit(w); })
    .catch(() => { s.pw[key] = { at: Date.now(), data: null }; emit(w); });
};
const BEREICHE = { uebersicht: 'Waschmaschine', bedienung: 'Programm', auswertung: 'Statistik', pflege: 'Pflege & Reinigung' };
const TABS = [['bedienung', 'Programm'], ['auswertung', 'Statistik'], ['pflege', 'Pflege']];

class HtWaschmaschineCard extends HTMLElement {
  static getStubConfig() { return { washer: 'ku_washer' }; }
  // Bausteine = getrennte Bereiche (jeder für sich, z. B. je ein Rahmen im raum-panel)
  static get rpTeile() { return { uebersicht: { h: 700 }, bereiche: { h: 700 }, bedienung: { h: 700 }, auswertung: { h: 440 }, pflege: { h: 250 } }; }
  static get rpDesign() { return { breite: 1240, hoehe: 740 }; }
  static get rpStart() {
    return {
      grid: { columns: 24, row_height: 20, gap: 6, width: 1240 },
      elements: { uebersicht: { col: 1, row: 1, w: 7, h: 28 }, bereiche: { col: 8, row: 1, w: 17, h: 28 } },
    };
  }
  static get rpOptionen() {
    return {
      platten: { name: 'Bereiche mit eigener Glasplatte', typ: 'schalter', standard: false, hinweis: 'Jeder Bereich bekommt eine eigene Platte (z. B. im Vollbild)' },
      bestaetigen: { name: 'Abbrechen bestätigen', typ: 'schalter', standard: true },
    };
  }

  setConfig(cfg) {
    this._c = Object.assign({}, DEF, cfg || {});
    this._c.teil = this._c.teil ? String(this._c.teil) : null;
    if (this._c.teil) this._c.hintergrund = false;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.addEventListener('click', e => this._click(e));
    }
    loadFonts();
    this._render();
  }
  get _w() { return this._c.washer; }
  get _s() { return S(this._w); }
  connectedCallback() {
    this._s.subs.add(this);
    clearInterval(this._tm);
    this._tm = setInterval(() => { if (this._hass) load(this._hass, this._w); this._render(); }, 30000);
    this._render();
  }
  disconnectedCallback() { this._s.subs.delete(this); clearInterval(this._tm); }
  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    const w = this._w, ids = [`sensor.${w}_status`, `binary_sensor.${w}_done`, `sensor.${w}_maintenance`];
    const key = ids.map(i => { const st = h.states[i]; return st ? st.last_updated : '-'; }).join('|');
    const s = this._s;
    if (first || key !== s.key) { const force = s.key != null && key !== s.key; s.key = key; load(h, w, force); }
    if (!s.cat) loadCat(h, w);
    // Leistung der Steckdose live (ohne neuen Abruf)
    const pe = s.snap && s.snap.plug && s.snap.plug.entities && s.snap.plug.entities.power, ps = pe && h.states[pe];
    const pk = ps ? ps.state : null;
    if (first) this._render();
    else if (pk !== this._pk && (!this._c.teil || this._c.teil === 'uebersicht')) this._render();
    this._pk = pk;
  }
  getCardSize() { return 12; }

  // ---------------------------------------------------------------- Darstellung
  _render() {
    if (!this.shadowRoot || !this._c) return;
    const c = this._c, s = this._s, sn = s.snap;
    const plate = c.platten === true || (c.platten !== false && !c.teil && c.hintergrund !== false);
    const sec = n => `<div class="sec s-${n}${plate ? ' plate' : c.teil ? '' : ' inset'}">${this._part(n)}</div>`;
    let body;
    if (!sn) body = s.err ? `<div class="err">Waschmaschine: ${escH(s.err)}<br>Integration washer_control installiert?</div>` : `<div class="empty">Lade Waschmaschine …</div>`;
    else if (c.teil) body = sec(c.teil);
    else body = `<div class="secs two">${['uebersicht', 'bereiche'].map(sec).join('')}</div>`;
    const cls = c.teil ? `root bare teil t-${escH(c.teil)}` : `root bare`;
    this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="${cls}">${body}</div>`;
  }
  _state() {
    const sn = this._s.snap, h = this._hass, st = h && h.states[`sensor.${this._w}_status`];
    return (st && st.state) || (sn && sn.attached ? 'bereit' : 'unavailable');
  }
  _busyState() { return ['laeuft', 'pausiert', 'geplant'].includes(this._state()); }
  _part(n) {
    try {
      const f = this[`_p_${n}`];
      return f ? f.call(this) : `<div class="empty">Baustein „${escH(n)}“ unbekannt – Bausteine: ${Object.keys(BEREICHE).join(', ')}</div>`;
    } catch (e) { console.error(TAG, n, e); return `<div class="err">${escH(n)}: ${escH(e.message)}</div>`; }
  }
  _power() {
    const sn = this._s.snap, pe = sn.plug && sn.plug.entities && sn.plug.entities.power, st = pe && this._hass && this._hass.states[pe];
    const v = st ? Number(st.state) : (sn.live && sn.live.power);
    return isNaN(v) ? null : v;
  }

  // ---------------- Bereiche (Programm / Statistik / Pflege) mit Umschalter
  _p_bereiche() {
    const s = this._s, cur = TABS.some(t => t[0] === s.ui.tab) ? s.ui.tab : 'bedienung';
    const due = (s.snap.tasks || []).filter(t => t.due).length;
    return `<div class="btabs">${TABS.map(([k, n]) => `<div class="tab${cur === k ? ' on' : ''}" data-act="btab" data-k="${k}">${n}${k === 'pflege' && due ? `<em>${due}</em>` : ''}</div>`).join('')}</div>
      <div class="bbody">${this._part(cur)}</div>`;
  }
  // Gesamt-Energiezähler der Maschine (hOn) – Option strom_maschine, sonst am Gerät gesucht
  _machEnergy() {
    if (this._c.strom_maschine) return this._c.strom_maschine;
    const h = this._hass, sn = this._s.snap; if (!h || !sn || !h.entities) return null;
    const e = Object.values(h.entities).find(x => x.device_id === sn.device_id && x.entity_id.startsWith('sensor.') && /gesamtstrom|total_?electricity|electricity_?total/i.test(x.entity_id));
    return e ? e.entity_id : null;
  }

  // ---------------- Bereich 1: Übersicht (Maschine, laufender Waschgang, Pause/Abbrechen, Verbrauch)
  _p_uebersicht() {
    const s = this._s, sn = s.snap, st = this._state(), [nm, col, ic] = ST[st] || ST.bereit, L = sn.live || {}, cy = sn.cycle, b = s.busy, arm = s.ui.arm;
    const knit = !!L.anti_crease_active && !cy;
    const head = `<div class="head"><h2>${escH(this._c.titel)}</h2><span class="chip" style="--c:${col}"><ha-icon icon="${ic}"></ha-icon>${escH(nm)}</span>
      <div class="r">${L.remote ? `<ha-icon icon="mdi:wifi" style="color:${C.run}" title="Fernstart aktiv"></ha-icon>` : `<ha-icon icon="mdi:wifi-off" title="Fernstart aus"></ha-icon>`}
      ${L.door_locked ? `<ha-icon icon="mdi:lock" style="color:#ffb84d" title="Tür verriegelt"></ha-icon>` : ''}${L.door_open ? '<span>Tür offen</span>' : ''}</div></div>`;
    const sel = selOf(s), P = sel && progOf(s, sel.program);
    const svg = machineSvg(L, st, { id: `wm${this._uid || (this._uid = Math.random().toString(36).slice(2, 7))}`, start: tD(cy && cy.planned_start), idleTime: P && estMin(s, P, sel.params), tankWarn: !!(L.detergent_warn || L.softener_warn), knit });
    // Display
    let lcd;
    if (st === 'fertig' && sn.done) {
      const at = tD(sn.done.at), h0 = sn.history && sn.history[0];
      lcd = `<div class="lcd done" style="--c:${C.ok}"><div class="l1"><div class="pn">${escH(sn.done.name || '')}</div><div class="ph">${at ? hm(at) + ' Uhr' : ''}</div></div>
        <div class="t1">Wäsche fertig</div><div class="note">${at ? sinceT(at) : ''}${h0 ? ` · ${durM(h0.minutes)}` : ''}</div>
        <div class="note" style="color:${knit ? C.run : '#8d929b'}">${knit ? '↻ Knitterschutz aktiv – die Trommel dreht in Abständen, bis die Tür geöffnet wird' : sn.done.anti_crease === 0 ? 'Knitterschutz war aus' : ''}</div></div>`;
    } else if (cy && ['laeuft', 'pausiert', 'geplant'].includes(st)) {
      const start = tD(cy.start), end = tD(cy.end), ps = tD(cy.planned_start), rem = end ? Math.max(0, (end - Date.now()) / 60000) : L.remaining;
      const seen = cy.phases || [], curK = L.phase_kind;
      lcd = `<div class="lcd" style="--c:${col}"><div class="l1"><div class="pn">${escH(cy.name || L.program_name || 'Programm')}</div><div class="ph">${st === 'laeuft' ? escH(L.phase_name || nm) : escH(nm)}</div></div>
        <div class="big">${st === 'geplant' ? (ps ? hm(ps) : '--:--') : durHM(rem)}<small>${st === 'geplant' ? 'Start' : 'Rest'}</small></div>
        <div class="row"><div><div class="k">${st === 'geplant' ? 'Start' : 'Gestartet'}</div><div class="v">${start ? hm(start) : ps ? hm(ps) : '–'}</div></div>
          <div><div class="k">Ende</div><div class="v">${end ? hm(end) : '–'}</div></div>
          <div><div class="k">°C · U/min</div><div class="v">${cy.temp != null ? (cy.temp === 0 ? 'kalt' : cy.temp + '°') : '–'} · ${cy.spin ?? '–'}</div></div></div>
        ${st !== 'geplant' ? `<div class="prog"><i style="width:${Math.round((cy.progress || 0) * 100)}%"></i></div>
        <div class="phs">${['wash', 'rinse', 'spin'].map(k => `<span class="${k === curK && st === 'laeuft' ? 'on' : seen.includes(k) ? 'dn' : ''}">${KIND_TXT[k]}</span>`).join('')}
          ${cy.anti_crease ? '<span class="dn">↻ Knitterschutz</span>' : ''}</div>` : ''}</div>`;
    } else {
      const last = sn.history && sn.history[0], le = last && tD(last.end);
      lcd = `<div class="lcd" style="--c:${col}"><div class="l1"><div class="pn">${escH(nm)}</div><div class="ph">${L.remote ? 'Fernstart an' : 'Fernstart aus'}</div></div>
        <div class="big" style="font-size:30px;margin-top:8px">${st === 'getrennt' || st === 'unavailable' ? 'Offline' : st === 'fehler' ? 'E ' + escH(L.error) : 'Bereit'}</div>
        <div class="note">${last ? `Zuletzt: ${escH(last.name)} · ${le ? dayT(le) : ''}` : 'Noch kein Waschgang erfasst'}</div></div>`;
    }
    // Tasten
    const k = (act, txt, c2, on, extra = '') => `<button class="hk${on ? ' on' : ''}${b === act ? ' busy' : ''}${arm === act ? ' arm' : ''}${extra}" data-act="${act}" style="--c:${c2}"><i></i>${txt}</button>`;
    let keys = '';
    if (st === 'laeuft') keys = k('pause', 'Pause', C.warn) + k('stop', arm === 'stop' ? 'Wirklich?' : 'Abbrechen', C.bad);
    else if (st === 'pausiert') keys = k('resume', 'Weiter', C.ok, true) + k('stop', arm === 'stop' ? 'Wirklich?' : 'Abbrechen', C.bad);
    else if (st === 'geplant') keys = k('stop', arm === 'stop' ? 'Wirklich?' : 'Planung löschen', C.bad);
    else if (st === 'fertig') keys = k('ack', 'Ausgeräumt', C.ok);
    // Verbrauch / Steckdose
    const pw = this._power(), pl = sn.plug || {}, act = cy && ['laeuft', 'pausiert'].includes(st);
    // Tanks: die Maschine meldet nur „nachfüllen“ (detWarn/softWarn) – kein echter Füllstand
    const tankAny = !!(L.detergent_warn || L.softener_warn);
    const tank = (n, warn, auto) => { const c2 = warn == null ? C.off : warn ? C.bad : C.ok;
      return `<div class="tk" style="--c:${c2}"><i></i><span>${n}</span><b>${warn == null ? 'k. A.' : warn ? 'nachfüllen' : 'OK'}</b>${auto === 0 ? '<small>Dos. aus</small>' : ''}</div>`; };
    const kwh = act ? (L.plug_kwh ?? cy.energy ?? L.energy) : (sn.history[0] ? (sn.history[0].kwh_plug ?? sn.history[0].energy) : null);
    const wat = act ? (cy.water || L.water) : (sn.history[0] ? sn.history[0].water : null);
    const tiles = `<div class="tiles">
      <div class="tile" style="--vc:${pw > 5 ? C.warn : '#e8e9ec'}"><div class="n"><ha-icon icon="mdi:flash" style="--ic:${C.warn}"></ha-icon>Leistung</div>
        <div class="val">${pw == null ? '–' : fmt(pw)}<small> W</small></div><div class="sub">${act && cy.power_max ? `max ${fmt(cy.power_max)} W` : pl.entities ? 'Steckdose' : 'keine Messung'}</div></div>
      <div class="tile"><div class="n"><ha-icon icon="mdi:lightning-bolt" style="--ic:${C.warn}"></ha-icon>Strom</div><div class="val">${kwh == null ? '–' : fmt(kwh, 2)}<small> kWh</small></div>
        <div class="sub">${act ? 'dieser Waschgang' : 'letzter Waschgang'}${kwh != null && sn.settings && sn.settings.price ? ` · ${fmt(kwh * sn.settings.price, 2)} €` : ''}</div></div>
      <div class="tile"><div class="n"><ha-icon icon="mdi:water" style="--ic:${C.info}"></ha-icon>Wasser</div><div class="val">${wat == null ? '–' : fmt(wat)}<small> l</small></div>
        <div class="sub">${act ? `Beladung ${cy.weight || L.weight ? fmt(cy.weight || L.weight, 1) + ' kg' : '–'}` : 'letzter Waschgang'}</div></div>
      <div class="tile"><div class="n"><ha-icon icon="mdi:bottle-tonic" style="--ic:${tankAny ? C.bad : C.ok}"></ha-icon>Auto-Dosierung</div>
        ${tank('Waschmittel', L.detergent_warn, L.auto_detergent)}${tank('Weichspüler', L.softener_warn, L.auto_softener)}</div></div>`;
    const plugOff = pl.on === false ? `<div class="warn"><ha-icon icon="mdi:power-plug-off"></ha-icon>Steckdose ist aus<button class="hk sm" data-act="plugon" style="--c:${C.ok}"><i></i>Einschalten</button></div>` : '';
    const msg = s.msg && s.msg.where !== 'start' ? `<div class="hint ${s.msg.e ? 'e' : 'ok'}">${escH(s.msg.t)}</div>` : '';
    const lastC = act ? cy.curve : (sn.history[0] && sn.history[0].curve);
    const pc = pl.entities ? `<div class="pc"><div class="cap">Leistung ${act ? 'dieser Waschgang' : 'letzter Waschgang'}<span class="r">${act && cy.power_max ? `max ${fmt(cy.power_max)} W` : !act && sn.history[0] && sn.history[0].power_max ? `max ${fmt(sn.history[0].power_max)} W` : ''}</span></div>
      ${lastC && lastC.length > 1 ? spark(lastC, 300, 80, C.warn) : '<div class="empty">Kurve erscheint beim nächsten Waschgang</div>'}</div>` : '';
    return `${head}<div class="ov"><div class="mach">${svg}</div><div class="ovr">${lcd}${keys ? `<div class="keys">${keys}</div>` : ''}</div></div>${plugOff}${msg}${tiles}${pc}`;
  }

  // ---------------- Bereich 2: Programmwahl + Optionen + Start
  _p_bedienung() {
    const s = this._s, sn = s.snap;
    if (!s.cat) return `<div class="cap">Programm</div><div class="${s.catErr ? 'err' : 'empty'}">${escH(s.catErr || 'Lade Programme …')}</div>`;
    const sel = selOf(s), P = progOf(s, sel.program), st = this._state(), L = sn.live || {}, lock = this._busyState();
    const favs = (sn.favorites || []).map(k => progOf(s, k)).filter(Boolean).slice(0, 5);
    if (!favs.some(p => p.key === sel.program)) favs.splice(4, 1, P);
    const fk = p => `<button class="hk${sel.program === p.key ? ' on' : ''}" data-act="prog" data-k="${escH(p.key)}" style="--c:${C.run}"><span><i></i>${escH(p.name)}</span><small>ca. ${durM(estMin(s, p, sel.program === p.key ? sel.params : null))}</small></button>`;
    const favH = `<div class="favs">${favs.map(fk).join('')}<button class="hk" data-act="all"><span>Alle …</span><small>${s.cat.programs.length} Programme</small></button></div>`;
    // Optionen
    const prm = P.params, v = k => sel.params[k] ?? String((prm[k] || {}).default);
    const keyRow = (k, zero, unit) => {
      const d = prm[k]; if (!d || d.t !== 'enum') return '';
      return `<div class="ol"><label>${escH(PAR[k].n)}<small>${String(v(k)) === '0' && zero ? zero : `${v(k)} ${unit}`}</small></label><div class="row2" style="--n:${d.values.length}">${d.values.map(x =>
        `<button class="hk sm${String(x) === String(v(k)) ? ' on' : ''}" data-act="set" data-k="${k}" data-v="${escH(x)}" style="--c:${C.run}"><i></i>${String(x) === '0' && zero ? zero : escH(x)}</button>`).join('')}</div></div>`;
    };
    const stepper = k => {
      const d = prm[k]; if (!d || d.t !== 'range') return '';
      return `<div class="ol"><label>${escH((PAR[k] || { n: k }).n)}</label><div class="step"><button class="hk" data-act="inc" data-k="${k}" data-d="-1">−</button>
        <div class="val">${escH(v(k))} ${(PAR[k] || {}).u || ''}</div><button class="hk" data-act="inc" data-k="${k}" data-d="1">+</button></div></div>`;
    };
    const isSw = k => { const d = prm[k], m = PAR[k] || {}; return d && (m.sw || (d.t === 'range' && d.min === 0 && (d.max === 1 || d.max === d.step))); };
    const swKeys = ['permanentPressStatus', 'haier_SoakPrewashSelection', 'nightWashStatus', 'autoDetergentStatus', 'autoSoftenerStatus', 'steamStatus', 'energySavingStatus', 'speedUpStatus', 'strongStatus', 'extraRinse', 'antiAllergyStatus']
      .filter(isSw);
    const swName = { permanentPressStatus: '↻ Knitterschutz', haier_SoakPrewashSelection: 'Vorwäsche', nightWashStatus: 'Nachtwäsche', autoDetergentStatus: 'Auto Waschmittel', autoSoftenerStatus: 'Auto Weichspüler' };
    const known = new Set(['temp', 'spinSpeed', 'rinseIterations', 'mainWashTime', ...swKeys, ...HIDE]);
    const adv = Object.keys(prm).filter(k => !known.has(k));
    const sws = `<div class="sws">${swKeys.map(k => `<button class="hk${Number(v(k)) > 0 ? ' on' : ''}" data-act="sw" data-k="${k}" style="--c:${k === 'permanentPressStatus' ? C.ok : C.run}"><i></i><span>${escH(swName[k] || PAR[k].n)}</span></button>`).join('')}
      ${adv.length ? `<button class="hk" data-act="adv"><i></i><span>Weitere (${adv.length})</span></button>` : ''}</div>`;
    const dl = prm.delayTime;
    const delay = dl ? `<div class="ol"><label>Zeitvorwahl<small>${escH(this._delayTxt(sel, P))}</small></label><div class="step"><button class="hk" data-act="delay" data-d="-1">−</button>
      <div class="val">${sel.delay ? `fertig in ${durHM(sel.delay)} h` : 'sofort'}</div><button class="hk" data-act="delay" data-d="1">+</button></div></div>` : '';
    // Start (ein Tipp)
    let startK, hint = '';
    if (lock) {
      const cy = sn.cycle || {}, end = tD(cy.end);
      startK = `<div class="rk dis" style="--c:${(ST[st] || ST.bereit)[1]}"><ha-icon icon="mdi:washing-machine"></ha-icon><div class="t"><div class="nm">${escH((ST[st] || ST.bereit)[0])}</div><div class="st">${escH(cy.name || L.program_name || '')}</div></div>
        <div class="since">Ende<b>${end ? hm(end) : '–'}</b></div></div>`;
      hint = '<div class="hint">Neue Auswahl ist möglich, sobald der Waschgang beendet ist.</div>';
    } else {
      const ok = L.remote && !L.door_open && !['getrennt', 'unavailable'].includes(st) && (sn.plug || {}).on !== false;
      const t = estMin(s, P, sel.params), end = new Date(Date.now() + Math.max(sel.delay || 0, t) * 60000);
      startK = `<div class="rk${ok ? '' : ' dis'}${s.busy === 'start' ? ' busy' : ''}" data-act="${ok ? 'start' : ''}" style="--c:${C.ok}"><ha-icon icon="mdi:play-circle"></ha-icon><div class="t"><div class="nm">${s.busy === 'start' ? 'Sende …' : sel.delay ? 'Starten mit Zeitvorwahl' : 'Starten'}</div><div class="st">${escH(P.name)}</div></div>
        <div class="since">fertig ca.<b>${hm(end)}</b></div></div>`;
      if (!L.remote) hint = '<div class="hint w">Fernstart ist aus – an der Maschine die WLAN-/Fernstart-Taste drücken (Tür zu, Wäsche drin).</div>';
      else if (L.door_open) hint = '<div class="hint w">Tür ist offen – zum Starten schließen.</div>';
      else if ((sn.plug || {}).on === false) hint = '<div class="hint w">Die Steckdose der Maschine ist aus.</div>';
    }
    const msg = s.msg && s.msg.where === 'start' ? `<div class="hint ${s.msg.e ? 'e' : 'ok'}">${escH(s.msg.t)}</div>` : '';
    return `<div class="bd2${lock ? ' locked' : ''}"><div class="bl"><div class="cap">Programm<span class="r">${escH(P.name)} · ca. ${durM(estMin(s, P, sel.params))}${P.anc && P.anc.suggestedLoadW ? ` · max ${P.anc.suggestedLoadW} kg` : ''}</span></div>${favH}</div>
      <div class="br"><div class="cap">Optionen</div><div class="opts">${keyRow('temp', 'Kalt', '°C')}${keyRow('spinSpeed', 'Aus', 'U/min')}
      <div class="steps2">${stepper('rinseIterations')}${stepper('mainWashTime')}</div>
      ${sws}${delay}</div></div><div class="bs">${startK}${hint}${msg}</div></div>`;
  }
  // Zeitvorwahl der Haier-Maschine = Minuten bis zum ENDE des Programms (delayTime, 30-min-Schritte)
  _delayTxt(sel, P) {
    const d = Number(sel.delay) || 0, t = estMin(this._s, P, sel.params), at = m => hm(new Date(Date.now() + m * 60000));
    return d ? `fertig um ${at(d)}, Start ca. ${at(Math.max(0, d - t))}` : `sofort, fertig ca. ${at(t)}`;
  }

  // ---------------- Bereich 3: Statistik mit Verlauf
  _p_auswertung() {
    const s = this._s, sn = s.snap, S0 = sn.stats || {}, ui = s.ui;
    const met = ui.met || 'strom', per = ui.per || 'day';
    const eid = sn.plug && sn.plug.entities && sn.plug.entities.energy, mid = this._machEnergy();
    if (met === 'strom' && this._hass) { if (eid) loadPw(this._hass, this._w, eid, per); if (mid) loadPw(this._hass, this._w, mid, per); }
    // Daten je Tag (30) bzw. Monat (12)
    const n = new Date(), keys = per === 'day'
      ? Array.from({ length: 30 }, (_, i) => new Date(n.getFullYear(), n.getMonth(), n.getDate() - 29 + i))
      : Array.from({ length: 12 }, (_, i) => new Date(n.getFullYear(), n.getMonth() - 11 + i, 1));
    const kf = d => per === 'day' ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    const src = Object.fromEntries((per === 'day' ? S0.days : S0.months || []).map(x => [x.d || x.m, x]));
    let vals, unit, col, dec = 0, plugSrc = false, mvals = null;
    const series = id => { const c0 = id && s.pw && s.pw[`${id}|${per}`], pw = c0 && c0.data; if (!pw) return null; const m = {}; pw.forEach(x => { const k = kf(x.t); m[k] = (m[k] || 0) + x.v; }); return keys.map(d => Math.max(0, m[kf(d)] || 0)); };
    if (met === 'strom') {
      const pv = series(eid); mvals = series(mid);
      if (pv) { vals = pv; plugSrc = true; }
      else vals = keys.map(d => (src[kf(d)] || {}).energy || 0);
      unit = 'kWh'; col = C.warn; dec = per === 'day' ? 2 : 1;
    } else if (met === 'wasser') { vals = keys.map(d => (src[kf(d)] || {}).water || 0); unit = 'l'; col = C.info; }
    else { vals = keys.map(d => (src[kf(d)] || {}).count || 0); unit = 'Wäschen'; col = C.run; }
    const two = met === 'strom' && mvals && plugSrc;
    const mx = Math.max(...vals, ...(two ? mvals : []), 0.0001), sum = vals.reduce((a, b) => a + b, 0), nz = vals.filter(x => x > 0), avg = nz.length ? sum / nz.length : 0;
    const msum = two ? mvals.reduce((a, b) => a + b, 0) : 0;
    const price = sn.settings && sn.settings.price;
    const lab = (d, i) => per === 'day' ? (i % 5 === 4 || i === 29 ? `${d.getDate()}.` : '') : MON[d.getMonth()];
    const bar1 = (x, i) => `<i class="${i === vals.length - 1 ? 'cur' : ''}" style="height:${x / mx * 100}%" title="${kf(keys[i])}: ${fmt(x, dec)} ${unit}${two ? ' (Steckdose)' : ''}">${per === 'month' && x && !two ? `<b>${fmt(x, 0)}</b>` : ''}</i>`;
    const chart = `<div class="chart" style="--bc:${col}"><div class="plot">${vals.map((x, i) => two ? `<div class="pr2"><i class="m" style="height:${mvals[i] / mx * 100}%" title="${kf(keys[i])}: ${fmt(mvals[i], dec)} kWh (Maschine)"></i>${bar1(x, i)}</div>` : bar1(x, i)).join('')}
      ${avg && !two ? `<div class="avg" style="bottom:${avg / mx * 100}%"><span>Ø ${fmt(avg, dec)}</span></div>` : ''}</div>
      <div class="ax">${keys.map((d, i) => `<span>${lab(d, i)}</span>`).join('')}</div>
      <div class="sum"><span>${per === 'day' ? '30 Tage' : '12 Monate'}: ${fmt(sum, met === 'strom' ? 1 : 0)} ${unit}${met === 'strom' && price ? ` · ${fmt(sum * price, 2)} €` : ''}</span><span>${met === 'strom' ? (plugSrc ? 'Steckdose inkl. Standby' : 'laut Waschgängen') : 'erfasste Waschgänge'}</span></div></div>`;
    const dif = msum ? (sum - msum) / msum * 100 : 0;
    const cmp = two ? `<div class="lg"><span style="--c:#b48cff"><i></i>Maschine (hOn)</span><span style="--c:${C.warn}"><i></i>Steckdose (Tasmota)</span></div>
      <div class="cmp"><div class="tile"><div class="n">Maschine</div><div class="val">${fmt(msum, 1)}<small> kWh</small></div><div class="sub">laut Waschmaschine</div></div>
      <div class="tile"><div class="n">Steckdose</div><div class="val">${fmt(sum, 1)}<small> kWh</small></div><div class="sub">${price ? `${fmt(sum * price, 2)} €` : 'gemessen'}</div></div>
      <div class="tile" style="--vc:${Math.abs(dif) > 15 ? C.warn : C.ok}"><div class="n">Differenz</div><div class="val">${sum - msum >= 0 ? '+' : ''}${fmt(sum - msum, 1)}<small> kWh</small></div><div class="sub">${dif >= 0 ? '+' : ''}${fmt(dif, 0)} % · Standby/Messung</div></div></div>` : '';
    const tab = (k, v2, t, c2) => `<div class="tab${(ui[k] || (k === 'met' ? 'strom' : 'day')) === v2 ? ' on' : ''}" data-act="ui" data-k="${k}" data-v="${v2}" style="--tc:${c2 || C.run}">${t}</div>`;
    const lt = S0.lifetime || {}, d30 = S0.d30 || {};
    const tiles = `<div class="tiles t4">
      <div class="tile"><div class="n">30 Tage</div><div class="val">${fmt(d30.count)}</div><div class="sub">Wäschen</div></div>
      <div class="tile"><div class="n">Ø Strom</div><div class="val">${fmt(S0.avg_energy, 2)}<small> kWh</small></div><div class="sub">${price && S0.avg_energy ? `${fmt(S0.avg_energy * price, 2)} € je Wäsche` : 'je Wäsche'}</div></div>
      <div class="tile"><div class="n">Ø Wasser</div><div class="val">${fmt(S0.avg_water)}<small> l</small></div><div class="sub">je Wäsche</div></div>
      <div class="tile"><div class="n">Gesamt</div><div class="val">${fmt(lt.cycles)}</div><div class="sub">${fmt((lt.water || 0) / 1000, 1)} m³ · ${fmt(lt.energy)} kWh</div></div></div>`;
    const H = sn.history || [];
    const ic = r => r === 'fertig' ? ['mdi:check-circle', C.ok] : r === 'abgebrochen' ? ['mdi:close-circle', C.warn] : ['mdi:alert-circle', C.bad];
    const hist = `<div class="hist">${H.length ? H.slice(0, 8).map(h => {
      const [i, c2] = ic(h.result), st = tD(h.start), e = h.kwh_plug ?? h.energy;
      return `<div class="hi" style="--c:${c2}"><ha-icon icon="${i}"></ha-icon><div class="a"><b>${escH(h.name || h.program || '?')}</b>
        <div>${h.temp != null ? (h.temp === 0 ? 'kalt' : h.temp + '°') : ''} · ${fmt(h.water)} l · ${h.kwh_plug != null ? `${fmt(h.kwh_plug, 2)} kWh (Maschine ${fmt(h.energy, 2)})` : `${fmt(e, 2)} kWh`}</div></div>${h.curve ? spark(h.curve, 70, 24, C.warn, false) : '<span></span>'}
        <div class="z">${st ? dayT(st) : ''}<br>${durM(h.minutes)}</div></div>`;
    }).join('') : '<div class="empty">Noch keine Waschgänge erfasst.</div>'}</div>`;
    return `<div class="aw"><div class="al"><div style="display:grid;grid-template-columns:1.5fr 1fr;gap:8px;flex:none"><div class="tabs">${tab('met', 'strom', 'Strom', C.warn)}${tab('met', 'anzahl', 'Wäschen')}${tab('met', 'wasser', 'Wasser', C.info)}</div>
      <div class="tabs">${tab('per', 'day', '30 Tage')}${tab('per', 'month', '12 Monate')}</div></div>
      ${chart}${cmp}</div><div class="ar">${tiles}<div class="cap">Letzte Waschgänge<span class="r">${H.length}</span></div>${hist}</div></div>`;
  }

  // ---------------- Bereich 4: Pflege & Reinigung (eigenständig)
  _p_pflege() {
    const s = this._s, T = s.snap.tasks || [];
    const ico = { drum: 'mdi:washing-machine', filter: 'mdi:filter-outline', drawer: 'mdi:tray', seal: 'mdi:circle-double', drop: 'mdi:water-opacity', tool: 'mdi:wrench' };
    return `<div class="cap">Pflege &amp; Reinigung<span class="r">${T.filter(t => t.due).length} fällig</span>
      <button class="hk sm ic" data-act="tadd" title="Aufgabe hinzufügen">+</button><button class="hk sm ic" data-act="opts" title="Einstellungen">⚙</button></div>
      <div class="tasks wide">${T.map(t => {
        const col = t.due ? C.bad : t.soon ? C.warn : C.ok, pct = Math.min(100, Math.round(t.ratio * 100)), rest = [];
        if (t.days) rest.push(`${Math.max(0, Math.round(t.days - t.days_since))} Tg.`);
        if (t.washes) rest.push(`${Math.max(0, t.washes - t.washes_since)} W.`);
        return `<div class="ta${t.due ? ' due' : ''}" style="--vc:${col}"><div class="nm" data-act="tedit" data-k="${escH(t.id)}"><ha-icon icon="${ico[t.icon] || 'mdi:wrench'}"></ha-icon>${escH(t.name)}
          <span class="sb">${t.due ? 'FÄLLIG' : `in ${rest.join(' / ') || '–'}`}</span></div>
          <button class="hk sm${s.busy === 'tdone' + t.id ? ' busy' : ''}" data-act="tdone" data-k="${escH(t.id)}" style="--c:${C.ok}"><i></i>Erledigt</button><div class="bar"><i style="width:${pct}%"></i></div>
          ${s.ui.open === t.id ? `<div class="hn">${escH(t.hint || '')}${t.programs && t.programs.length ? ' (hakt sich beim Pflegeprogramm selbst ab)' : ''} · zuletzt vor ${Math.round(t.days_since)} Tg. – nochmal tippen zum Bearbeiten</div>` : ''}</div>`;
      }).join('')}</div>`;
  }

  // ---------------------------------------------------------------- Bedienung
  async _ws(msg, act, where) {
    const s = this._s;
    s.busy = act; s.msg = null; emit(this._w);
    try {
      const r = await this._hass.callWS(Object.assign({ washer: this._w }, msg));
      s.busy = null; await load(this._hass, this._w, true); emit(this._w);
      return r;
    } catch (e) {
      s.busy = null; s.msg = { t: (e && e.message) || String(e), e: 1, where }; emit(this._w);
      clearTimeout(s._mt); s._mt = setTimeout(() => { s.msg = null; emit(this._w); }, 12000);
      return null;
    }
  }
  _armed(act) {
    const s = this._s;
    if (this._c.bestaetigen === false || s.ui.arm === act) { s.ui.arm = null; clearTimeout(s._at); return true; }
    s.ui.arm = act; clearTimeout(s._at); s._at = setTimeout(() => { s.ui.arm = null; emit(this._w); }, 4000);
    emit(this._w); return false;
  }
  _setParam(k, val) { const s = this._s, sel = selOf(s); sel.params[k] = String(val); emit(this._w); }
  _click(e) {
    const t = e.target.closest('[data-act]'); if (!t || !this._hass) return;
    const s = this._s, a = t.dataset.act, k = t.dataset.k;
    const sel = selOf(s), P = sel && progOf(s, sel.program), lock = this._busyState();
    switch (a) {
      case '': return;
      case 'prog': if (lock) return; s.sel = { program: k, params: initParams(s, k), delay: sel ? sel.delay : 0 }; emit(this._w); break;
      case 'all': this._openAll(); break;
      case 'set': if (!lock) this._setParam(k, t.dataset.v); break;
      case 'sw': { if (lock) return; const d = P.params[k], on = Number(sel.params[k]) > 0; this._setParam(k, on ? (d.t === 'enum' ? d.values[0] : d.min) : (d.t === 'enum' ? d.values[d.values.length - 1] : d.max)); break; }
      case 'inc': { if (lock) return; const d = P.params[k]; let v = Number(sel.params[k]) + Number(t.dataset.d) * (d.step || 1); this._setParam(k, Math.max(d.min, Math.min(d.max, v))); break; }
      case 'delay': { if (lock) return; const d = P.params.delayTime, st = d.step || 30, mn = Math.ceil(estMin(s, P, sel.params) / st) * st, up = Number(t.dataset.d) > 0;
        let v = (Number(sel.delay) || 0) + Number(t.dataset.d) * st; if (v < mn) v = up ? mn : 0; sel.delay = Math.max(0, Math.min(d.max, v)); emit(this._w); break; }
      case 'adv': this._openAdv(); break;
      case 'ui': s.ui[k] = t.dataset.v; emit(this._w); break;
      case 'btab': s.ui.tab = k; emit(this._w); break;
      case 'start':   // ein Tipp genügt
        this._ws({ type: 'washer_control/start', program: sel.program, parameters: Object.assign({}, sel.params, sel.delay ? { delayTime: String(sel.delay) } : {}) }, 'start', 'start')
          .then(r => { if (r) { s.msg = { t: `${P.name} ${sel.delay ? 'geplant' : 'gestartet'}`, where: 'start' }; sel.delay = 0; emit(this._w); setTimeout(() => { s.msg = null; emit(this._w); }, 8000); } });
        break;
      case 'pause': case 'resume': this._ws({ type: 'washer_control/command', command: a }, a); break;
      case 'stop': if (!this._armed('stop')) return; this._ws({ type: 'washer_control/command', command: 'stop' }, 'stop'); break;
      case 'ack': this._ws({ type: 'washer_control/ack' }, 'ack'); break;
      case 'plugon': { const sw = s.snap.plug && s.snap.plug.switch; if (sw) this._hass.callService('switch', 'turn_on', { entity_id: sw }); break; }
      case 'tdone': this._ws({ type: 'washer_control/task', action: 'done', task: { id: k } }, 'tdone' + k); break;
      case 'tedit': if (s.ui.open === k) this._editTask(k); else { s.ui.open = k; emit(this._w); } break;
      case 'tadd': this._editTask(null); break;
      case 'opts': this._editOpts(); break;
    }
  }
  // Fenster im Dokument
  _ov(title, html, bind) {
    if (!document.getElementById('wmov-css')) { const st = document.createElement('style'); st.id = 'wmov-css'; st.textContent = OV_CSS; document.head.appendChild(st); }
    const ov = document.createElement('div'); ov.className = 'wmov';
    ov.innerHTML = `<div class="box"><div class="hd"><h2>${escH(title)}</h2><button class="x" data-x>✕</button></div><div class="bd">${html}</div></div>`;
    const close = () => { ov.remove(); clearTimeout(ov._t); };
    const poke = () => { clearTimeout(ov._t); ov._t = setTimeout(close, 90000); };
    ov.addEventListener('click', e => { poke(); if (e.target === ov || e.target.closest('[data-x]')) close(); });
    document.body.appendChild(ov); poke();
    bind && bind(ov, close);
    return ov;
  }
  _openAll() {
    const s = this._s; if (!s.cat) return;
    const lock = this._busyState();
    const draw = ov => {
      const sel = selOf(s), favs = new Set(s.snap.favorites || []), G = s.cat.groups;
      const by = {}; s.cat.programs.forEach(p => (by[p.group] = by[p.group] || []).push(p));
      ov.querySelector('.bd').innerHTML = `<div style="font-family:'Share Tech Mono',monospace;font-size:12.5px;color:#9a9fa8">Programm antippen = auswählen · ★ = in die Schnellauswahl (die ersten 5 erscheinen als Tasten)</div>` +
        Object.keys(G).filter(g => by[g]).map(g => `<h3><ha-icon icon="${GRP_ICON[g] || 'mdi:washing-machine'}"></ha-icon>${escH(G[g])}</h3><div class="gl">${by[g].sort((a, b) => a.name.localeCompare(b.name, 'de')).map(p =>
          `<div class="it${sel.program === p.key ? ' on' : ''}" data-p="${escH(p.key)}"><div><b>${escH(p.name)}</b><small>ca. ${durM(estMin(s, p))}${p.params.temp ? ` · ${p.params.temp.values.filter(v => v !== '0').join('/')}°` : ''}</small></div>
           <span class="st${favs.has(p.key) ? ' on' : ''}" data-f="${escH(p.key)}"><ha-icon icon="mdi:star${favs.has(p.key) ? '' : '-outline'}"></ha-icon></span></div>`).join('')}</div>`).join('');
    };
    this._ov('Alle Programme', '', (ov, close) => {
      draw(ov);
      ov.addEventListener('click', async e => {
        const f = e.target.closest('[data-f]');
        if (f) {
          const k = f.dataset.f, cur = (s.snap.favorites || []).slice(), i = cur.indexOf(k);
          if (i >= 0) cur.splice(i, 1); else cur.unshift(k);
          s.snap.favorites = cur; draw(ov); emit(this._w);
          try { await this._hass.callWS({ type: 'washer_control/settings', washer: this._w, settings: { favorites: cur } }); } catch (err) { console.warn(TAG, err); }
          return;
        }
        const it = e.target.closest('[data-p]');
        if (it && !lock) { const k = it.dataset.p; s.sel = { program: k, params: initParams(s, k), delay: 0 }; emit(this._w); close(); }
      });
    });
  }
  _openAdv() {
    const s = this._s, sel = selOf(s), P = progOf(s, sel.program);
    const ks = Object.keys(P.params).filter(k => !HIDE.has(k) && !['temp', 'spinSpeed', 'rinseIterations', 'mainWashTime'].includes(k) && !(PAR[k] || {}).sw);
    const draw = ov => {
      ov.querySelector('.bd').innerHTML = `<div class="ed">${ks.map(k => { const d = P.params[k];
        return `<label>${escH((PAR[k] || { n: k }).n)}</label><div style="display:flex;gap:8px;align-items:center"><button class="x" data-i="${k}" data-d="-1">−</button>
          <span style="font-family:'Share Tech Mono',monospace;font-size:17px;min-width:70px;text-align:center">${escH(sel.params[k])}</span><button class="x" data-i="${k}" data-d="1">+</button>
          <small style="color:#9a9fa8;font-family:'Share Tech Mono',monospace">${d.t === 'range' ? `${d.min}–${d.max}` : d.values.join(' / ')}</small></div>`; }).join('')}</div>
        <div class="bt"><button class="pri" data-x>Fertig</button></div>`;
    };
    this._ov(`Weitere Optionen · ${P.name}`, '', ov => {
      draw(ov);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-i]'); if (!b) return;
        const k = b.dataset.i, d = P.params[k], dir = Number(b.dataset.d);
        if (d.t === 'range') sel.params[k] = String(Math.max(d.min, Math.min(d.max, Number(sel.params[k]) + dir * (d.step || 1))));
        else { const vs = d.values.map(String), i = vs.indexOf(String(sel.params[k])); sel.params[k] = vs[Math.max(0, Math.min(vs.length - 1, i + dir))]; }
        draw(ov); emit(this._w);
      });
    });
  }
  _editOpts() {
    const s = this._s, st = Object.assign({ anti_crease: true, price: 0.35 }, s.snap.settings || {});
    this._ov('Einstellungen Waschmaschine', `<div class="ed">
      <label>Knitterschutz</label><label style="text-transform:none;letter-spacing:0;color:#c9ccd2;display:flex;gap:8px;align-items:center"><input type="checkbox" data-f="anti_crease"${st.anti_crease ? ' checked' : ''}> bei jedem Programm vorwählen (Trommel dreht nach dem Ende in Abständen)</label>
      <label>Strompreis</label><input data-f="price" type="number" step="0.01" min="0" value="${escH(st.price)}" placeholder="€ je kWh"></div>
      <div class="bt"><button data-x>Abbrechen</button><button class="pri" data-b="save">Speichern</button></div>`, (ov, close) => {
      ov.addEventListener('click', async e => {
        if (!e.target.closest('[data-b="save"]')) return;
        const q = n => ov.querySelector(`[data-f="${n}"]`);
        await this._ws({ type: 'washer_control/settings', settings: { anti_crease: q('anti_crease').checked, price: Number(q('price').value) || 0 } }, 'opts');
        s.sel = null; emit(this._w); close();
      });
    });
  }
  _editTask(id) {
    const s = this._s, t = (s.snap.tasks || []).find(x => x.id === id) || { id: '', name: '', washes: 30, days: 60, hint: '' };
    this._ov(id ? 'Pflege-Aufgabe bearbeiten' : 'Pflege-Aufgabe hinzufügen', `<div class="ed">
      <label>Name</label><input data-f="name" value="${escH(t.name)}">
      <label>Alle … Wäschen</label><input data-f="washes" type="number" min="0" value="${escH(t.washes)}">
      <label>Alle … Tage</label><input data-f="days" type="number" min="0" value="${escH(t.days)}">
      <label>Hinweis</label><textarea data-f="hint" rows="3">${escH(t.hint || '')}</textarea></div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;color:#9a9fa8;margin-top:8px">0 = dieses Intervall nicht nutzen. Fällig ist die Aufgabe, sobald eins der beiden erreicht ist.</div>
      <div class="bt">${id ? '<button class="del" data-b="del">Löschen</button>' : ''}<button data-x>Abbrechen</button><button class="pri" data-b="save">Speichern</button></div>`, (ov, close) => {
      ov.addEventListener('click', async e => {
        const b = e.target.closest('[data-b]'); if (!b) return;
        if (b.dataset.b === 'del') { if (!confirm(`„${t.name}“ löschen?`)) return; await this._ws({ type: 'washer_control/task', action: 'delete', task: { id } }, 'tdel'); close(); return; }
        const v = n => ov.querySelector(`[data-f="${n}"]`).value;
        await this._ws({ type: 'washer_control/task', action: 'save', task: { id: id || undefined, name: v('name') || 'Aufgabe', washes: Number(v('washes')) || 0, days: Number(v('days')) || 0, hint: v('hint') } }, 'tsave');
        close();
      });
    });
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, HtWaschmaschineCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === TAG)) window.customCards.push({ type: TAG, name: 'Home Twin: Waschmaschine', description: 'Haier/hOn-Waschmaschine bedienen, Waschgang, Statistik, Wartung (washer_control)' });
console.info(`%c HOME-TWIN-WASCHMASCHINE %c ${VERSION} `, 'background:#4dc3ff;color:#000;font-weight:700', 'background:#222;color:#4dc3ff');
})();
