/* =========================================================
   FRISE MUSICALE — client
   Toute la logique de jeu vit sur le serveur (server.js).
   Ce fichier ne fait que : envoyer des actions au serveur,
   et redessiner l'écran quand l'état du salon change.
   ========================================================= */

const CARDS_TO_WIN = 10;
const socket = io();

/* ---------- audio preview player (survives re-renders without restarting) ---------- */
let audioEl = null;
let audioKey = null; // uniquely identifies which pending card is currently loaded

/* ---------- local UI state (never synced — purely this device's screen) ---------- */
const state = {
  screen: 'home',           // home | lobby | game
  mode: 'create',            // create | join
  nameInput: '', codeInput: '', error: '', busy: false,
  playerId: null, code: null, room: null,
  tab: 'timelines',
  guessTitle: '', guessArtist: '',
  showRules: false, showDjPicker: false, showLibrary: false, showImport: false,
  activeTimelinePlayerId: null, selectedGap: null,
  catalog: null, newSong: { title: '', artist: '', year: '' }, libError: '', libBusy: false, importError: '',
  seenResultAt: 0, ytMuted: true,
  brackets: null, showFilters: false, artistSearch: '',
  healthReport: null, healthChecking: false
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
  a.href = url; a.download = 'frise-musicale-chansons.json';
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
  state.playerId = playerId; state.code = code; state.room = room;
  state.screen = room.phase === 'lobby' ? 'lobby' : 'game';
  state.error = ''; state.busy = false;
  render();
});
socket.on('room', (room) => {
  state.room = room;
  state.screen = room.phase === 'lobby' ? 'lobby' : 'game';
  render();
});
socket.on('error-msg', (msg) => setError(msg));
socket.on('connect_error', () => setError('Connexion au serveur perdue — vérifie que le serveur tourne et que tu es sur le même Wi-Fi.'));

/* ---------- actions (thin — server owns all game logic) ---------- */
function createRoom() {
  const name = state.nameInput.trim();
  if (!name) return setError('Entre ton prénom.');
  state.busy = true; render();
  socket.emit('create-room', { name });
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
  Object.assign(state, { screen: 'home', room: null, code: null, playerId: null, error: '', nameInput: '', codeInput: '' });
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
  if (state.screen === 'home') html = renderHome();
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
      audioKey = wantKey;
      const a = document.createElement('audio');
      a.id = 'audio-slot';
      a.src = wantSrc;
      a.loop = true;
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

  attachHandlers();
}

function renderHome() {
  return `
  <div class="screen center">
    <div class="brand"><div class="vinyl"></div><h1 class="title-xl">Frise Musicale</h1></div>
    <p class="subtitle">Devinez l'année de la chanson et placez-la sur votre frise avant vos amis.<br>Serveur local — connectez-vous depuis le même Wi-Fi.</p>

    <div class="tabs" style="margin-top:26px;max-width:280px;">
      <button class="tab ${state.mode === 'create' ? 'active' : ''}" data-act="mode-create">Créer un salon</button>
      <button class="tab ${state.mode === 'join' ? 'active' : ''}" data-act="mode-join">Rejoindre</button>
    </div>

    <div class="stack">
      <div class="field">
        <label>Ton prénom</label>
        <input id="inp-name" type="text" placeholder="Ex. Léa" value="${escapeHtml(state.nameInput)}" maxlength="20"/>
      </div>
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

    <p class="footer-note">Extraits audio Deezer — rien à voir à l'écran, seul le son compte pour deviner.</p>
  </div>`;
}

function renderLobby() {
  const room = state.room;
  if (!room) return renderHome();
  const isMe = id => id === state.playerId;
  const djId = getDjId(room);
  const hasBot = room.players.some(p => p.isBot);
  return `
  <div class="screen">
    <div class="topbar">
      <div class="code-pill">${room.code} <button data-act="copy-code">copier</button></div>
      <button class="iconbtn" data-act="leave">✕</button>
    </div>
    <h2 style="margin-bottom:4px;">Salon d'attente</h2>
    <p class="subtitle" style="margin-top:0;">Partage le code <b class="mono" style="color:var(--gold)">${room.code}</b> avec tes amis, sur le même Wi-Fi.</p>

    <div class="card-section" style="margin-top:18px;">
      <h3>Joueurs (${room.players.length})</h3>
      ${room.players.map(p => `
        <div class="player-chip ${isMe(p.id) ? 'you' : ''}">
          <div class="dot"></div>
          <div class="name">${escapeHtml(p.name)}${isMe(p.id) ? ' (toi)' : ''}${p.id === djId ? ' 🎚️' : ''}</div>
        </div>`).join('')}
      ${room.players.length === 1 ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;" data-act="add-bot">🧪 Ajouter un bot pour tester seul</button>` : ''}
      ${hasBot ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;" data-act="remove-bot">Retirer le bot de test</button>` : ''}
    </div>

    <div class="card-section">
      <h3>DJ actuel</h3>
      <p class="subtitle" style="margin:0 0 10px;">Le DJ fait jouer la musique sur son téléphone pour toute la salle.</p>
      <div class="row">
        <div class="code-pill" style="justify-content:center;">🎚️ ${escapeHtml(getDjName(room))}</div>
        <button class="btn btn-ghost btn-sm" data-act="open-dj">Changer</button>
      </div>
    </div>

    ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ``}

    <div class="card-section">
      <h3>Options de partie</h3>
      <p class="subtitle" style="margin:0 0 10px;">${matchCount(room) === null ? '…' : matchCount(room)} chanson${matchCount(room) === 1 ? '' : 's'} disponible${matchCount(room) === 1 ? '' : 's'} avec les filtres actuels.</p>
      <button class="btn btn-ghost btn-sm" data-act="show-filters">⚙️ Choisir périodes / genres / pays / artistes</button>
    </div>

    <button class="btn btn-primary" data-act="start-game" ${room.players.length < 2 ? 'disabled' : ''}>
      ${room.players.length < 2 ? "En attente d'un 2e joueur…" : 'Lancer la partie'}
    </button>
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
  <div class="screen">
    <div class="topbar">
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="code-pill">${room.code}</div>
        <button class="iconbtn" data-act="open-dj" title="Changer le DJ">🎚️</button>
      </div>
      <button class="iconbtn" data-act="leave">✕</button>
    </div>

    <div class="tabs">
      <button class="tab ${state.tab === 'timelines' ? 'active' : ''}" data-act="tab-timelines">Frises</button>
      <button class="tab ${state.tab === 'log' ? 'active' : ''}" data-act="tab-log">Journal</button>
      <button class="tab ${state.tab === 'history' ? 'active' : ''}" data-act="tab-history">Historique</button>
    </div>

    ${room.lastResult && room.lastResult.ts !== state.seenResultAt ? renderResultBanner(room.lastResult) : ''}

    <div class="card-section">
      <div class="now-playing">
        <div class="vinyl ${pend ? 'spin' : ''}"></div>
        <div class="info">
          <div class="status">${isActive ? "C'est ton tour" : 'Tour de'}</div>
          <div class="who">${escapeHtml(active.name)}</div>
        </div>
      </div>
      <p class="subtitle" style="margin:8px 0 0;">🎚️ DJ : ${escapeHtml(getDjName(room))}</p>

      ${renderTurnAction(room, pend, isActive, myself)}
    </div>

    ${state.tab === 'timelines' ? renderAllTimelines(room) : ''}
    ${state.tab === 'log' ? renderLog(room) : ''}
    ${state.tab === 'history' ? renderHistoryTab(room) : ''}

    ${state.activeTimelinePlayerId ? renderPlacementModal(room) : ''}
    ${state.showRules ? renderRulesModal() : ''}
    ${state.showDjPicker ? renderDjModal(room) : ''}
  </div>`;
}

function renderTurnAction(room, pend, isActive, myself) {
  const active = activePlayer(room);
  const isDj = getDjId(room) === state.playerId;

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

  // Audio plays on the DJ's device from draw until reveal. For a bot's turn
  // (solo test mode) there's no DJ device involved, so play it for whichever
  // human is testing so they can judge whether to challenge.
  if (isDj || active.isBot) {
    if (pend.card.previewUrl) {
      html += `
      <div class="yt-wrap" style="aspect-ratio:auto;background:var(--surface2);padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px;">
        <div id="audio-slot" data-key="${pend.card.deezerId}-${pend.card.year}" data-src="${escapeHtml(pend.card.previewUrl)}"></div>
        <div class="vinyl spin" style="width:40px;height:40px;"></div>
        <button class="btn btn-ghost btn-sm" data-act="play-preview">▶️ Lecture (si le son ne démarre pas seul)</button>
        <div class="hint">Extrait audio de 30 secondes, en boucle. Rien à voir à l'écran — seul le son compte.</div>
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
      if (!isDj && !active.isBot) html += `<p class="subtitle" style="margin-top:8px;">🔊 Écoute sur l'appareil du DJ (${escapeHtml(getDjName(room))}).</p>`;
    } else if (!isDj && !active.isBot) {
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
      html += `<div class="guess-ok ${pend.guessCorrect ? 'flash-correct' : 'flash-wrong'}">${pend.guessCorrect ? '✔ Titre et artiste trouvés — jeton gagné.' : '✘ Pas trouvé cette fois.'}</div>`;
    }
  }

  if (pend.stage === 'placed') {
    html += `<div class="card-section" style="margin-top:12px;background:var(--surface2);">
      <h3>Carte en jeu</h3>
      <p style="font-size:14px;color:var(--text-dim);margin:0 0 10px;">${escapeHtml(active.name)} a placé sa carte sur sa frise. Quelqu'un pense que c'est faux ?</p>
      ${renderPendingParticipants(room, pend)}
    </div>`;
  }

  return html;
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
    html += `<button class="btn btn-primary" data-act="reveal">🤖 Révéler pour le Bot</button>`;
  } else if (iAmActive) {
    html += `<button class="btn btn-primary" data-act="reveal">Révéler la carte</button>`;
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

function renderResultBanner(r) {
  const cls = r.kind === 'wrong' ? 'flash-wrong' : 'flash-correct';
  let text;
  if (r.kind === 'wrong') text = `❌ "${escapeHtml(r.title)}" (${r.year}) — mal placée, défaussée.`;
  else if (r.kind === 'stolen') text = `🎯 "${escapeHtml(r.title)}" (${r.year}) — ${escapeHtml(r.activeName)} s'est trompé, ${escapeHtml(r.extraName)} récupère la carte !`;
  else text = `✅ "${escapeHtml(r.title)}" (${r.year}) — bien placée par ${escapeHtml(r.activeName)} !`;
  return `<div class="result-banner ${cls}">
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
  return room.players.map(p => {
    const sorted = p.timeline.slice().sort((a, b) => a.year - b.year);
    let markers = [];
    if (pend && pend.activePlayerId === p.id && pend.placement) markers.push({ gapIndex: pend.placement.gapIndex, cls: 'pending', label: `Carte de ${p.name} (en attente)` });
    if (pend && pend.activePlayerId === p.id && pend.challenge) {
      const challenger = room.players.find(pl => pl.id === pend.challenge.playerId);
      markers.push({ gapIndex: pend.challenge.gapIndex, cls: 'challenge', label: `${challenger ? challenger.name : '?'} pense ici` });
    }
    const items = buildRibbonItems(sorted, markers);
    return `
    <div class="card-section">
      <div class="timeline-owner">
        <span><b style="color:var(--text)">${escapeHtml(p.name)}</b>${p.id === state.playerId ? ' (toi)' : ''} — ${p.timeline.length}/${CARDS_TO_WIN}</span>
        <span class="mono" style="color:var(--gold)">${p.tokens} 🪙</span>
      </div>
      <div class="ribbon">
        ${items.length === 0 ? '<div class="empty">Pas encore de carte</div>' :
          items.map(it => it.type === 'card'
            ? `<div class="ticket"><div class="year">${it.card.year}</div><div class="meta">${escapeHtml(it.card.title)}<br>${escapeHtml(it.card.artist)}</div></div>`
            : `<div class="ticket ${it.cls}"><div class="year">?</div><div class="meta">${escapeHtml(it.label)}</div></div>`
          ).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderLog(room) {
  const items = room.log.slice(-40);
  return `<div class="card-section"><div class="log">
    ${items.slice().reverse().map(l => `<div class="log-line">${escapeHtml(l.text)} <span style="opacity:0.5">· ${escapeHtml(l.ts)}</span></div>`).join('')}
  </div></div>`;
}

function renderHistoryTab(room) {
  if (!room.history.length) return `<div class="card-section"><div class="empty">Aucune partie terminée pour l'instant dans ce salon.</div></div>`;
  return `<div class="card-section"><h3>Parties jouées</h3>
    ${room.history.map(h => `
      <div style="margin-bottom:12px;">
        <div style="font-weight:700;">🏆 ${escapeHtml(h.winnerName)} <span style="color:var(--text-dim);font-weight:400;font-size:12px;">— ${h.ts}</span></div>
        <div style="font-size:12.5px;color:var(--text-dim);">${h.players.map(pl => `${escapeHtml(pl.name)}: ${pl.cards}`).join(' · ')}</div>
      </div>`).join('')}
  </div>`;
}

function renderFinished() {
  const room = state.room;
  const last = room.history[0];
  return `
  <div class="screen center">
    <div class="brand"><div class="vinyl"></div></div>
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
    if (i < sorted.length) slots += `<div class="ticket"><div class="year">?</div><div class="meta">${escapeHtml(sorted[i].title)}</div></div>`;
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

  root.querySelectorAll('[data-act]').forEach(elm => {
    elm.addEventListener('click', (e) => {
      const act = elm.getAttribute('data-act');
      state.error = '';
      if (act === 'mode-create') { state.mode = 'create'; render(); }
      else if (act === 'mode-join') { state.mode = 'join'; render(); }
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
      else if (act === 'open-dj') { state.showDjPicker = true; render(); }
      else if (act === 'close-dj') { state.showDjPicker = false; render(); }
      else if (act === 'show-filters') { state.showFilters = true; render(); }
      else if (act === 'close-filters') { state.showFilters = false; state.artistSearch = ''; render(); }
      else if (act === 'toggle-bracket') toggleBracket(state.room, { from: parseInt(elm.getAttribute('data-from'), 10), to: parseInt(elm.getAttribute('data-to'), 10) });
      else if (act === 'toggle-artist') toggleArtist(state.room, elm.getAttribute('data-val'));
      else if (act === 'reset-filters') resetFilters();
      else if (act === 'pick-dj') setDj(elm.getAttribute('data-pid'));
      else if (act === 'bot-play') botPlayTurn();
      else if (act === 'dismiss-result') { state.seenResultAt = parseInt(elm.getAttribute('data-ts'), 10); render(); }
      else if (act === 'play-preview') playPreviewManually();
      else if (act === 'tab-timelines') { state.tab = 'timelines'; render(); }
      else if (act === 'tab-log') { state.tab = 'log'; render(); }
      else if (act === 'tab-history') { state.tab = 'history'; render(); }
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
    const badge = document.createElement('div');
    badge.className = 'version-badge';
    badge.textContent = 'v' + data.version;
    document.body.appendChild(badge);
  } catch (e) { /* not critical */ }
}

render();
loadCatalog();
loadBrackets();
loadVersion();
