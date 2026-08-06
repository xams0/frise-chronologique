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
let revealTicker = null; // interval id for animating the reveal-button countdown
let publicRoomsTicker = null; // interval id for auto-refreshing the public rooms list

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
  brackets: null, showFilters: false, artistSearch: '',
  healthReport: null, healthChecking: false,
  ready: null,
  connected: true, reconnecting: false,
  version: null, roomVisibility: 'private', publicRooms: null, maxPlayersInput: ''
};

function setError(msg) { state.error = msg; state.busy = false; render(); }
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
  if (filters.artists && filters.artists.length && !filters.artists.includes(song.artist)) return false;
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
  const f = room.filters || { brackets: [], artists: [] };
  setFilters(room, { ...f, brackets: toggleInArray(f.brackets, bracket) });
}
function toggleArtist(room, artist) {
  const f = room.filters || { brackets: [], artists: [] };
  setFilters(room, { ...f, artists: toggleInArray(f.artists, artist) });
}
function resetFilters() {
  socket.emit('set-filters', { filters: { brackets: [], artists: [] } });
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
function playAgain() { socket.emit('play-again'); state.screen = 'lobby'; render(); }
function setDj(playerId) { socket.emit('set-dj', { playerId }); state.showDjPicker = false; render(); }
function addTestBot() { socket.emit('add-bot'); }
function removeTestBot() { socket.emit('remove-bot'); }
function botPlayTurn() { socket.emit('bot-play'); }
function playPreviewManually() {
  if (audioEl) { audioEl.play().catch(() => {}); }
}

function me(room) { return room.players.find(p => p.id === state.playerId); }
function activePlayer(room) { return room.players.find(p => p.id === room.turnOrder[room.turnIndex % room.turnOrder.length]); }
function getDjId(room) { return room.djId || (room.players[0] && room.players[0].id); }
function getDjName(room) { const p = room.players.find(pl => pl.id === getDjId(room)); return p ? p.name : '?'; }

/* ============================= RENDER ============================= */
function render() {
  const root = document.getElementById('root');

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
      a.play().catch(() => { /* autoplay blocked — the manual play button covers this */ });
    }
  } else if (wantKey && !wantSrc) {
    // pending card exists but no preview available for it
    audioEl = null; audioKey = null;
  } else {
    audioEl = null; audioKey = null;
  }

  // Keep the "Révéler" countdown bar animating smoothly by re-rendering a
  // few times a second while a card is placed and still within its delay —
  // and stop as soon as it's not needed, so this never runs idle forever.
  const pend = state.room && state.room.pending;
  if (pend && pend.stage === 'placed' && pend.placedAt) {
    const delayMs = ((state.room.revealDelaySeconds || 15) * 1000);
    const elapsed = Date.now() - pend.placedAt;
    if (elapsed < delayMs) {
      if (!revealTicker) revealTicker = setInterval(render, 250);
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
    <p class="subtitle" style="margin-top:10px;">Vérification de la bibliothèque musicale sur Deezer avant d'ouvrir le salon…</p>

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
  const listenMode = room.listenMode || 'together';
  const revealDelay = room.revealDelaySeconds || 15;
  const audioMode = room.audioMode || 'loop';
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
            <div class="dot"></div>
            <div class="name">${escapeHtml(p.name)}${isMe(p.id) ? ' (toi)' : ''}${p.id === room.hostId ? ' 👑' : ''}${listenMode === 'together' && p.id === djId ? ' 🎚️' : ''}</div>
          </div>
          ${isHost && p.id !== room.hostId && !p.isBot ? `<button class="btn btn-danger btn-sm" style="width:auto;flex-shrink:0;" data-act="kick-player" data-pid="${p.id}">🚫</button>` : ''}
        </div>`).join('')}
      ${room.players.length === 1 ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;" data-act="add-bot">🧪 Ajouter un bot pour tester seul</button>` : ''}
      ${hasBot ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;" data-act="remove-bot">Retirer le bot de test</button>` : ''}
      ${!isHost ? `<p class="subtitle" style="margin:8px 0 0;">👑 ${escapeHtml(room.players.find(p => p.id === room.hostId)?.name || '?')} est l'hôte — seul·e à pouvoir changer les réglages et lancer la partie.</p>` : ''}
    </div>

    <div class="card-section">
      <h3>Nombre de joueurs maximum</h3>
      ${isHost ? `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        ${[2, 3, 4, 5, 6].map(n => `<button class="btn ${room.maxPlayers === n ? 'btn-gold' : 'btn-ghost'} btn-sm" style="width:auto;flex:1;min-width:44px;" data-act="set-max-players" data-max="${n}">${n}</button>`).join('')}
        <button class="btn ${!room.maxPlayers ? 'btn-gold' : 'btn-ghost'} btn-sm" style="width:auto;flex:1;min-width:70px;" data-act="set-max-players" data-max="">Illimité</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <input id="inp-max-custom" type="number" min="2" max="20" placeholder="Personnalisé (2-20)" value="${escapeHtml(state.maxPlayersInput)}" style="background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;"/>
        <button class="btn btn-ghost btn-sm" style="width:auto;" data-act="set-max-players-custom">Valider</button>
      </div>` : `<div class="code-pill" style="margin-top:8px;justify-content:center;">${room.maxPlayers ? room.maxPlayers + ' joueurs max' : 'Illimité'}</div>`}
    </div>

    <div class="card-section">
      <h3>Où êtes-vous ?</h3>
      ${isHost ? `
      <div class="row" style="margin-top:8px;">
        <button class="btn ${listenMode === 'together' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-listen-together">🎉 Tous ensemble</button>
        <button class="btn ${listenMode === 'remote' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-listen-remote">🏠 Chacun chez soi</button>
      </div>` : `
      <div class="code-pill" style="margin-top:8px;justify-content:center;">${listenMode === 'together' ? '🎉 Tous ensemble' : '🏠 Chacun chez soi'}</div>`}
      <p class="subtitle" style="margin:10px 0 0;">${listenMode === 'together'
        ? 'Un DJ unique diffuse la musique à voix haute pour toute la pièce.'
        : 'Pas de DJ — chaque joueur entend l\'extrait directement sur son propre téléphone.'}</p>
    </div>

    ${listenMode === 'together' ? `
    <div class="card-section">
      <h3>DJ actuel</h3>
      <p class="subtitle" style="margin:0 0 10px;">Le DJ fait jouer la musique sur son téléphone pour toute la salle.</p>
      <div class="row">
        <div class="code-pill" style="justify-content:center;">🎚️ ${escapeHtml(getDjName(room))}</div>
        ${isHost ? `<button class="btn btn-ghost btn-sm" data-act="open-dj">Changer</button>` : ''}
      </div>
    </div>` : ''}

    <div class="card-section">
      <h3>Délai avant de pouvoir révéler</h3>
      <p class="subtitle" style="margin:0 0 10px;">Le temps laissé aux autres pour défier avant que la carte puisse être révélée.</p>
      ${isHost ? `
      <div class="row" style="align-items:center;">
        <button class="btn btn-ghost btn-sm" data-act="reveal-delay-minus" ${revealDelay <= 5 ? 'disabled' : ''}>−5s</button>
        <div class="code-pill" style="justify-content:center;">${revealDelay}s</div>
        <button class="btn btn-ghost btn-sm" data-act="reveal-delay-plus" ${revealDelay >= 60 ? 'disabled' : ''}>+5s</button>
      </div>` : `<div class="code-pill" style="justify-content:center;">${revealDelay}s</div>`}
    </div>

    <div class="card-section">
      <h3>Musique</h3>
      <p class="subtitle" style="margin:0 0 10px;">L'extrait audio tourne en boucle, ou s'arrête après 30 secondes.</p>
      ${isHost ? `
      <div class="row">
        <button class="btn ${audioMode === 'loop' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-audio-loop">🔁 En boucle</button>
        <button class="btn ${audioMode === 'once' ? 'btn-gold' : 'btn-ghost'} btn-sm" data-act="set-audio-once">⏹️ 30 secondes</button>
      </div>` : `<div class="code-pill" style="justify-content:center;">${audioMode === 'loop' ? '🔁 En boucle' : '⏹️ 30 secondes'}</div>`}
    </div>

    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ``}

    <div class="card-section">
      <h3>Options de partie</h3>
      <p class="subtitle" style="margin:0 0 10px;">${matchCount(room) === null ? '…' : matchCount(room)} chanson${matchCount(room) === 1 ? '' : 's'} disponible${matchCount(room) === 1 ? '' : 's'} avec les filtres actuels.</p>
      ${isHost ? `<button class="btn btn-ghost btn-sm" data-act="show-filters">⚙️ Choisir périodes / artistes</button>` : ''}
    </div>

    ${isHost ? `
    <button class="btn btn-primary" data-act="start-game" ${room.players.length < 2 ? 'disabled' : ''}>
      ${room.players.length < 2 ? "En attente d'un 2e joueur…" : 'Lancer la partie'}
    </button>` : `
    <button class="btn btn-primary" disabled>En attente que l'hôte lance la partie…</button>`}
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
    ${state.showFilters ? renderFiltersModal(room) : ''}
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
    <div class="topbar">
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="code-pill">${room.code}</div>
        ${(room.listenMode || 'together') === 'together' ? `<button class="iconbtn" data-act="open-dj" title="Changer le DJ">🎚️</button>` : ''}
      </div>
      <button class="iconbtn" data-act="leave">✕</button>
    </div>

    ${room.lastResult && room.lastResult.ts !== state.seenResultAt ? renderResultBanner(room.lastResult) : ''}

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

    ${state.activeTimelinePlayerId ? renderPlacementModal(room) : ''}
    ${state.showRules ? renderRulesModal() : ''}
    ${state.showDjPicker ? renderDjModal(room) : ''}
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
    const canFree = myself.tokens >= 3 && (room.deck.length > 0 || room.discard.length > 0);
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
        <div class="vinyl spin" style="width:40px;height:40px;"></div>
        <button class="btn btn-ghost btn-sm" data-act="play-preview">▶️ Lecture (si le son ne démarre pas seul)</button>
        <div class="hint">Extrait audio de 30 secondes${(room.audioMode || 'loop') === 'loop' ? ', en boucle' : ', une seule fois'}. Rien à voir à l'écran — seul le son compte.</div>
      </div>`;
    } else {
      html += `<p class="subtitle" style="margin-top:10px;">🔇 Aperçu audio indisponible pour cette chanson sur Deezer — devinez à partir du titre/artiste une fois révélé, ou passez-la.</p>`;
    }
  }

  if (pend.stage === 'listening') {
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

function renderRevealButton(room, pend, label) {
  const delayMs = (room.revealDelaySeconds || 15) * 1000;
  const elapsed = Date.now() - (pend.placedAt || Date.now());
  const remaining = Math.max(0, delayMs - elapsed);
  const ready = remaining <= 0;
  const percent = Math.min(100, (elapsed / delayMs) * 100);
  const secondsLeft = Math.ceil(remaining / 1000);
  return `
  <button class="btn btn-primary reveal-btn" data-act="reveal" ${ready ? '' : 'disabled'}>
    <div class="reveal-fill" style="width:${percent}%;"></div>
    <span class="reveal-label">${ready ? label : `${label} (${secondsLeft}s)`}</span>
  </button>`;
}

function renderPendingParticipants(room, pend) {
  const activePl = room.players.find(p => p.id === pend.activePlayerId);
  const activeIsBot = !!activePl.isBot;
  const iAmActive = pend.activePlayerId === state.playerId;
  const meObj = me(room);
  let html = '<div class="stack" style="gap:8px;margin-top:6px;">';

  if (activeIsBot) {
    if (!pend.challenge && meObj.tokens >= 1) html += `<button class="btn btn-ghost btn-sm" data-act="open-challenge">🚨 Défier le Bot (1 🪙)</button>`;
    if (pend.challenge) html += `<p class="subtitle" style="margin:6px 0 0;">Tu as déjà défié ce placement.</p>`;
    html += renderRevealButton(room, pend, '🤖 Révéler pour le Bot');
  } else if (iAmActive) {
    html += renderRevealButton(room, pend, 'Révéler la carte');
  } else {
    if (!pend.challenge && meObj.tokens >= 1) html += `<button class="btn btn-ghost btn-sm" data-act="open-challenge">🚨 Défier (1 🪙)</button>`;
    if (pend.challenge) {
      const c = room.players.find(p => p.id === pend.challenge.playerId);
      html += `<p class="subtitle" style="margin:6px 0 0;">${escapeHtml(c.name)} a déjà défié ce placement.</p>`;
    }
    html += `<p class="subtitle" style="margin:6px 0 0;">Seul ${escapeHtml(activePl.name)} peut révéler la carte.</p>`;
  }
  html += '</div>';
  return html;
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
  return `<div class="result-banner ${tintCls} ${flashCls}">
    ${r.cover ? `<img src="${escapeHtml(r.cover)}" alt="" style="width:44px;height:44px;border-radius:8px;flex-shrink:0;object-fit:cover;"/>` : ''}
    <div style="flex:1;">${text}</div>
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
  return room.players.map(p => {
    const sorted = p.timeline.slice().sort((a, b) => a.year - b.year);
    let markers = [];
    if (pend && pend.activePlayerId === p.id && pend.placement) markers.push({ gapIndex: pend.placement.gapIndex, cls: 'pending', label: `Carte de ${p.name} (en attente)` });
    if (pend && pend.activePlayerId === p.id && pend.challenge) {
      const challenger = room.players.find(pl => pl.id === pend.challenge.playerId);
      markers.push({ gapIndex: pend.challenge.gapIndex, cls: 'challenge', label: `${challenger ? challenger.name : '?'} pense ici` });
    }
    const items = buildRibbonItems(sorted, markers);
    const isTurn = p.id === activeId;
    const playerMissed = missed.filter(m => m.playerId === p.id).slice(-5).reverse();
    return `
    <div class="card-section compact ${isTurn ? 'turn-active' : ''}">
      <div class="timeline-owner">
        <span>${isTurn ? '▶ ' : ''}<b style="color:var(--text)">${escapeHtml(p.name)}</b>${p.id === state.playerId ? ' (toi)' : ''} — ${p.timeline.length}/${CARDS_TO_WIN}</span>
        <span class="mono" style="color:var(--gold)">${p.tokens} 🪙</span>
      </div>
      <div class="ribbon">
        ${items.length === 0 ? '<div class="empty">Pas encore de carte</div>' :
          items.map(it => it.type === 'card'
            ? `<div class="ticket"><div class="year">${it.card.year}</div><div class="meta">${escapeHtml(it.card.title)}<br>${escapeHtml(it.card.artist)}</div></div>`
            : `<div class="ticket ${it.cls}"><div class="year">?</div><div class="meta">${escapeHtml(it.label)}</div></div>`
          ).join('')}
      </div>
      ${playerMissed.length ? `
      <div class="missed-history">
        ${playerMissed.map(m => `<div class="missed-line">❌ <b>${m.year}</b> — ${escapeHtml(m.title)}</div>`).join('')}
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
    if (selected) slots += `<div class="ticket pending"><div class="year">?</div><div class="meta">Ta carte ira ici</div></div>`;
    else slots += `<div class="slot"><button data-act="select-gap" data-gap="${i}" ${disabled ? 'disabled' : ''}>+</button></div>`;
    if (i < sorted.length) slots += `<div class="ticket"><div class="year">${sorted[i].year}</div><div class="meta">${escapeHtml(sorted[i].title)}<br>${escapeHtml(sorted[i].artist)}</div></div>`;
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

function renderFiltersModal(room) {
  const f = room.filters || { brackets: [], artists: [] };
  const catalog = state.catalog || [];
  const artists = [...new Set(catalog.map(s => s.artist).filter(Boolean))].sort();
  const search = state.artistSearch.trim().toLowerCase();
  const filteredArtists = search ? artists.filter(a => a.toLowerCase().includes(search)) : artists;

  const chip = (active) => `padding:8px 12px;border-radius:999px;font-size:13px;border:1px solid ${active ? 'var(--pink)' : 'var(--line)'};background:${active ? 'rgba(255,79,129,0.15)' : 'var(--surface2)'};color:${active ? 'var(--pink)' : 'var(--text)'};`;

  return `
  <div class="modal-bg" data-act="close-filters">
    <div class="modal" onclick="event.stopPropagation()">
      <h2>Options de partie</h2>
      <p class="subtitle" style="margin-top:0;">${matchCount(room)} chanson${matchCount(room) === 1 ? '' : 's'} correspondent — rien coché = tout est inclus.</p>

      <h3 style="margin-top:16px;">Périodes</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
        ${(state.brackets || []).map(b => `
          <button data-act="toggle-bracket" data-from="${b.from}" data-to="${b.to}" style="${chip(f.brackets.some(x => x.from === b.from && x.to === b.to))}">${b.label}</button>
        `).join('')}
      </div>

      <h3 style="margin-top:16px;">Artistes ${f.artists.length ? `(${f.artists.length} sélectionné${f.artists.length > 1 ? 's' : ''})` : ''}</h3>
      <input id="inp-artist-search" placeholder="Chercher un artiste…" value="${escapeHtml(state.artistSearch)}" style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;margin-top:8px;box-sizing:border-box;"/>
      <div style="max-height:160px;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:2px;">
        ${filteredArtists.slice(0, 60).map(a => `
          <button data-act="toggle-artist" data-val="${escapeHtml(a)}" style="text-align:left;padding:8px 10px;border-radius:8px;font-size:13px;background:${f.artists.includes(a) ? 'rgba(255,79,129,0.15)' : 'transparent'};color:${f.artists.includes(a) ? 'var(--pink)' : 'var(--text)'};">${f.artists.includes(a) ? '✓ ' : ''}${escapeHtml(a)}</button>
        `).join('')}
        ${filteredArtists.length === 0 ? '<div class="empty">Aucun artiste trouvé</div>' : ''}
      </div>

      <div class="row" style="margin-top:16px;">
        <button class="btn btn-ghost btn-sm" data-act="reset-filters">Réinitialiser</button>
        <button class="btn btn-gold btn-sm" data-act="close-filters">Fermer (${matchCount(room)})</button>
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
  const artistSearchEl = document.getElementById('inp-artist-search');
  if (artistSearchEl) artistSearchEl.oninput = e => { state.artistSearch = e.target.value; render(); };
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
      else if (act === 'set-audio-loop') socket.emit('set-audio-mode', { mode: 'loop' });
      else if (act === 'set-audio-once') socket.emit('set-audio-mode', { mode: 'once' });
      else if (act === 'show-filters') { state.showFilters = true; render(); }
      else if (act === 'close-filters') { state.showFilters = false; state.artistSearch = ''; render(); }
      else if (act === 'toggle-bracket') toggleBracket(state.room, { from: parseInt(elm.getAttribute('data-from'), 10), to: parseInt(elm.getAttribute('data-to'), 10) });
      else if (act === 'toggle-artist') toggleArtist(state.room, elm.getAttribute('data-val'));
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
