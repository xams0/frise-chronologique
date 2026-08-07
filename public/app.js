/* =========================================================
   CHRONOLOZIK — client
   Toute la logique de jeu vit sur le serveur (server.js).
   Ce fichier ne fait que : envoyer des actions au serveur,
   et redessiner l'écran quand l'état du salon change.
   ========================================================= */

const CARDS_TO_WIN = 10;
const SESSION_KEY = 'chronolozik_session';
const LAST_NAME_KEY = 'chronolozik_last_name';
const WELCOME_KEY = 'chronolozik_seen_welcome';
const socket = io({ reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
let hasConnectedOnce = false;

/* ---------- audio preview player (survives re-renders without restarting) ---------- */
let audioEl = null;
let audioKey = null; // uniquely identifies which pending card is currently loaded
let audioAutoplayBlocked = false; // true when the browser refused to auto-start playback — makes the manual fallback button impossible to miss
let revealTicker = null; // interval id for animating the reveal-button countdown
let publicRoomsTicker = null; // interval id for auto-refreshing the public rooms list

/* ---------- audio unlock ----------
   Browsers refuse to auto-start sound unless playback was triggered by (or
   shortly after) a direct user gesture on THIS page. Later song playback is
   triggered by a socket event, not a click, so it gets blocked more often —
   especially in "chacun chez soi" mode where most listeners never clicked
   anything right before their device needs to play. The fix isn't to fight
   the browser: it's to spend the page's very first tap/click (typing a
   name, tapping a button, anything) on briefly playing-then-pausing a real
   audio element. Most browsers then treat the REST of the page session as
   having "user activation" for audio, so every later programmatic play()
   call — even ones triggered from a network event — is allowed. */
let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const unlock = new Audio();
    // Shortest possible valid silent MP3 — nothing to actually hear, this
    // exists purely to give the browser a real successful play() to anchor
    // "user activation" to.
    unlock.src = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAA8TEFNRTMuMTAwA8MAAAAAAAAAABQgJAJAQgAAgAAAAnHNCF6ZAAAAAAAAAAAAAAAAAAAA//tQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAw';
    unlock.volume = 0.01;
    const p = unlock.play();
    if (p && p.catch) p.catch(() => {});
    setTimeout(() => { try { unlock.pause(); } catch (e) {} }, 50);
  } catch (e) {}
}
document.addEventListener('pointerdown', unlockAudioOnce, { once: true, passive: true });
document.addEventListener('keydown', unlockAudioOnce, { once: true });

/* ---------- session persistence (survives the phone fully discarding the page
   while backgrounded — a common mobile Safari behavior, not just a network blip) ---------- */
function saveSession(code, name) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ code, name })); } catch (e) {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

/* ---------- remembered name — a pure convenience default, always editable,
   kept separate from the room session above so it survives leaving a room ---------- */
function saveLastName(name) {
  try { if (name) localStorage.setItem(LAST_NAME_KEY, name); } catch (e) {}
}
function loadLastName() {
  try { return localStorage.getItem(LAST_NAME_KEY) || ''; } catch (e) { return ''; }
}

/* ---------- one-time welcome/rules screen ---------- */
function hasSeenWelcome() {
  try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch (e) { return true; } // if storage is broken, don't block anyone with it
}
function markWelcomeSeen() {
  try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) {}
}

/* ---------- local UI state (never synced — purely this device's screen) ---------- */
const state = {
  screen: hasSeenWelcome() ? 'loading' : 'welcome', // welcome | loading | home | lobby | game
  mode: 'create',            // create | join
  nameInput: loadLastName(), codeInput: '', error: '', busy: false,
  playerId: null, playerName: null, code: null, room: null,
  guessTitle: '', guessArtist: '',
  showRules: false, showDjPicker: false, showLibrary: false, showImport: false,
  activeTimelinePlayerId: null, selectedGap: null,
  catalog: null, newSong: { title: '', artist: '', year: '' }, libError: '', libBusy: false, importError: '',
  seenResultAt: 0, ytMuted: true,
  brackets: null, showOptions: false, optionsTab: 'modes', showRecap: false,
  healthReport: null, healthChecking: false,
  ready: null,
  connected: true, reconnecting: false,
  version: null, roomVisibility: 'private', publicRooms: null, maxPlayersInput: '', showFinalTimelines: false,
  cardDetail: null
};

let errorDismissTimer = null;
function setError(msg) {
  state.error = msg; state.busy = false; render();
  // Transient errors that happen mid-game (like a challenge race lost by a
  // few milliseconds) shouldn't sit on screen forever — auto-clear it.
  if (errorDismissTimer) clearTimeout(errorDismissTimer);
  errorDismissTimer = setTimeout(() => { state.error = ''; render(); }, 4000);
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- catalog (REST — plain fetch, no CSP restriction here) ---------- */
async function loadCatalog() {
  try {
    const res = await fetch('/api/songs');
    state.catalog = await res.json();
  } catch (e) { state.catalog = []; }
  render();
}
async function loadBrackets() {
  try {
    const res = await fetch('/api/brackets');
    state.brackets = await res.json();
  } catch (e) { state.brackets = []; }
  render();
}
function songMatchesFilters(song, filters) {
  if (!filters) return true;
  if (filters.brackets && filters.brackets.length) {
    const inBracket = filters.brackets.some(b => song.year >= b.from && song.year <= b.to);
    if (!inBracket) return false;
  }
  return true;
}
function matchCount(room) {
  if (!state.catalog) return null;
  return state.catalog.filter(s => s.deezerId && songMatchesFilters(s, room.filters)).length;
}
function setFilters(room, filters) {
  socket.emit('set-filters', { filters });
}
function toggleInArray(arr, value) {
  const i = arr.findIndex(x => JSON.stringify(x) === JSON.stringify(value));
  const next = arr.slice();
  if (i === -1) next.push(value); else next.splice(i, 1);
  return next;
}
function toggleBracket(room, bracket) {
  const f = room.filters || { brackets: [] };
  setFilters(room, { ...f, brackets: toggleInArray(f.brackets, bracket) });
}
function resetFilters() {
  socket.emit('set-filters', { filters: { brackets: [] } });
}
async function addSongToCatalog() {
  const body = { title: state.newSong.title.trim(), artist: state.newSong.artist.trim(), year: state.newSong.year };
  state.libBusy = true; render();
  try {
    const res = await fetch('/api/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    state.libBusy = false;
    if (!res.ok) { state.libError = data.error || 'Erreur.'; render(); return; }
    state.catalog = data;
    state.newSong = { title: '', artist: '', year: '' };
    state.libError = '';
    render();
  } catch (e) { state.libBusy = false; state.libError = 'Erreur réseau.'; render(); }
}
async function checkCatalogHealth() {
  state.healthChecking = true; state.healthReport = null; render();
  try {
    const res = await fetch('/api/songs/health');
    state.healthReport = await res.json();
  } catch (e) { state.healthReport = null; }
  state.healthChecking = false;
  render();
}
async function removeSong(title, artist) {
  try {
    await fetch('/api/songs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, artist }) });
    const res = await fetch('/api/songs');
    state.catalog = await res.json();
    if (state.healthReport) {
      state.healthReport.noMatch = state.healthReport.noMatch.filter(s => !(s.title === title && s.artist === artist));
      state.healthReport.noPreview = state.healthReport.noPreview.filter(s => !(s.title === title && s.artist === artist));
      state.healthReport.total -= 1;
    }
    render();
  } catch (e) { /* non-critical */ }
}
function exportCatalog() {
  const blob = new Blob([JSON.stringify(state.catalog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'chronolozik-chansons.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
async function importCatalog() {
  const raw = document.getElementById('lib-import');
  if (!raw) return;
  let parsed;
  try { parsed = JSON.parse(raw.value); }
  catch (e) { state.importError = 'JSON invalide.'; render(); return; }
  try {
    const res = await fetch('/api/songs/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
    const data = await res.json();
    if (!res.ok) { state.importError = data.error || 'Erreur.'; render(); return; }
    state.catalog = data.catalog;
    state.showImport = false; state.importError = '';
    render();
  } catch (e) { state.importError = 'Erreur réseau.'; render(); }
}

/* ---------- socket events ---------- */
socket.on('joined', ({ playerId, code, room }) => {
  const name = room.players.find(p => p.id === playerId)?.name || state.nameInput.trim();
  state.playerId = playerId; state.playerName = name; state.code = code; state.room = room;
  state.screen = room.phase === 'lobby' ? 'lobby' : 'game';
  state.error = ''; state.busy = false; state.reconnecting = false;
  saveSession(code, name);
  saveLastName(name);
  render();
});
const RESULT_NOTICE_MS = 3500; // how long the reveal-outcome notice (and the matching card highlight) stays up before auto-clearing
let lastNotifiedResultTs = null;

socket.on('room', (room) => {
  // Robust fallback: if we're no longer in the player list for whatever
  // reason (kicked, or the "kicked" event above didn't arrive for some
  // reason), don't keep showing a stale room — bail out cleanly. This does
  // not depend on any specific removal mechanism working correctly.
  if (state.playerId && room.players && !room.players.some(p => p.id === state.playerId)) {
    clearSession();
    Object.assign(state, { screen: 'home', room: null, code: null, playerId: null, playerName: null, reconnecting: false, error: 'Tu ne fais plus partie de ce salon (exclu·e, ou le salon a été fermé).' });
    render();
    return;
  }
  if (room.lastResult && room.lastResult.ts !== lastNotifiedResultTs) {
    lastNotifiedResultTs = room.lastResult.ts;
    const ts = room.lastResult.ts;
    setTimeout(() => {
      if (state.seenResultAt !== ts) { state.seenResultAt = ts; render(); }
    }, RESULT_NOTICE_MS);
  }
  state.room = room;
  state.screen = room.phase === 'lobby' ? 'lobby' : 'game';
  render();
});
socket.on('error-msg', (msg) => {
  // If we were trying to silently resume a session that no longer exists
  // server-side, don't strand the user on a dead screen — send them home.
  if (state.reconnecting) { clearSession(); Object.assign(state, { screen: 'home', room: null, code: null, playerId: null, reconnecting: false }); }
  setError(msg);
});

socket.on('connect', () => {
  state.connected = true;
  if (hasConnectedOnce && state.code && state.playerName) {
    // The transport dropped and came back (e.g. the phone was backgrounded) —
    // the server sees this as a brand new connection with no room attached,
    // so we have to explicitly rejoin to pick the game back up.
    state.reconnecting = true;
    socket.emit('join-room', { code: state.code, name: state.playerName });
  }
  hasConnectedOnce = true;
  render();
});
socket.on('disconnect', () => { state.connected = false; render(); });
socket.on('kicked', () => {
  clearSession();
  Object.assign(state, { screen: 'home', room: null, code: null, playerId: null, playerName: null, reconnecting: false, error: 'Tu as été exclu·e du salon par l\'hôte.' });
  render();
});
socket.on('connect_error', () => setError('Connexion au serveur perdue — vérifie que le serveur tourne et que tu es sur le même Wi-Fi.'));

/* ---------- actions (thin — server owns all game logic) ---------- */
function createRoom() {
  const name = state.nameInput.trim();
  if (!name) return setError('Entre ton prénom.');
  state.busy = true; render();
  socket.emit('create-room', { name, visibility: state.roomVisibility });
}
function joinRoom() {
  const name = state.nameInput.trim();
  const code = state.codeInput.trim().toUpperCase();
  if (!name) return setError('Entre ton prénom.');
  if (code.length < 4) return setError('Entre le code du salon (4 caractères).');
  state.busy = true; render();
  socket.emit('join-room', { code, name });
}
function leaveToHome() {
  if (state.code) socket.emit('leave-room');
  clearSession();
  Object.assign(state, { screen: 'home', room: null, code: null, playerId: null, playerName: null, error: '', nameInput: loadLastName(), codeInput: '' });
  render();
}
function startGame() { socket.emit('start-game'); }
function drawCard() { socket.emit('draw-card'); }
function skipCard() { socket.emit('skip-card'); }
function freeCardWithTokens() { socket.emit('free-card'); }
function openPlacementPicker() { state.activeTimelinePlayerId = state.playerId; state.selectedGap = null; render(); }
function openChallengePicker() { state.activeTimelinePlayerId = 'CHALLENGE'; state.selectedGap = null; render(); }
function submitGuess() { socket.emit('submit-guess', { title: state.guessTitle, artist: state.guessArtist }); state.guessTitle = ''; state.guessArtist = ''; render(); }
function reveal() { socket.emit('reveal'); }
function playAgain() { socket.emit('play-again'); state.screen = 'lobby'; state.showFinalTimelines = false; render(); }
function setDj(playerId) { socket.emit('set-dj', { playerId }); state.showDjPicker = false; render(); }
function addTestBot() { socket.emit('add-bot'); }
function removeTestBot() { socket.emit('remove-bot'); }
function botPlayTurn() { socket.emit('bot-play'); }
function playPreviewManually() {
  if (audioEl) { audioEl.play().then(() => { audioAutoplayBlocked = false; render(); }).catch(() => {}); }
}

function me(room) { return room.players.find(p => p.id === state.playerId); }
function activePlayer(room) { return room.players.find(p => p.id === room.turnOrder[room.turnIndex % room.turnOrder.length]); }
function getDjId(room) { return room.djId || (room.players[0] && room.players[0].id); }
function getDjName(room) { const p = room.players.find(pl => pl.id === getDjId(room)); return p ? p.name : '?'; }

/* ============================= RENDER ============================= */
// Used for the periodic countdown-bar ticks — skips the render entirely
// while the user has an input/textarea focused, so typing (title/artist
// guesses, name fields, etc.) is never interrupted by a periodic rebuild.
// The countdown fill bars are pure CSS (wall-clock synced), so they keep
// animating smoothly on their own even when a tick is skipped — only the
// numeric label/button-enabled state pauses briefly until the user blurs.
function renderTick() {
  const activeTag = document.activeElement && document.activeElement.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
  render();
}

function render() {
  const root = document.getElementById('root');

  // Preserve focus + cursor/selection position across the rebuild below —
  // periodic re-renders (the reveal countdown ticker fires every 250ms while
  // a card is placed) would otherwise silently steal focus out of whatever
  // input the user is actively typing into, breaking mid-guess typing.
  let focusedId = null, selStart = null, selEnd = null;
  const activeEl = document.activeElement;
  if (activeEl && activeEl.id && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    focusedId = activeEl.id;
    try { selStart = activeEl.selectionStart; selEnd = activeEl.selectionEnd; } catch (e) {}
  }

  // Preserve a live <audio> across re-renders so playback never restarts.
  let preservedAudio = null;
  if (audioEl) { preservedAudio = audioEl; preservedAudio.remove(); }

  let html;
  if (state.screen === 'welcome') html = renderWelcome();
  else if (state.screen === 'loading') html = renderLoading();
  else if (state.screen === 'home') html = renderHome();
  else if (state.screen === 'lobby') html = renderLobby();
  else html = renderGame();
  root.innerHTML = html;

  if (focusedId) {
    const el = document.getElementById(focusedId);
    if (el) {
      el.focus();
      if (selStart !== null && el.setSelectionRange) {
        try { el.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  }

  const slot = document.getElementById('audio-slot');
  const wantKey = slot ? slot.dataset.key : null;
  const wantSrc = slot ? slot.dataset.src : null;

  if (wantKey && wantSrc) {
    if (preservedAudio && audioKey === wantKey) {
      slot.replaceWith(preservedAudio);
      audioEl = preservedAudio;
    } else {
      const shouldLoop = (state.room && state.room.audioMode) !== 'once';
      audioKey = wantKey;
      audioAutoplayBlocked = false;
      const a = document.createElement('audio');
      a.id = 'audio-slot';
      a.src = wantSrc;
      a.loop = shouldLoop;
      // Native `loop` is unreliable on some mobile browsers for remote/short
      // clips — restarting manually on 'ended' makes the loop actually work.
      // In "once" mode we deliberately do NOT restart, so it plays exactly once.
      if (shouldLoop) a.addEventListener('ended', () => { a.currentTime = 0; a.play().catch(() => {}); });
      slot.replaceWith(a);
      audioEl = a;
      audioAutoplayBlocked = false;
      a.play().catch(() => {
        // Autoplay blocked by the browser (very common when this device
        // didn't just have a direct tap — e.g. every listener in "chacun
        // chez soi" mode except whoever just drew the card). Not a sync
        // bug: the card and its audio DO arrive at the same time for
        // everyone, browsers just refuse to auto-start sound without a
        // very recent tap on THIS device. Make the fallback impossible to miss.
        audioAutoplayBlocked = true;
        render();
      });
    }
  } else if (wantKey && !wantSrc) {
    // pending card exists but no preview available for it
    audioEl = null; audioKey = null;
  } else {
    audioEl = null; audioKey = null;
  }

  // Keep the countdown bars (Révéler + décision de tour) animating smoothly
  // by re-rendering a few times a second while relevant — and stop as soon
  // as it's not needed, so this never runs idle forever.
  const pend = state.room && state.room.pending;
  if (pend && pend.stage === 'placed' && pend.placedAt) {
    const delayMs = ((state.room.revealDelaySeconds || 15) * 1000);
    const elapsed = Date.now() - pend.placedAt;
    if (elapsed < delayMs) {
      if (!revealTicker) revealTicker = setInterval(renderTick, 250);
    } else if (revealTicker) {
      clearInterval(revealTicker); revealTicker = null;
    }
  } else if (pend && pend.stage === 'listening' && pend.drawnAt) {
    const delayMs = ((state.room.turnDecisionSeconds || 60) * 1000);
    const elapsed = Date.now() - pend.drawnAt;
    if (elapsed < delayMs) {
      if (!revealTicker) revealTicker = setInterval(renderTick, 250);
    } else if (revealTicker) {
      clearInterval(revealTicker); revealTicker = null;
    }
  } else if (revealTicker) {
    clearInterval(revealTicker); revealTicker = null;
  }

  // Auto-refresh the public rooms list every ~2.5s, but only while it's
  // actually being looked at — no point polling in the background.
  if (state.screen === 'home' && state.mode === 'join') {
    if (!publicRoomsTicker) publicRoomsTicker = setInterval(loadPublicRooms, 2500);
  } else if (publicRoomsTicker) {
    clearInterval(publicRoomsTicker); publicRoomsTicker = null;
  }

  attachHandlers();
}

function renderWelcome() {
  const rules = [
    { icon: '🎧', title: 'Écoutez', text: "Un extrait de 30 secondes joue — pas de titre, pas d'artiste, juste le son." },
    { icon: '📅', title: 'Placez', text: 'Devinez si la chanson est avant, après, ou entre celles déjà sur votre frise.' },
    { icon: '⏱️', title: 'Défiez', text: "Les autres ont un délai pour parier qu'ils devinent mieux — et voler la carte." },
    { icon: '🏆', title: 'Gagnez', text: `Le premier à ${CARDS_TO_WIN} chansons bien placées remporte la partie.` }
  ];
  return `
  <div class="screen center">
    ${renderBgPremium()}
    <div class="brand"><img src="/logo.png" class="brand-logo spin" alt="Chronolozik"/><h1 class="title-xl title-shine">Chronolozik</h1></div>
    <p class="subtitle" style="margin-top:10px;">Le jeu qui teste ta mémoire musicale, entre amis.</p>

    <div class="stack" style="margin-top:28px;text-align:left;">
      ${rules.map(r => `
        <div class="card-section compact" style="display:flex;align-items:center;gap:14px;">
          <div style="font-size:26px;flex-shrink:0;">${r.icon}</div>
          <div>
            <div style="font-weight:700;font-size:15px;">${escapeHtml(r.title)}</div>
            <div class="subtitle" style="margin-top:2px;font-size:13px;">${escapeHtml(r.text)}</div>
          </div>
        </div>`).join('')}
    </div>

    <button class="btn btn-primary" style="margin-top:26px;" data-act="welcome-continue">C'est parti 🚀</button>
  </div>`;
}

function renderLoading() {
  const r = state.ready;
  const total = r && r.total ? r.total : null;
  const checked = r && r.checked ? r.checked : 0;
  const percent = total ? Math.round((checked / total) * 100) : 0;
  return `
  <div class="screen center">
    ${renderBgPremium()}
    <div class="brand"><img src="/logo.png" class="brand-logo spin" alt="Chronolozik"/><h1 class="title-xl title-shine">Chronolozik</h1></div>
    <p class="subtitle" style="margin-top:10px;">Chargement, veuillez patienter.</p>

    <div style="width:100%;max-width:280px;margin-top:28px;">
      <div style="background:var(--surface2);border-radius:999px;height:14px;overflow:hidden;border:1px solid var(--line);">
        <div style="background:var(--pink);height:100%;width:${percent}%;transition:width 0.4s ease;border-radius:999px;"></div>
      </div>
      <p class="mono" style="text-align:center;margin-top:10px;font-size:15px;color:var(--gold);font-weight:700;">${percent}%</p>
      <p class="subtitle" style="text-align:center;margin-top:2px;">${total ? `${checked} / ${total} chansons vérifiées` : 'Démarrage…'}</p>
    </div>

    <p class="footer-note" style="margin-top:24px;">Ça prend en général 1 à 2 minutes — le serveur reste volontairement lent pour respecter la limite de débit de Deezer.</p>
  </div>`;
}

// The blob animations loop over tens of seconds, but the game screen can
// re-render several times a second (reveal countdown, etc.) — recreating the
// divs on every render would restart each animation from 0%, looking like a
// stutter. Using a negative animation-delay computed from wall-clock time
// makes a freshly-created element pick up exactly where the animation
// "should" be at this instant, so re-renders are invisible.
function renderBgPremium() {
  const t = Date.now();
  const d1 = -((t % 17000) / 1000);
  const d2 = -((t % 21000) / 1000);
  const d3 = -((t % 25000) / 1000);
  return `<div class="bg-premium"><div class="bg-blob blob1" style="animation-delay:${d1}s;"></div><div class="bg-blob blob2" style="animation-delay:${d2}s;"></div><div class="bg-blob blob3" style="animation-delay:${d3}s;"></div></div>`;
}

// Same fix as renderBgPremium: with plain positive animation-delay, bars 3
// and 4 (0.3s/0.45s delay) never get to start if the DOM gets rebuilt more
// often than that — they're removed and recreated before their delay even
// elapses, so they just sit static. Wall-clock-synced negative delays make
// every bar mid-animation immediately, regardless of render frequency.
function renderSoundBars() {
  const t = Date.now();
  const dur = 1000; // matches @keyframes soundBar 1s
  const offsets = [0, 150, 300, 450];
  const spans = offsets.map(off => `<span style="animation-delay:${-(((t + off) % dur) / 1000)}s;"></span>`).join('');
  return `<div class="sound-bars">${spans}</div>`;
}

function connectionBanner() {
  if (state.reconnecting) return `<div class="result-banner" style="background:rgba(63,217,196,0.12);border-color:var(--teal);"><div>🔄 Reconnexion à ton salon…</div></div>`;
  if (!state.connected) return `<div class="result-banner flash-wrong"><div>🔌 Connexion perdue — nouvelle tentative…</div></div>`;
  return '';
}

function renderHome() {
  return `
  <div class="screen center home-screen">
    ${renderBgPremium()}
    ${connectionBanner()}
    <div class="brand"><img src="/logo.png" class="brand-logo" alt="Chronolozik"/><h1 class="title-xl title-shine">Chronolozik</h1></div>
    ${state.version ? `<div class="version-bubble">v${escapeHtml(state.version)}</div>` : ''}

    <div class="tabs" style="margin-top:26px;max-width:280px;">
      <button class="tab ${state.mode === 'create' ? 'active' : ''}" data-act="mode-create">Créer un salon</button>
      <button class="tab ${state.mode === 'join' ? 'active' : ''}" data-act="mode-join">Rejoindre</button>
    </div>

    <div class="stack">
      <div class="field">
        <label>Ton prénom</label>
        <input id="inp-name" type="text" placeholder="Ex. Léa" value="${escapeHtml(state.nameInput)}" maxlength="20"/>
      </div>

      ${state.mode === 'create' ? `
      <div class="field">
        <label>Visibilité du salon</label>
        <div class="row">
          <button type="button" class="btn ${state.roomVisibility === 'private' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="visibility-private">🔒 Privé</button>
          <button type="button" class="btn ${state.roomVisibility === 'public' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="visibility-public">🌐 Public</button>
        </div>
        <p class="subtitle" style="margin:8px 0 0;">${state.roomVisibility === 'public' ? 'Visible par tout le monde dans la liste des salons publics.' : 'Rejoignable seulement avec le code.'}</p>
      </div>` : ``}

      ${state.mode === 'join' ? `
      <div class="field">
        <label>Code du salon</label>
        <input id="inp-code" class="code" type="text" placeholder="AB12" value="${escapeHtml(state.codeInput)}" maxlength="4"/>
      </div>` : ``}
      ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ``}
      <button class="btn btn-primary" data-act="${state.mode === 'create' ? 'create-room' : 'join-room'}" ${state.busy ? 'disabled' : ''}>
        ${state.busy ? '…' : (state.mode === 'create' ? 'Créer le salon' : 'Rejoindre')}
      </button>
    </div>

    ${state.mode === 'join' ? renderPublicRoomsList() : ''}
  </div>`;
}

function renderPublicRoomsList() {
  const rooms = state.publicRooms;
  return `
  <div class="card-section" style="margin-top:18px;text-align:left;">
    <div class="timeline-owner" style="margin-bottom:8px;">
      <span>🌐 Salons publics</span>
      <button class="btn btn-ghost btn-sm" style="width:auto;padding:4px 10px;" data-act="refresh-public-rooms">↻</button>
    </div>
    ${rooms === null ? `<div class="empty">Chargement…</div>` :
      rooms.length === 0 ? `<div class="empty">Aucun salon public ouvert pour l'instant.</div>` :
      rooms.map(r => `
        <div class="player-chip" style="justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="dot"></div>
            <div class="name">${escapeHtml(r.code)} — ${escapeHtml(r.hostName)} <span class="mono" style="color:var(--text-dim);font-size:11px;">(${r.playerCount}${r.maxPlayers ? '/' + r.maxPlayers : ''} joueur${r.playerCount > 1 ? 's' : ''})</span></div>
          </div>
          <button class="btn btn-gold btn-sm" style="width:auto;flex-shrink:0;" data-act="join-public-room" data-code="${escapeHtml(r.code)}">Rejoindre</button>
        </div>`).join('')}
  </div>`;
}

function renderLobby() {
  const room = state.room;
  if (!room) return renderHome();
  const isMe = id => id === state.playerId;
  const isHost = room.hostId === state.playerId;
  const djId = getDjId(room);
  const hasBot = room.players.some(p => p.isBot);
  const myself = room.players.find(p => p.id === state.playerId);
  const listenMode = room.listenMode || 'together';
  const audioMode = room.audioMode || 'loop';
  const cardsToWin = room.cardsToWin || CARDS_TO_WIN;
  const startTokens = room.startTokens != null ? room.startTokens : 2;
  const visibility = room.visibility || 'private';

  return `
  <div class="screen">
    ${renderBgPremium()}
    ${connectionBanner()}
    <div class="topbar">
      <div class="code-pill">${room.code} <button data-act="copy-code">copier</button></div>
      <button class="iconbtn" data-act="leave">✕</button>
    </div>
    <h2 style="margin-bottom:4px;">Salon d'attente</h2>
    <p class="subtitle" style="margin-top:0;">Partage le code <b class="mono" style="color:var(--gold)">${room.code}</b> avec tes amis, sur le même Wi-Fi.</p>

    <div class="card-section" style="margin-top:18px;">
      <h3>Joueurs (${room.players.length}${room.maxPlayers ? ' / ' + room.maxPlayers : ''})</h3>
      ${room.players.map(p => `
        <div class="player-chip ${isMe(p.id) ? 'you' : ''}" style="justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="dot" style="background:${p.isBot || p.ready ? 'var(--teal)' : 'var(--red)'};"></div>
            <div class="name">${escapeHtml(p.name)}${isMe(p.id) ? ' (toi)' : ''}${p.id === room.hostId ? ' 👑' : ''}${listenMode === 'together' && p.id === djId ? ' 🎚️' : ''}</div>
          </div>
          ${isHost && p.id !== room.hostId && !p.isBot ? `<button class="btn btn-danger btn-sm" style="width:auto;flex-shrink:0;" data-act="kick-player" data-pid="${p.id}">🚫</button>` : ''}
        </div>`).join('')}
      ${room.players.length === 1 ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;" data-act="add-bot">🧪 Ajouter un bot pour tester seul</button>` : ''}
      ${hasBot ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;" data-act="remove-bot">Retirer le bot de test</button>` : ''}
      ${!isHost ? `<p class="subtitle" style="margin:8px 0 0;">👑 ${escapeHtml(room.players.find(p => p.id === room.hostId)?.name || '?')} est l'hôte — seul·e à pouvoir changer les réglages et lancer la partie.</p>` : ''}
      <button class="btn ${myself && myself.ready ? 'btn-ghost' : 'btn-gold'} btn-sm" style="margin-top:10px;width:100%;" data-act="toggle-ready">${myself && myself.ready ? '⏳ Se marquer non prêt(e)' : '✅ Prêt(e) (active le son)'}</button>
    </div>

    <button class="recap-toggle" data-act="toggle-recap">
      <span>Résumé des options</span>
      <span class="recap-arrow ${state.showRecap ? 'open' : ''}">▾</span>
    </button>
    ${state.showRecap ? `
    <div class="options-recap">
      <div class="recap-chip recap-chip-mode">${{ original: '🎵', hardcore: '🩸', enemies: '😈' }[room.gameMode || 'original']} ${{ original: 'Original', hardcore: 'Hardcore', enemies: 'Ennemis' }[room.gameMode || 'original']}</div>
      <div class="recap-chip">🏆 ${cardsToWin}</div>
      <div class="recap-chip">🪙 ${startTokens}</div>
      <div class="recap-chip">👥 ${room.maxPlayers || '∞'}</div>
      <div class="recap-chip">${visibility === 'public' ? '🌐' : '🔒'} ${visibility === 'public' ? 'Public' : 'Privé'}</div>
      <div class="recap-chip">${listenMode === 'together' ? '🎉' : '🏠'} ${listenMode === 'together' ? 'Ensemble' : 'Solo'}</div>
      <div class="recap-chip">${audioMode === 'loop' ? '🔁' : '⏹️'} ${audioMode === 'loop' ? 'Boucle' : '30s'}</div>
      <div class="recap-chip">⏱️ ${room.revealDelaySeconds || 15}s</div>
      <div class="recap-chip">⏳ ${room.turnDecisionSeconds || 60}s</div>
      <div class="recap-chip">${room.freeCardEnabled ? '🛒' : '🚫'} Achat direct</div>
    </div>` : ''}
    <button class="btn btn-ghost" style="margin-top:10px;" data-act="open-options">⚙️ Options de la partie</button>

    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ``}

    ${isHost ? `
    <button class="btn btn-primary" style="margin-top:14px;" data-act="start-game" ${room.players.length < 2 ? 'disabled' : ''}>
      ${room.players.length < 2 ? "En attente d'un 2e joueur…" : `Lancer la partie (${room.players.filter(p => p.isBot || p.ready).length}/${room.players.length} prêts)`}
    </button>` : `
    <button class="btn btn-primary" style="margin-top:14px;" disabled>En attente que l'hôte lance la partie…</button>`}
    <div class="row" style="margin-top:10px;">
      <button class="btn btn-ghost btn-sm" data-act="show-rules">Règles</button>
      <button class="btn btn-ghost btn-sm" data-act="show-library">📚 Bibliothèque (${state.catalog ? state.catalog.length : '…'})</button>
    </div>

    ${room.history.length ? `
    <div class="card-section" style="margin-top:18px;">
      <h3>Parties précédentes dans ce salon</h3>
      ${room.history.slice(0, 5).map(h => `<div class="log-line"><b>${escapeHtml(h.winnerName)}</b> a gagné — ${h.ts}</div>`).join('')}
    </div>` : ``}

    ${state.showRules ? renderRulesModal() : ''}
    ${state.showLibrary ? renderLibraryModal() : ''}
    ${state.showDjPicker ? renderDjModal(room) : ''}
    ${state.showOptions ? renderOptionsModal(room) : ''}
  </div>`;
}

function renderOptionsModal(room) {
  const isHost = room.hostId === state.playerId;
  const listenMode = room.listenMode || 'together';
  const revealDelay = room.revealDelaySeconds || 15;
  const turnDecisionSeconds = room.turnDecisionSeconds || 60;
  const audioMode = room.audioMode || 'loop';
  const cardsToWin = room.cardsToWin || CARDS_TO_WIN;
  const startTokens = room.startTokens != null ? room.startTokens : 2;
  const visibility = room.visibility || 'private';
  const tab = state.optionsTab || 'partie';
  const tabBtn = (id, label) => `<button class="opt-tab ${tab === id ? 'active' : ''}" data-act="options-tab" data-tab="${id}">${label}</button>`;

  let body = '';
  if (tab === 'modes') {
    const gameMode = room.gameMode || 'original';
    const modeCard = (id, icon, title, desc) => `
      <button class="mode-card ${gameMode === id ? 'active' : ''}" data-act="set-game-mode" data-mode="${id}" ${!isHost ? 'disabled' : ''}>
        <div class="mode-card-title">${icon} ${title}${gameMode === id ? ' ✓' : ''}</div>
        <div class="mode-card-desc">${desc}</div>
      </button>`;
    body = `
      <p class="subtitle" style="margin:0 0 12px;">Des préréglages qui appliquent d'un coup une combinaison des réglages ci-contre — rien de nouveau, juste plus rapide à mettre en place.</p>
      ${modeCard('original', '🎵', 'Original', '10 cartes pour gagner, 2 jetons de départ, 15s pour révéler, 60s pour répondre. Les réglages par défaut.')}
      ${modeCard('hardcore', '🩸', 'Hardcore', '0 jeton de départ (donc pas moyen de passer au début), 5s seulement pour révéler, 15s pour répondre. En plus : chaque erreur fait perdre une carte au hasard de sa propre frise, remise dans la pioche.')}
      ${modeCard('enemies', '😈', 'Fais-toi des ennemis', '12 cartes pour gagner, 4 jetons de départ, délai de révélation allongé à 20s — de quoi défier bien plus souvent avant que ça se referme.')}
      ${!isHost ? `<p class="subtitle" style="margin-top:10px;">Seul l'hôte peut changer le mode.</p>` : ''}
    `;
  } else if (tab === 'partie') {
    body = `
      <h3>Cartes pour gagner</h3>
      <p class="subtitle" style="margin:0 0 8px;">Le premier à ce nombre de chansons bien placées remporte la partie.</p>
      ${isHost ? `
      <div class="row" style="align-items:center;">
        <button class="btn btn-ghost btn-sm" data-act="cards-to-win-minus" ${cardsToWin <= 4 ? 'disabled' : ''}>−1</button>
        <div class="code-pill" style="justify-content:center;">${cardsToWin}</div>
        <button class="btn btn-ghost btn-sm" data-act="cards-to-win-plus" ${cardsToWin >= 20 ? 'disabled' : ''}>+1</button>
      </div>` : `<div class="code-pill" style="justify-content:center;">${cardsToWin}</div>`}

      <h3 style="margin-top:18px;">Jetons de départ</h3>
      <p class="subtitle" style="margin:0 0 8px;">Le nombre de jetons que chaque joueur a au début de la partie.</p>
      ${isHost ? `
      <div class="row" style="align-items:center;">
        <button class="btn btn-ghost btn-sm" data-act="start-tokens-minus" ${startTokens <= 0 ? 'disabled' : ''}>−1</button>
        <div class="code-pill" style="justify-content:center;">${startTokens}</div>
        <button class="btn btn-ghost btn-sm" data-act="start-tokens-plus" ${startTokens >= 10 ? 'disabled' : ''}>+1</button>
      </div>` : `<div class="code-pill" style="justify-content:center;">${startTokens}</div>`}

      <h3 style="margin-top:18px;">Nombre de joueurs maximum</h3>
      ${isHost ? `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        ${[2, 3, 4, 5, 6].map(n => `<button class="btn ${room.maxPlayers === n ? 'btn-gold' : 'btn-ghost'} btn-sm" style="width:auto;flex:1;min-width:44px;" data-act="set-max-players" data-max="${n}">${n}</button>`).join('')}
        <button class="btn ${!room.maxPlayers ? 'btn-gold' : 'btn-ghost'} btn-sm" style="width:auto;flex:1;min-width:70px;" data-act="set-max-players" data-max="">Illimité</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <input id="inp-max-custom" type="number" min="2" max="20" placeholder="Personnalisé (2-20)" value="${escapeHtml(state.maxPlayersInput)}" style="flex:1;min-width:0;box-sizing:border-box;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;"/>
        <button class="btn btn-ghost btn-sm" style="width:auto;" data-act="set-max-players-custom">Valider</button>
      </div>` : `<div class="code-pill" style="margin-top:8px;justify-content:center;">${room.maxPlayers ? room.maxPlayers + ' joueurs max' : 'Illimité'}</div>`}

      <h3 style="margin-top:18px;">Visibilité</h3>
      ${isHost ? `
      <div class="row" style="margin-top:8px;">
        <button class="btn ${visibility === 'private' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-visibility-private">🔒 Privé</button>
        <button class="btn ${visibility === 'public' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-visibility-public">🌐 Public</button>
      </div>` : `<div class="code-pill" style="margin-top:8px;justify-content:center;">${visibility === 'public' ? '🌐 Public' : '🔒 Privé'}</div>`}

      <h3 style="margin-top:18px;">Achat direct de carte</h3>
      <p class="subtitle" style="margin:0 0 8px;">Échanger 3 jetons pour poser une carte directement sur sa frise, sans l'écouter ni la deviner.</p>
      ${isHost ? `
      <div class="row" style="margin-top:8px;">
        <button class="btn ${!room.freeCardEnabled ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-free-card-off">🚫 Désactivé</button>
        <button class="btn ${room.freeCardEnabled ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-free-card-on">🛒 Activé</button>
      </div>` : `<div class="code-pill" style="margin-top:8px;justify-content:center;">${room.freeCardEnabled ? '🛒 Activé' : '🚫 Désactivé'}</div>`}`;
  } else if (tab === 'ecoute') {
    body = `
      <h3>Où êtes-vous ?</h3>
      ${isHost ? `
      <div class="row" style="margin-top:8px;">
        <button class="btn ${listenMode === 'together' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-listen-together">🎉 Tous ensemble</button>
        <button class="btn ${listenMode === 'remote' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-listen-remote">🏠 Chacun chez soi</button>
      </div>` : `<div class="code-pill" style="margin-top:8px;justify-content:center;">${listenMode === 'together' ? '🎉 Tous ensemble' : '🏠 Chacun chez soi'}</div>`}
      <p class="subtitle" style="margin:10px 0 0;">${listenMode === 'together' ? 'Un DJ unique diffuse la musique à voix haute pour toute la pièce.' : 'Pas de DJ — chaque joueur entend l\'extrait directement sur son propre téléphone.'}</p>

      ${listenMode === 'together' ? `
      <h3 style="margin-top:18px;">DJ actuel</h3>
      <div class="row">
        <div class="code-pill" style="justify-content:center;">🎚️ ${escapeHtml(getDjName(room))}</div>
        ${isHost ? `<button class="btn btn-ghost btn-sm" data-act="open-dj">Changer</button>` : ''}
      </div>` : ''}

      <h3 style="margin-top:18px;">Musique</h3>
      <p class="subtitle" style="margin:0 0 8px;">L'extrait audio tourne en boucle, ou s'arrête après 30 secondes.</p>
      ${isHost ? `
      <div class="row">
        <button class="btn ${audioMode === 'loop' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-audio-loop">🔁 En boucle</button>
        <button class="btn ${audioMode === 'once' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-audio-once">⏹️ 30 secondes</button>
      </div>` : `<div class="code-pill" style="justify-content:center;">${audioMode === 'loop' ? '🔁 En boucle' : '⏹️ 30 secondes'}</div>`}`;
  } else if (tab === 'temps') {
    body = `
      <h3>Délai avant de pouvoir révéler</h3>
      <p class="subtitle" style="margin:0 0 8px;">Le temps laissé aux autres pour défier avant que la carte puisse être révélée.</p>
      ${isHost ? `
      <div class="row" style="align-items:center;">
        <button class="btn btn-ghost btn-sm" data-act="reveal-delay-minus" ${revealDelay <= 5 ? 'disabled' : ''}>−5s</button>
        <div class="code-pill" style="justify-content:center;">${revealDelay}s</div>
        <button class="btn btn-ghost btn-sm" data-act="reveal-delay-plus" ${revealDelay >= 60 ? 'disabled' : ''}>+5s</button>
      </div>` : `<div class="code-pill" style="justify-content:center;">${revealDelay}s</div>`}

      <h3 style="margin-top:18px;">Temps pour répondre à une carte</h3>
      <p class="subtitle" style="margin:0 0 8px;">Passé ce délai après la pioche, la chanson est défaussée et le tour passe automatiquement.</p>
      ${isHost ? `
      <div class="row" style="align-items:center;">
        <button class="btn btn-ghost btn-sm" data-act="turn-decision-minus" ${turnDecisionSeconds <= 15 ? 'disabled' : ''}>−15s</button>
        <div class="code-pill" style="justify-content:center;">${turnDecisionSeconds}s</div>
        <button class="btn btn-ghost btn-sm" data-act="turn-decision-plus" ${turnDecisionSeconds >= 180 ? 'disabled' : ''}>+15s</button>
      </div>` : `<div class="code-pill" style="justify-content:center;">${turnDecisionSeconds}s</div>`}`;
  } else if (tab === 'chansons') {
    const f = room.filters || { brackets: [] };
    const chip = (active) => `padding:8px 12px;border-radius:999px;font-size:13px;border:1px solid ${active ? 'var(--pink)' : 'var(--line)'};background:${active ? 'rgba(255,79,129,0.15)' : 'var(--surface2)'};color:${active ? 'var(--pink)' : 'var(--text)'};`;
    body = `
      <h3>Périodes</h3>
      <p class="subtitle" style="margin:0 0 8px;">${matchCount(room) === null ? '…' : matchCount(room)} chanson${matchCount(room) === 1 ? '' : 's'} disponible${matchCount(room) === 1 ? '' : 's'} — rien coché = tout est inclus.</p>
      ${isHost ? `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
        ${(state.brackets || []).map(b => `
          <button data-act="toggle-bracket" data-from="${b.from}" data-to="${b.to}" style="${chip(f.brackets.some(x => x.from === b.from && x.to === b.to))}">${b.label}</button>
        `).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:12px;" data-act="reset-filters">Réinitialiser</button>` : ''}`;
  }

  return `
  <div class="modal-bg" data-act="close-options">
    <div class="modal" onclick="event.stopPropagation()">
      <h2>Options de la partie</h2>
      <div class="opt-tabs">
        ${tabBtn('modes', '🎮 Modes')}
        ${tabBtn('partie', '⚙️ Partie')}
        ${tabBtn('ecoute', '🔊 Écoute')}
        ${tabBtn('temps', '⏱️ Temps')}
        ${tabBtn('chansons', '🎵 Chansons')}
      </div>
      <div class="opt-tab-body">${body}</div>
      <button class="btn btn-gold" style="margin-top:18px;" data-act="close-options">Fermer</button>
    </div>
  </div>`;
}

function renderGame() {
  const room = state.room;
  if (!room) return renderHome();
  if (room.phase === 'finished') return renderFinished();

  const active = activePlayer(room);
  const isActive = active.id === state.playerId;
  const pend = room.pending;
  const myself = me(room);

  return `
  <div class="screen game-screen">
    ${renderBgPremium()}
    ${connectionBanner()}
    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ``}
    <div class="topbar">
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="code-pill">${room.code}</div>
        ${(room.listenMode || 'together') === 'together' ? `<button class="iconbtn" data-act="open-dj" title="Changer le DJ">🎚️</button>` : ''}
      </div>
      <button class="iconbtn" data-act="leave">✕</button>
    </div>

    <div class="card-section compact">
      <div class="now-playing">
        <div class="vinyl ${pend ? 'spin' : ''}"></div>
        <div class="info">
          <div class="status">${isActive ? "C'est ton tour" : 'Tour de'}</div>
          <div class="who">${escapeHtml(active.name)}</div>
        </div>
        ${(room.listenMode || 'together') === 'together' ? `<div class="subtitle" style="margin:0;">🎚️ ${escapeHtml(getDjName(room))}</div>` : `<div class="subtitle" style="margin:0;">🏠 chacun chez soi</div>`}
      </div>

      ${renderTurnAction(room, pend, isActive, myself)}
    </div>

    ${renderAllTimelines(room)}

    ${room.lastResult && room.lastResult.ts !== state.seenResultAt ? renderResultBanner(room.lastResult) : ''}

    ${state.activeTimelinePlayerId ? renderPlacementModal(room) : ''}
    ${state.showRules ? renderRulesModal() : ''}
    ${state.showDjPicker ? renderDjModal(room) : ''}
    ${state.cardDetail ? renderCardDetailModal() : ''}
  </div>`;
}

function renderTurnAction(room, pend, isActive, myself) {
  const active = activePlayer(room);
  const isDj = getDjId(room) === state.playerId;
  const isRemote = (room.listenMode || 'together') === 'remote';

  if (!pend) {
    if (active.isBot) {
      return `<div class="stack" style="margin-top:14px;"><button class="btn btn-gold" data-act="bot-play">🤖 Faire jouer le Bot</button></div>`;
    }
    if (!isActive) {
      return `<p class="subtitle" style="margin-top:10px;">En attente que ${escapeHtml(active.name)} pioche une chanson…</p>`;
    }
    const canFree = room.freeCardEnabled && myself.tokens >= 3 && (room.deck.length > 0 || room.discard.length > 0);
    return `
      <div class="stack" style="margin-top:14px;">
        <button class="btn btn-primary" data-act="draw-card">🎵 Piocher et écouter</button>
        ${canFree ? `<button class="btn btn-ghost btn-sm" data-act="free-card">Échanger 3 🪙 contre une carte posée directement</button>` : ''}
      </div>`;
  }

  const isActivePlayerTurn = pend.activePlayerId === state.playerId;
  const guessDone = !!pend.guessBy;
  let html = '';

  // "Tous ensemble": audio plays on the DJ's device only (or the tester's, for
  // a bot's turn). "Chacun chez soi": audio plays on every player's own device.
  if (isRemote || isDj || active.isBot) {
    if (pend.card.previewUrl) {
      html += `
      <div class="yt-wrap" style="aspect-ratio:auto;background:var(--surface2);padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px;">
        <div id="audio-slot" data-key="${pend.card.deezerId}-${pend.card.year}" data-src="${escapeHtml(pend.card.previewUrl)}"></div>
        ${renderSoundBars()}
        <button class="btn ${audioAutoplayBlocked ? 'btn-gold play-nudge' : 'btn-ghost'} btn-sm" data-act="play-preview">🔊 ${audioAutoplayBlocked ? 'Appuie ici pour le son' : 'Appuyer si pas de son'}</button>
      </div>`;
    } else {
      html += `<p class="subtitle" style="margin-top:10px;">🔇 Aperçu audio indisponible pour cette chanson sur Deezer — devinez à partir du titre/artiste une fois révélé, ou passez-la.</p>`;
    }
  }

  if (pend.stage === 'listening') {
    html += renderDecisionTimer(room, pend, active, isActivePlayerTurn);
    if (isActivePlayerTurn) {
      html += `
      <div class="row" style="margin-top:12px;">
        <button class="btn btn-gold" data-act="open-placement">Placer la carte</button>
        ${myself.tokens >= 1 ? `<button class="btn btn-ghost btn-sm" data-act="skip-card">Passer (1 🪙)</button>` : ''}
      </div>`;
      if (!isRemote && !isDj && !active.isBot) html += `<p class="subtitle" style="margin-top:8px;">🔊 Écoute sur l'appareil du DJ (${escapeHtml(getDjName(room))}).</p>`;
    } else if (!isRemote && !isDj && !active.isBot) {
      html += `<p class="subtitle" style="margin-top:10px;">🔊 La chanson joue chez ${escapeHtml(getDjName(room))} — ${escapeHtml(active.name)} réfléchit à son placement…</p>`;
    }
  }

  if (pend.stage === 'placed' || pend.stage === 'listening') {
    if (isActivePlayerTurn && !guessDone) {
      html += `
      <div class="guess-box">
        <input id="inp-title" placeholder="Titre ?" value="${escapeHtml(state.guessTitle)}"/>
        <input id="inp-artist" placeholder="Artiste ?" value="${escapeHtml(state.guessArtist)}"/>
      </div>
      <button class="btn btn-teal btn-sm" style="margin-top:8px;" data-act="submit-guess">Valider titre + artiste (+1 🪙)</button>`;
    }
    if (guessDone && pend.guessBy !== 'bot-na') {
      const guessKey = pend.placedAt + '-' + pend.guessBy;
      const isFirstGuessRender = lastAnimatedGuessKey !== guessKey;
      if (isFirstGuessRender) lastAnimatedGuessKey = guessKey;
      const guessFlashCls = isFirstGuessRender ? (pend.guessCorrect ? 'flash-correct' : 'flash-wrong') : '';
      html += `<div class="guess-ok ${guessFlashCls}">${pend.guessCorrect ? '✔ Titre et artiste trouvés — jeton gagné.' : '✘ Pas trouvé cette fois.'}</div>`;
    }
  }

  if (pend.stage === 'placed') {
    html += `<div class="card-section compact" style="margin-top:8px;background:var(--surface2);">
      <h3 style="font-size:12px;">Carte en jeu</h3>
      <p style="font-size:13px;color:var(--text-dim);margin:0 0 8px;">${escapeHtml(active.name)} a placé sa carte. Quelqu'un pense que c'est faux ?</p>
      ${renderPendingParticipants(room, pend)}
    </div>`;
  }

  return html;
}

function renderDecisionTimer(room, pend, active, isActivePlayerTurn) {
  const delayMs = (room.turnDecisionSeconds || 60) * 1000;
  const elapsed = Date.now() - (pend.drawnAt || Date.now());
  const remaining = Math.max(0, delayMs - elapsed);
  const secondsLeft = Math.ceil(remaining / 1000);
  const durationS = (delayMs / 1000).toFixed(2);
  const negDelayS = (-(elapsed / 1000)).toFixed(3);
  const label = isActivePlayerTurn ? `⏱️ ${secondsLeft}s pour répondre` : `⏱️ ${secondsLeft}s restantes pour ${escapeHtml(active.name)}`;
  return `
  <div class="decision-timer">
    <div class="decision-timer-fill" style="animation: revealFill ${durationS}s linear ${negDelayS}s forwards;"></div>
    <span class="decision-timer-label">${label}</span>
  </div>`;
}

function renderRevealButton(room, pend, label) {
  const delayMs = (room.revealDelaySeconds || 15) * 1000;
  const elapsed = Date.now() - (pend.placedAt || Date.now());
  const remaining = Math.max(0, delayMs - elapsed);
  const ready = remaining <= 0;
  const secondsLeft = Math.ceil(remaining / 1000);
  // A smooth native CSS fill instead of a JS-stepped width: the animation
  // runs the full delay duration, but with a negative delay equal to time
  // already elapsed, so it starts already at the right position and then
  // glides forward on its own — no per-tick re-render needed to look fluid.
  const durationS = (delayMs / 1000).toFixed(2);
  const negDelayS = (-(elapsed / 1000)).toFixed(3);
  const fillStyle = ready ? 'width:100%;' : `width:0%;animation:revealFill ${durationS}s linear ${negDelayS}s forwards;`;
  return `
  <button class="btn btn-primary reveal-btn" data-act="reveal" ${ready ? '' : 'disabled'}>
    <div class="reveal-fill" style="${fillStyle}"></div>
    <span class="reveal-label">${ready ? label : `${label} (${secondsLeft}s)`}</span>
  </button>`;
}

function renderPendingParticipants(room, pend) {
  const activePl = room.players.find(p => p.id === pend.activePlayerId);
  const activeIsBot = !!activePl.isBot;
  const iAmActive = pend.activePlayerId === state.playerId;
  const meObj = me(room);
  const challenger = pend.challenge ? room.players.find(p => p.id === pend.challenge.playerId) : null;
  let html = '<div class="stack" style="gap:8px;margin-top:6px;">';

  if (activeIsBot) {
    if (!pend.challenge && meObj.tokens >= 1) html += `<button class="btn btn-ghost btn-sm" data-act="open-challenge">🚨 Défier le Bot (1 🪙)</button>`;
    if (challenger) html += `<p class="subtitle" style="margin:6px 0 0;">🚨 ${escapeHtml(challenger.name)} a défié le Bot.</p>`;
    html += renderRevealButton(room, pend, '🤖 Révéler pour le Bot');
  } else if (iAmActive) {
    if (challenger) html += `<p class="subtitle" style="margin:0 0 8px;color:var(--pink);font-weight:600;">🚨 ${escapeHtml(challenger.name)} a défié ${escapeHtml(activePl.name)} !</p>`;
    html += renderRevealButton(room, pend, 'Révéler la carte');
  } else {
    html += renderRevealInfoTimer(room, pend, activePl);
    if (!pend.challenge && meObj.tokens >= 1) html += `<button class="btn btn-ghost btn-sm" data-act="open-challenge">🚨 Défier (1 🪙)</button>`;
    if (challenger) html += `<p class="subtitle" style="margin:6px 0 0;">🚨 ${escapeHtml(challenger.name)} a défié ${escapeHtml(activePl.name)}.</p>`;
    html += `<button class="btn btn-gold btn-sm" data-act="reveal">✅ Ça a l'air bon, révéler maintenant</button>`;
  }
  html += '</div>';
  return html;
}

function renderRevealInfoTimer(room, pend, activePl) {
  const delayMs = (room.revealDelaySeconds || 15) * 1000;
  const elapsed = Date.now() - (pend.placedAt || Date.now());
  const remaining = Math.max(0, delayMs - elapsed);
  if (remaining <= 0) return '';
  const secondsLeft = Math.ceil(remaining / 1000);
  const durationS = (delayMs / 1000).toFixed(2);
  const negDelayS = (-(elapsed / 1000)).toFixed(3);
  return `
  <div class="decision-timer">
    <div class="decision-timer-fill" style="animation: revealFill ${durationS}s linear ${negDelayS}s forwards;"></div>
    <span class="decision-timer-label">⏱️ ${secondsLeft}s avant que ${escapeHtml(activePl.name)} puisse révéler</span>
  </div>`;
}

let lastAnimatedResultTs = null; // prevents the reveal-outcome banner from replaying its flash animation on every unrelated re-render
let lastAnimatedGuessKey = null; // same idea for the title/artist guess feedback

function renderResultBanner(r) {
  const tintCls = r.kind === 'wrong' ? 'result-tint-wrong' : 'result-tint-correct';
  const isFirstRender = lastAnimatedResultTs !== r.ts;
  if (isFirstRender) lastAnimatedResultTs = r.ts;
  const flashCls = isFirstRender ? (r.kind === 'wrong' ? 'flash-wrong' : 'flash-correct') : '';
  let text;
  if (r.kind === 'wrong') text = `❌ "${escapeHtml(r.title)}" (${r.year}) — mal placée, défaussée.`;
  else if (r.kind === 'stolen') text = `🎯 "${escapeHtml(r.title)}" (${r.year}) — ${escapeHtml(r.activeName)} s'est trompé, ${escapeHtml(r.extraName)} récupère la carte !`;
  else text = `✅ "${escapeHtml(r.title)}" (${r.year}) — bien placée par ${escapeHtml(r.activeName)} !`;
  const penalty = r.hardcorePenalty
    ? `<div style="margin-top:6px;font-size:12.5px;color:var(--pink);font-weight:700;">🩸 Hardcore : ${escapeHtml(r.hardcorePenalty.playerName)} perd aussi "${escapeHtml(r.hardcorePenalty.title)}" (${r.hardcorePenalty.year}) de sa frise !</div>`
    : '';
  return `<div class="result-banner ${tintCls} ${flashCls}">
    ${r.cover ? `<img src="${escapeHtml(r.cover)}" alt="" style="width:44px;height:44px;border-radius:8px;flex-shrink:0;object-fit:cover;"/>` : ''}
    <div style="flex:1;">${text}${penalty}</div>
    <button class="btn btn-ghost btn-sm" data-act="dismiss-result" data-ts="${r.ts}">OK</button>
  </div>`;
}

function buildRibbonItems(sortedCards, markers) {
  const items = [];
  const sortedMarkers = markers.slice().sort((a, b) => a.gapIndex - b.gapIndex);
  let mi = 0;
  for (let i = 0; i <= sortedCards.length; i++) {
    while (mi < sortedMarkers.length && sortedMarkers[mi].gapIndex === i) { items.push({ type: 'marker', ...sortedMarkers[mi] }); mi++; }
    if (i < sortedCards.length) items.push({ type: 'card', card: sortedCards[i] });
  }
  return items;
}

function renderAllTimelines(room) {
  const pend = room.pending;
  const activeId = room.turnOrder && room.turnOrder.length ? room.turnOrder[room.turnIndex % room.turnOrder.length] : null;
  const missed = room.missedCards || [];
  const lr = room.lastResult;
  const showWonHighlight = lr && lr.kind !== 'wrong' && (Date.now() - lr.ts) < RESULT_NOTICE_MS;
  const wonPlayerName = showWonHighlight ? (lr.kind === 'stolen' ? lr.extraName : lr.activeName) : null;

  return room.players.map(p => {
    const sorted = p.timeline.slice().sort((a, b) => a.year - b.year);
    let markers = [];
    if (pend && pend.activePlayerId === p.id && pend.placement) markers.push({ gapIndex: pend.placement.gapIndex, cls: 'pending', label: 'En attente' });
    if (pend && pend.activePlayerId === p.id && pend.challenge) {
      const challenger = room.players.find(pl => pl.id === pend.challenge.playerId);
      markers.push({ gapIndex: pend.challenge.gapIndex, cls: 'challenge', label: `${challenger ? challenger.name : '?'} ?` });
    }
    const items = buildRibbonItems(sorted, markers);
    const isTurn = p.id === activeId;
    const playerMissed = missed.filter(m => m.playerId === p.id).slice(-5).reverse();
    return `
    <div class="card-section compact ${isTurn ? 'turn-active' : ''}">
      <div class="timeline-owner">
        <span>${isTurn ? '▶ ' : ''}<b style="color:var(--text)">${escapeHtml(p.name)}</b>${p.id === state.playerId ? ' (toi)' : ''} — ${p.timeline.length}/${room.cardsToWin || CARDS_TO_WIN}</span>
        <span class="mono" style="color:var(--gold)">${p.tokens} 🪙</span>
      </div>
      <div class="ribbon">
        ${items.length === 0 ? '<div class="empty">Pas encore de carte</div>' :
          items.map(it => {
            if (it.type !== 'card') return `<div class="ticket ${it.cls}"><div class="year">?</div><div class="meta"><div class="meta-title">${escapeHtml(it.label)}</div></div></div>`;
            const isWonCard = wonPlayerName === p.name && it.card.title === lr.title && it.card.year === lr.year;
            const wonCls = isWonCard ? (lr.kind === 'stolen' ? 'ticket-stolen' : 'ticket-won') : (it.card.stolenFrom ? 'ticket-stolen-permanent' : '');
            const stolenNote = it.card.stolenFrom ? `<div class="meta-stolen">Volée à ${escapeHtml(it.card.stolenFrom)}</div>` : '';
            return `<div class="ticket ${wonCls}" data-act="show-card-detail" data-title="${escapeHtml(it.card.title)}" data-artist="${escapeHtml(it.card.artist)}" data-year="${it.card.year}" data-cover="${escapeHtml(it.card.cover || '')}" data-stolen="${escapeHtml(it.card.stolenFrom || '')}"><div class="year">${it.card.year}</div><div class="meta"><div class="meta-title">${escapeHtml(it.card.title)}</div><div class="meta-artist">${escapeHtml(it.card.artist)}</div>${stolenNote}</div></div>`;
          }).join('')}
      </div>
      ${playerMissed.length ? `
      <div class="missed-history">
        ${playerMissed.map(m => `<div class="missed-line">❌ <b>${m.year}</b> — ${escapeHtml(m.title)} · ${escapeHtml(m.artist)}</div>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('');
}

function renderFinished() {
  const room = state.room;
  const last = room.history[0];
  return `
  <div class="screen center">
    ${renderBgPremium()}
    <div class="brand"><img src="/logo.png" class="brand-logo" alt="Chronolozik"/></div>
    <h1 class="title-xl">🏆 ${escapeHtml(last.winnerName)} gagne !</h1>
    <div class="stack" style="margin-top:18px;">
      ${room.players.slice().sort((a, b) => b.timeline.length - a.timeline.length).map(p => `
        <div class="player-chip"><div class="dot"></div><div class="name">${escapeHtml(p.name)}</div><div class="cards mono">${p.timeline.length} cartes</div></div>
      `).join('')}
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:14px;" data-act="toggle-final-timelines">${state.showFinalTimelines ? '▲ Masquer les frises' : '📊 Revoir les frises de tout le monde'}</button>
    ${state.showFinalTimelines ? `<div class="stack" style="margin-top:12px;text-align:left;width:100%;">${renderAllTimelines(room)}</div>` : ''}
    <button class="btn btn-primary" style="margin-top:22px;" data-act="play-again">Rejouer dans ce salon</button>
    <button class="btn btn-ghost" style="margin-top:10px;" data-act="leave">Quitter</button>
  </div>`;
}

function renderPlacementModal(room) {
  const isChallenge = state.activeTimelinePlayerId === 'CHALLENGE';
  const targetId = isChallenge ? room.pending.activePlayerId : state.activeTimelinePlayerId;
  const target = room.players.find(p => p.id === targetId);
  const sorted = target.timeline.slice().sort((a, b) => a.year - b.year);
  const excludeGap = isChallenge && room.pending.placement ? room.pending.placement.gapIndex : -1;

  let slots = '';
  for (let i = 0; i <= sorted.length; i++) {
    const disabled = i === excludeGap;
    const selected = state.selectedGap === i;
    if (selected) slots += `<div class="ticket pending"><div class="year">?</div><div class="meta"><div class="meta-title">Ici</div></div></div>`;
    else slots += `<div class="slot"><button data-act="select-gap" data-gap="${i}" ${disabled ? 'disabled' : ''}>+</button></div>`;
    if (i < sorted.length) slots += `<div class="ticket ${sorted[i].stolenFrom ? 'ticket-stolen-permanent' : ''}"><div class="year">${sorted[i].year}</div><div class="meta"><div class="meta-title">${escapeHtml(sorted[i].title)}</div><div class="meta-artist">${escapeHtml(sorted[i].artist)}</div>${sorted[i].stolenFrom ? `<div class="meta-stolen">Volée à ${escapeHtml(sorted[i].stolenFrom)}</div>` : ''}</div></div>`;
  }

  return `
  <div class="modal-bg" data-act="close-modal">
    <div class="modal" onclick="event.stopPropagation()">
      <h2>${isChallenge ? 'Où penses-tu que ça se place ?' : 'Place ta carte'}</h2>
      <p class="subtitle" style="margin-top:0;">Sur la frise de ${escapeHtml(target.name)} — appuie sur un + pour choisir l'emplacement, puis valide.</p>
      <div class="ribbon" style="margin-top:14px;">${slots}</div>
      <div class="row" style="margin-top:14px;">
        <button class="btn btn-ghost" data-act="close-modal">Annuler</button>
        <button class="btn btn-gold" data-act="confirm-gap" ${state.selectedGap === null ? 'disabled' : ''}>Valider</button>
      </div>
    </div>
  </div>`;
}

function renderDjModal(room) {
  const djId = getDjId(room);
  return `
  <div class="modal-bg" data-act="close-dj">
    <div class="modal" onclick="event.stopPropagation()">
      <h2>Qui est le DJ ?</h2>
      <p class="subtitle" style="margin-top:0;">Le DJ fait jouer la musique sur son appareil pour toute la salle.</p>
      <div class="stack" style="margin-top:14px;">
        ${room.players.filter(p => !p.isBot).map(p => `
          <div class="player-chip ${p.id === djId ? 'you' : ''}" style="justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:10px;"><div class="dot"></div><div class="name">${escapeHtml(p.name)}${p.id === djId ? ' 🎚️' : ''}</div></div>
            ${p.id !== djId ? `<button class="btn btn-ghost btn-sm" data-act="pick-dj" data-pid="${p.id}">Nommer DJ</button>` : ''}
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost" style="margin-top:14px;" data-act="close-dj">Fermer</button>
    </div>
  </div>`;
}

function renderLibraryModal() {
  const list = (state.catalog || []).slice().sort((a, b) => a.year - b.year);
  return `
  <div class="modal-bg" data-act="close-library">
    <div class="modal" onclick="event.stopPropagation()">
      <h2>Bibliothèque de chansons</h2>
      <p class="subtitle" style="margin-top:0;">Stockée sur ce serveur — visible par tous ceux qui s'y connectent.</p>

      <div class="card-section" style="background:var(--surface2);margin-top:14px;">
        <h3>Ajouter une chanson</h3>
        <div class="stack" style="gap:8px;margin-top:0;">
          <input id="lib-title" placeholder="Titre" value="${escapeHtml(state.newSong.title)}"/>
          <input id="lib-artist" placeholder="Artiste" value="${escapeHtml(state.newSong.artist)}"/>
          <input id="lib-year" placeholder="Année (ex. 1999)" inputmode="numeric" value="${escapeHtml(state.newSong.year)}"/>
          ${state.libError ? `<div class="error-box">${escapeHtml(state.libError)}</div>` : ''}
          <button class="btn btn-gold btn-sm" data-act="add-song" ${state.libBusy ? 'disabled' : ''}>${state.libBusy ? 'Recherche sur Deezer…' : 'Ajouter à la bibliothèque'}</button>
        </div>
      </div>

      <h3 style="margin-top:16px;">${list.length} chanson${list.length > 1 ? 's' : ''}</h3>
      <div style="max-height:220px;overflow-y:auto;">
        ${list.map(s => `<div class="log-line"><b>${s.year}</b> — ${escapeHtml(s.title)} · ${escapeHtml(s.artist)}</div>`).join('')}
      </div>

      <div class="row" style="margin-top:14px;">
        <button class="btn btn-ghost btn-sm" data-act="export-catalog">⬇ Exporter en JSON</button>
        <button class="btn btn-ghost btn-sm" data-act="toggle-import">⬆ Importer un JSON</button>
      </div>
      ${state.showImport ? `
      <div class="stack" style="margin-top:10px;">
        <textarea id="lib-import" rows="5" placeholder='[{"title":"...","artist":"...","year":1999,"yt":"..."}]' style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:10px;color:var(--text);font-size:13px;font-family:'IBM Plex Mono',monospace;"></textarea>
        ${state.importError ? `<div class="error-box">${escapeHtml(state.importError)}</div>` : ''}
        <button class="btn btn-teal btn-sm" data-act="import-catalog">Fusionner dans la bibliothèque</button>
      </div>` : ''}

      <div class="card-section" style="background:var(--surface2);margin-top:14px;">
        <h3>Vérifier les extraits audio</h3>
        <p class="subtitle" style="margin:0 0 10px;">Interroge Deezer en direct pour chaque chanson — peut prendre une minute pour ${list.length} titres.</p>
        <button class="btn btn-teal btn-sm" data-act="check-health" ${state.healthChecking ? 'disabled' : ''}>${state.healthChecking ? 'Vérification en cours…' : '🔍 Vérifier la bibliothèque'}</button>
        ${renderHealthReport()}
      </div>

      <button class="btn btn-ghost" style="margin-top:14px;" data-act="close-library">Fermer</button>
    </div>
  </div>`;
}

function renderHealthReport() {
  const r = state.healthReport;
  if (!r) return '';
  const problems = [...r.noMatch.map(s => ({ ...s, reason: 'Aucune correspondance Deezer' })), ...r.noPreview.map(s => ({ ...s, reason: 'Pas d\'extrait audio disponible' }))];
  return `
    <div style="margin-top:12px;">
      <p style="font-size:13px;color:${problems.length ? 'var(--red)' : 'var(--teal)'};margin:0 0 8px;font-weight:600;">
        ${r.ok} / ${r.total} chansons ont un extrait audio confirmé jouable en ce moment.
      </p>
      ${problems.length === 0 ? '<p class="subtitle" style="margin:0;">Tout est bon, aucune chanson à corriger.</p>' : `
      <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
        ${problems.map(s => `
          <div class="log-line" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span><b>${s.year}</b> — ${escapeHtml(s.title)} · ${escapeHtml(s.artist)}<br><span style="color:var(--red);font-size:11px;">${s.reason}</span></span>
            <button class="btn btn-danger btn-sm" style="width:auto;flex-shrink:0;" data-act="remove-song" data-title="${escapeHtml(s.title)}" data-artist="${escapeHtml(s.artist)}">Retirer</button>
          </div>
        `).join('')}
      </div>`}
    </div>`;
}

let lastAnimatedCardDetailKey = null; // prevents the flip-in animation from replaying while the same card stays open across re-renders

function renderCardDetailModal() {
  const c = state.cardDetail;
  const key = c.title + '|' + c.artist + '|' + c.year;
  const isFirstRender = lastAnimatedCardDetailKey !== key;
  if (isFirstRender) lastAnimatedCardDetailKey = key;
  return `
  <div class="modal-bg card-detail-bg" data-act="close-card-detail" style="z-index:200;">
    <div class="card-detail-wrap" onclick="event.stopPropagation()">
      <button class="iconbtn card-detail-close" data-act="close-card-detail">✕</button>
      <div class="card-detail-face ${isFirstRender ? 'card-flip-in' : ''} ${c.stolenFrom ? 'stolen' : ''}">
        ${c.cover ? `<img src="${escapeHtml(c.cover)}" alt="" class="card-detail-cover"/>` : `<div class="card-detail-cover-placeholder">🎵</div>`}
        <div class="card-detail-year">${escapeHtml(String(c.year))}</div>
        <div class="card-detail-title">${escapeHtml(c.title)}</div>
        <div class="card-detail-artist">${escapeHtml(c.artist)}</div>
        ${c.stolenFrom ? `<div class="card-detail-stolen">Volée à ${escapeHtml(c.stolenFrom)}</div>` : ''}
      </div>
    </div>
  </div>`;
}

function renderRulesModal() {
  return `
  <div class="modal-bg" data-act="close-rules">
    <div class="modal rules" onclick="event.stopPropagation()">
      <h2>Règles</h2>
      <p><b>But :</b> être le premier à placer correctement ${CARDS_TO_WIN} chansons sur sa frise chronologique.</p>
      <p><b>Tour :</b> le joueur actif pioche une chanson, l'écoute (jouée par le DJ, pour toute la salle), puis la place sur sa propre frise en devinant si elle est avant, après ou entre les chansons déjà posées.</p>
      <p><b>Révélation :</b> une fois la carte placée, elle est révélée. Bien placée → elle reste sur la frise. Mal placée → elle est défaussée.</p>
      <p><b>Défi :</b> les autres joueurs peuvent parier 1 jeton qu'ils devinent mieux l'emplacement. S'ils ont raison, ils volent la carte.</p>
      <p><b>Passer :</b> 1 jeton pour changer de chanson sans la placer.</p>
      <p><b>Carte gratuite :</b> 3 jetons pour poser une carte directement, sans écouter ni deviner.</p>
      <p><b>Gagner un jeton :</b> devine le titre ET l'artiste de la chanson en jeu, max 5 jetons.</p>
      <button class="btn btn-ghost" style="margin-top:6px;" data-act="close-rules">Fermer</button>
    </div>
  </div>`;
}

/* ---------- event delegation ---------- */
function attachHandlers() {
  const root = document.getElementById('root');

  const bind = (id, key, transform) => {
    const el = document.getElementById(id);
    if (el) el.oninput = e => { state[key] = transform ? transform(e.target.value) : e.target.value; };
  };
  bind('inp-name', 'nameInput');
  bind('inp-code', 'codeInput', v => v.toUpperCase());
  bind('inp-title', 'guessTitle');
  bind('inp-artist', 'guessArtist');

  const bindNested = (id, obj, key, transform) => {
    const el = document.getElementById(id);
    if (el) el.oninput = e => { state[obj][key] = transform ? transform(e.target.value) : e.target.value; };
  };
  bindNested('lib-title', 'newSong', 'title');
  bindNested('lib-artist', 'newSong', 'artist');
  bindNested('lib-year', 'newSong', 'year');
  const maxCustomEl = document.getElementById('inp-max-custom');
  if (maxCustomEl) maxCustomEl.oninput = e => { state.maxPlayersInput = e.target.value; };

  root.querySelectorAll('[data-act]').forEach(elm => {
    elm.addEventListener('click', (e) => {
      const act = elm.getAttribute('data-act');
      state.error = '';
      if (act === 'welcome-continue') {
        markWelcomeSeen();
        if (state.ready && state.ready.ready) { proceedPastReadyGate(); }
        else { state.screen = 'loading'; } // the still-running background poll picks this up within ~1s
        render();
      }
      else if (act === 'mode-create') { state.mode = 'create'; render(); }
      else if (act === 'mode-join') { state.mode = 'join'; render(); if (state.publicRooms === null) loadPublicRooms(); }
      else if (act === 'visibility-private') { state.roomVisibility = 'private'; render(); }
      else if (act === 'visibility-public') { state.roomVisibility = 'public'; render(); }
      else if (act === 'refresh-public-rooms') loadPublicRooms();
      else if (act === 'join-public-room') {
        const name = state.nameInput.trim();
        if (!name) { setError('Entre ton prénom d\'abord.'); return; }
        state.codeInput = elm.getAttribute('data-code');
        state.busy = true; render();
        socket.emit('join-room', { code: state.codeInput, name });
      }
      else if (act === 'create-room') createRoom();
      else if (act === 'join-room') joinRoom();
      else if (act === 'leave') leaveToHome();
      else if (act === 'copy-code') { navigator.clipboard && navigator.clipboard.writeText(state.code).catch(() => {}); }
      else if (act === 'start-game') startGame();
      else if (act === 'show-rules') { state.showRules = true; render(); }
      else if (act === 'close-rules') { state.showRules = false; render(); }
      else if (act === 'close-modal') { state.activeTimelinePlayerId = null; state.selectedGap = null; render(); }
      else if (act === 'show-library') { state.showLibrary = true; state.libError = ''; render(); }
      else if (act === 'close-library') { state.showLibrary = false; render(); }
      else if (act === 'add-song') addSongToCatalog();
      else if (act === 'export-catalog') exportCatalog();
      else if (act === 'toggle-import') { state.showImport = !state.showImport; state.importError = ''; render(); }
      else if (act === 'import-catalog') importCatalog();
      else if (act === 'check-health') checkCatalogHealth();
      else if (act === 'remove-song') removeSong(elm.getAttribute('data-title'), elm.getAttribute('data-artist'));
      else if (act === 'add-bot') addTestBot();
      else if (act === 'remove-bot') removeTestBot();
      else if (act === 'kick-player') { if (confirm('Exclure ce joueur du salon ?')) socket.emit('kick-player', { playerId: elm.getAttribute('data-pid') }); }
      else if (act === 'show-card-detail') {
        state.cardDetail = {
          title: elm.getAttribute('data-title'),
          artist: elm.getAttribute('data-artist'),
          year: elm.getAttribute('data-year'),
          cover: elm.getAttribute('data-cover') || null,
          stolenFrom: elm.getAttribute('data-stolen') || null
        };
        render();
      }
      else if (act === 'close-card-detail') { state.cardDetail = null; render(); }
      else if (act === 'toggle-ready') {
        unlockAudioOnce(); // an explicit "I'm ready" tap is exactly the kind of deliberate gesture that reliably unlocks audio
        const myself = state.room && state.room.players.find(p => p.id === state.playerId);
        socket.emit('set-ready', { ready: !(myself && myself.ready) });
      }
      else if (act === 'set-max-players') {
        const raw = elm.getAttribute('data-max');
        socket.emit('set-max-players', { max: raw === '' ? null : parseInt(raw, 10) });
      }
      else if (act === 'set-max-players-custom') {
        const v = document.getElementById('inp-max-custom');
        const n = v ? parseInt(v.value, 10) : NaN;
        if (!Number.isFinite(n)) { setError('Entre un nombre entre 2 et 20.'); return; }
        socket.emit('set-max-players', { max: n });
      }
      else if (act === 'open-dj') { state.showDjPicker = true; render(); }
      else if (act === 'close-dj') { state.showDjPicker = false; render(); }
      else if (act === 'set-listen-together') socket.emit('set-listen-mode', { mode: 'together' });
      else if (act === 'set-listen-remote') socket.emit('set-listen-mode', { mode: 'remote' });
      else if (act === 'reveal-delay-minus') socket.emit('set-reveal-delay', { seconds: Math.max(5, (state.room.revealDelaySeconds || 15) - 5) });
      else if (act === 'reveal-delay-plus') socket.emit('set-reveal-delay', { seconds: Math.min(60, (state.room.revealDelaySeconds || 15) + 5) });
      else if (act === 'turn-decision-minus') socket.emit('set-turn-decision-seconds', { seconds: Math.max(15, (state.room.turnDecisionSeconds || 60) - 15) });
      else if (act === 'turn-decision-plus') socket.emit('set-turn-decision-seconds', { seconds: Math.min(180, (state.room.turnDecisionSeconds || 60) + 15) });
      else if (act === 'set-audio-loop') socket.emit('set-audio-mode', { mode: 'loop' });
      else if (act === 'set-audio-once') socket.emit('set-audio-mode', { mode: 'once' });
      else if (act === 'open-options') { state.showOptions = true; if (!state.optionsTab) state.optionsTab = 'modes'; render(); }
      else if (act === 'toggle-recap') { state.showRecap = !state.showRecap; render(); }
      else if (act === 'close-options') { state.showOptions = false; render(); }
      else if (act === 'options-tab') { state.optionsTab = elm.getAttribute('data-tab'); render(); }
      else if (act === 'cards-to-win-minus') socket.emit('set-cards-to-win', { count: Math.max(4, (state.room.cardsToWin || CARDS_TO_WIN) - 1) });
      else if (act === 'cards-to-win-plus') socket.emit('set-cards-to-win', { count: Math.min(20, (state.room.cardsToWin || CARDS_TO_WIN) + 1) });
      else if (act === 'start-tokens-minus') socket.emit('set-start-tokens', { count: Math.max(0, (state.room.startTokens != null ? state.room.startTokens : 2) - 1) });
      else if (act === 'start-tokens-plus') socket.emit('set-start-tokens', { count: Math.min(10, (state.room.startTokens != null ? state.room.startTokens : 2) + 1) });
      else if (act === 'set-visibility-private') socket.emit('set-visibility', { visibility: 'private' });
      else if (act === 'set-visibility-public') socket.emit('set-visibility', { visibility: 'public' });
      else if (act === 'set-free-card-off') socket.emit('set-free-card-enabled', { enabled: false });
      else if (act === 'set-free-card-on') socket.emit('set-free-card-enabled', { enabled: true });
      else if (act === 'set-game-mode') socket.emit('set-game-mode', { mode: elm.getAttribute('data-mode') });
      else if (act === 'toggle-bracket') toggleBracket(state.room, { from: parseInt(elm.getAttribute('data-from'), 10), to: parseInt(elm.getAttribute('data-to'), 10) });
      else if (act === 'reset-filters') resetFilters();
      else if (act === 'pick-dj') setDj(elm.getAttribute('data-pid'));
      else if (act === 'bot-play') botPlayTurn();
      else if (act === 'dismiss-result') { state.seenResultAt = parseInt(elm.getAttribute('data-ts'), 10); render(); }
      else if (act === 'play-preview') playPreviewManually();
      else if (act === 'draw-card') drawCard();
      else if (act === 'free-card') freeCardWithTokens();
      else if (act === 'skip-card') skipCard();
      else if (act === 'open-placement') openPlacementPicker();
      else if (act === 'open-challenge') openChallengePicker();
      else if (act === 'submit-guess') submitGuess();
      else if (act === 'reveal') reveal();
      else if (act === 'play-again') playAgain();
      else if (act === 'toggle-final-timelines') { state.showFinalTimelines = !state.showFinalTimelines; render(); }
      else if (act === 'select-gap') { state.selectedGap = parseInt(elm.getAttribute('data-gap'), 10); render(); }
      else if (act === 'confirm-gap') {
        if (state.selectedGap === null) return;
        const gap = state.selectedGap;
        const isChallenge = state.activeTimelinePlayerId === 'CHALLENGE';
        state.selectedGap = null; state.activeTimelinePlayerId = null;
        if (isChallenge) socket.emit('submit-challenge', { gapIndex: gap });
        else socket.emit('place-card', { gapIndex: gap });
        render();
      }
    });
  });
}

async function loadVersion() {
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    state.version = data.version;
    render();
  } catch (e) { /* not critical */ }
}

async function loadPublicRooms() {
  try {
    const res = await fetch('/api/public-rooms');
    state.publicRooms = await res.json();
  } catch (e) { state.publicRooms = []; }
  render();
}

function proceedPastReadyGate() {
  const saved = loadSession();
  if (saved && saved.code && saved.name) {
    // We have a session from before this page load (a previous tab that got
    // fully discarded by the phone counts as a reload from our side) — try
    // to silently resume it instead of dropping the user on the home screen.
    state.code = saved.code; state.playerName = saved.name; state.reconnecting = true;
    state.screen = 'home'; // fallback shown briefly if the resume attempt fails
    socket.emit('join-room', { code: saved.code, name: saved.name });
  } else {
    state.screen = 'home';
  }
}

async function pollReady() {
  try {
    const res = await fetch('/api/ready');
    state.ready = await res.json();
  } catch (e) { state.ready = null; }
  if (state.ready && state.ready.ready) {
    if (state.screen === 'welcome') {
      // Readiness finished before the user clicked through the one-time
      // welcome screen — don't jump ahead of them. The "C'est parti" button
      // re-checks state.ready itself once they do.
      render();
      return;
    }
    proceedPastReadyGate();
    render();
    return;
  }
  render();
  setTimeout(pollReady, 1000);
}

render();
pollReady();
loadCatalog();
loadBrackets();
loadVersion();
