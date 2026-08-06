const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const APP_VERSION = require('./package.json').version;
const DATA_DIR = __dirname;
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

const CARDS_TO_WIN = 10;
const START_TOKENS = 2;
const MAX_TOKENS = 5;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BRACKETS = [
  { from: 1900, to: 1919, label: '1900-1919' },
  { from: 1920, to: 1939, label: '1920-1939' },
  { from: 1940, to: 1959, label: '1940-1959' },
  { from: 1960, to: 1979, label: '1960-1979' },
  { from: 1980, to: 1999, label: '1980-1999' },
  { from: 2000, to: 2019, label: '2000-2019' },
  { from: 2020, to: 2026, label: '2020-2026' }
];
function emptyFilters() { return { brackets: [], artists: [] }; }
function songMatchesFilters(song, filters) {
  if (!filters) return true;
  if (filters.brackets && filters.brackets.length) {
    const inBracket = filters.brackets.some(b => song.year >= b.from && song.year <= b.to);
    if (!inBracket) return false;
  }
  if (filters.artists && filters.artists.length && !filters.artists.includes(song.artist)) return false;
  return true;
}

// ---------- persistence (flat JSON files, no DB needed) ----------
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('save failed', file, e.message); }
}

let catalog = loadJson(SONGS_FILE, []);
let rooms = loadJson(ROOMS_FILE, {});
function saveRooms() { saveJson(ROOMS_FILE, rooms); }
function saveCatalog() { saveJson(SONGS_FILE, catalog); }

// ---------- small utils ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function genCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function nowStr() {
  const d = new Date();
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}
// Standard Levenshtein edit distance — used to tolerate a few typos in guesses.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
// True if `guess` is close enough to `real` — exact containment always
// counts, and beyond that a handful of typos are tolerated (scaled to the
// length of the real word, with a small fixed minimum) rather than requiring
// a letter-perfect match.
function closeEnough(guess, real) {
  if (!guess || !real) return false;
  if (real.includes(guess) || guess.includes(real)) return true;
  const maxDist = Math.max(1, Math.round(real.length * 0.22));
  return levenshtein(guess, real) <= maxDist;
}
function matchGuess(gt, ga, real) {
  const nt = normalize(gt), na = normalize(ga);
  const rt = normalize(real.title), ra = normalize(real.artist.split(' ft.')[0].split(' feat.')[0]);
  const titleOk = nt.length > 2 && closeEnough(nt, rt);
  const artistOk = na.length > 2 && closeEnough(na, ra);
  return titleOk && artistOk;
}
function timelineYears(timeline) { return timeline.map(c => c.year).sort((a, b) => a - b); }
function gapCorrect(sortedYears, gapIndex, year) {
  const lower = gapIndex > 0 ? sortedYears[gapIndex - 1] : -Infinity;
  const upper = gapIndex < sortedYears.length ? sortedYears[gapIndex] : Infinity;
  return year >= lower && year <= upper;
}
function insertSorted(timeline, card) {
  const arr = timeline.slice();
  let i = 0;
  while (i < arr.length && arr[i].year <= card.year) i++;
  arr.splice(i, 0, card);
  return arr;
}

// ---------- Deezer (proxied server-side — the Deezer API doesn't send CORS
// headers, and preview URLs it returns are time-limited, so we never store
// them long-term: the catalog only keeps the permanent Deezer track id, and
// we fetch a fresh preview URL + cover art right when a card is drawn) ----------
// FAKE_DEEZER=1 is a test-only seam: it lets the automated test suite (and any
// environment without real internet access to Deezer) exercise the full game
// logic without depending on api.deezer.com actually being reachable. It is
// never set in production — Render will just never define this variable.
const FAKE_DEEZER = process.env.FAKE_DEEZER === '1';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Deezer's public API allows roughly 50 requests / 5 seconds. A "Quota limit
// exceeded" response is Deezer saying "slow down", NOT "this song doesn't
// exist" — treating it as a real failure would wrongly flag perfectly good
// songs as broken. So every Deezer call retries with backoff specifically on
// quota errors before ever giving up.
async function deezerFetchJson(url, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Deezer HTTP ' + res.status);
    const data = await res.json();
    if (data.error) {
      const isQuota = /quota/i.test(data.error.message || '');
      if (isQuota && attempt < retries) {
        await sleep(2500 * (attempt + 1)); // 2.5s, 5s, 7.5s, 10s
        continue;
      }
      throw new Error('Deezer error: ' + data.error.message);
    }
    return data;
  }
}

// FAKE_DEEZER_FAIL=1 (only meaningful alongside FAKE_DEEZER=1) simulates every
// song failing to match/preview — lets the test suite exercise the "zero
// playable songs" path deterministically and fast, without waiting through
// real pacing delays or depending on this sandbox's network being blocked.
const FAKE_DEEZER_FAIL = process.env.FAKE_DEEZER_FAIL === '1';

async function deezerSearch(query) {
  if (FAKE_DEEZER) return FAKE_DEEZER_FAIL ? [] : [{ id: 'fake-' + Buffer.from(query).toString('hex').slice(0, 12) }];
  const data = await deezerFetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`);
  return data.data || [];
}
async function deezerTrack(id) {
  if (FAKE_DEEZER) return FAKE_DEEZER_FAIL ? { preview: null } : { preview: 'https://example.invalid/fake-preview-' + id + '.mp3', album: { cover_medium: 'https://example.invalid/fake-cover.jpg' } };
  return await deezerFetchJson(`https://api.deezer.com/track/${id}`);
}
// Best-effort: attach {previewUrl, cover} to a card object for THIS turn only.
// Never throws — on any failure the card just plays without audio and the
// game continues (better than blocking the whole turn on a flaky lookup).
async function attachFreshPreview(card) {
  if (!card.deezerId) return card;
  try {
    const t = await deezerTrack(card.deezerId);
    return { ...card, previewUrl: t.preview || null, cover: (t.album && t.album.cover_medium) || null };
  } catch (e) {
    console.warn('Deezer preview fetch failed for', card.title, '-', e.message);
    return { ...card, previewUrl: null, cover: null };
  }
}
// Draws the next card from the deck, but never hands back one with no playable
// preview — those get quietly set aside (and re-tried later, after a reshuffle,
// in case it was just a transient hiccup) so a player never gets stuck guessing
// a song they can't hear.
async function drawPlayableCard(room, maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (room.deck.length === 0) {
      if (room.discard.length === 0) return null;
      room.deck = shuffle(room.discard);
      room.discard = [];
    }
    const raw = room.deck.pop();
    const card = await attachFreshPreview(raw);
    if (card.previewUrl) return card;
    console.warn(`Carte sans aperçu audio, mise de côté: ${raw.artist} – ${raw.title}`);
    room.discard.push(raw);
  }
  return null;
}
// Fills in missing deezerId for any catalog entry that doesn't have one yet
// (runs at boot, and again whenever a song is added without a match).
async function ensureDeezerIds() {
  const todo = catalog.filter(s => !s.deezerId);
  if (!todo.length) return;
  let changed = false;
  const BATCH = 5; // small batches + a pause below keeps us well under Deezer's ~50 req/5s limit
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await Promise.all(batch.map(async (song) => {
      try {
        const results = await deezerSearch(`${song.artist} ${song.title}`);
        if (results.length) {
          song.deezerId = results[0].id;
          changed = true;
          console.log(`Deezer ✓ ${song.artist} – ${song.title} -> id ${song.deezerId}`);
        } else {
          console.warn(`Deezer: aucun résultat pour ${song.artist} – ${song.title}`);
        }
      } catch (e) {
        console.warn(`Deezer: recherche échouée pour ${song.artist} – ${song.title}:`, e.message);
      }
    }));
    if (i + BATCH < todo.length && !FAKE_DEEZER) await sleep(1200);
  }
  if (changed) saveCatalog();
}

// ---------- startup readiness gate ----------
// Nobody can create or join a room until EVERY song in the catalog has been
// checked against Deezer this boot cycle (resolved match + confirmed playable
// preview). `readyState` is polled by the client for the loading screen.
let readyState = { ready: false, checked: 0, total: 0, ok: 0 };

async function verifyAndPrepareCatalog() {
  readyState = { ready: false, checked: 0, total: catalog.length, ok: 0 };
  let catalogChanged = false;
  const BATCH = 5;
  for (let i = 0; i < catalog.length; i += BATCH) {
    const batch = catalog.slice(i, i + BATCH);
    await Promise.all(batch.map(async (song) => {
      try {
        if (!song.deezerId) {
          const results = await deezerSearch(`${song.artist} ${song.title}`);
          if (results.length) { song.deezerId = results[0].id; catalogChanged = true; }
        }
        if (song.deezerId) {
          const t = await deezerTrack(song.deezerId);
          song._verifiedPreview = !!t.preview;
          if (song._verifiedPreview) readyState.ok++;
        } else {
          song._verifiedPreview = false;
        }
      } catch (e) {
        song._verifiedPreview = false;
        console.warn(`Vérification échouée pour ${song.artist} – ${song.title}:`, e.message);
      } finally {
        readyState.checked++;
      }
    }));
    if (i + BATCH < catalog.length && !FAKE_DEEZER) await sleep(1200);
  }
  if (catalogChanged) saveCatalog();
  readyState.ready = true;
  console.log(`Vérification terminée : ${readyState.ok}/${readyState.total} chansons confirmées jouables.`);
}

// ---------- room helpers ----------
function me(room, playerId) { return room.players.find(p => p.id === playerId); }
function activePlayer(room) { return room.players.find(p => p.id === room.turnOrder[room.turnIndex % room.turnOrder.length]); }
function getDjId(room) { return room.djId || (room.players[0] && room.players[0].id); }
function isHost(room, playerId) { return room.hostId === playerId; }
function publicRoom(room) { return room; } // everything is safe to broadcast (no secrets server-side beyond the drawn card, which is fine to reveal once drawn)

function broadcast(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room', room);
}

function advanceTurn(room) {
  room.turnIndex = (room.turnIndex + 1) % room.turnOrder.length;
  room.pending = null;
}

async function finishGame(room, winner) {
  room.phase = 'finished';
  room.history.unshift({
    ts: nowStr(),
    winnerName: winner.name,
    players: room.players.map(p => ({ name: p.name, cards: p.timeline.length }))
  });
  room.log.push({ ts: nowStr(), text: `🏆 ${winner.name} gagne la partie avec ${winner.timeline.length} cartes !` });
}

// Auto-reveal timers — kept OUTSIDE the room object (setTimeout handles
// aren't JSON-serializable and must never end up in a broadcast payload).
const revealTimers = {};
function clearAutoReveal(code) {
  if (revealTimers[code]) { clearTimeout(revealTimers[code]); delete revealTimers[code]; }
}
function scheduleAutoReveal(room) {
  clearAutoReveal(room.code);
  const delayMs = (room.revealDelaySeconds || 15) * 1000;
  revealTimers[room.code] = setTimeout(() => {
    delete revealTimers[room.code];
    const r = rooms[room.code];
    if (r && r.pending && r.pending.stage === 'placed') {
      resolveReveal(r);
      saveRooms();
      broadcast(room.code);
    }
  }, delayMs);
}

// Shared cleanup for any time a player leaves the room (voluntarily or
// kicked): fixes up turn order/pending/DJ/host, ends an in-progress game if
// too few players remain, and deletes the room entirely if it's now empty.
function removePlayerFromRoom(room, targetId) {
  const idx = room.players.findIndex(p => p.id === targetId);
  if (idx === -1) return null;
  const removed = room.players[idx];
  room.players.splice(idx, 1);

  if (room.phase === 'playing' && room.turnOrder.length) {
    const wasActive = room.turnOrder[room.turnIndex % room.turnOrder.length] === targetId;
    const wasBeingChallenged = room.pending && room.pending.challenge && room.pending.challenge.playerId === targetId;
    room.turnOrder = room.turnOrder.filter(id => id !== targetId);
    if (wasBeingChallenged) room.pending.challenge = null;
    if (wasActive) { clearAutoReveal(room.code); room.pending = null; }
    if (room.turnOrder.length) room.turnIndex = room.turnIndex % room.turnOrder.length;
  }

  if (room.djId === targetId) {
    const stillHere = room.players.find(p => !p.isBot);
    room.djId = stillHere ? stillHere.id : null;
  }

  if (room.hostId === targetId && room.players.length) {
    const nextHost = room.players.find(p => !p.isBot) || room.players[0];
    room.hostId = nextHost.id;
    room.log.push({ ts: nowStr(), text: `👑 ${nextHost.name} est maintenant l'hôte du salon.` });
  }

  // Not enough players left to keep an in-progress game going — including
  // the specific case the host asked for: the host left alone.
  if (room.phase === 'playing' && room.players.length < 2) {
    clearAutoReveal(room.code);
    room.phase = 'lobby';
    room.pending = null;
    room.deck = []; room.discard = [];
    room.turnOrder = []; room.turnIndex = 0;
    room.log.push({ ts: nowStr(), text: '🏁 Partie interrompue — plus assez de joueurs pour continuer.' });
  }

  if (room.players.length === 0) {
    clearAutoReveal(room.code);
    delete rooms[room.code];
  }

  return removed;
}

function resolveReveal(room) {
  const pend = room.pending;
  const active = room.players.find(pl => pl.id === pend.activePlayerId);
  const activeYears = timelineYears(active.timeline);
  const activeCorrect = pend.placement ? gapCorrect(activeYears, pend.placement.gapIndex, pend.card.year) : false;
  let winner = null;

  if (activeCorrect) {
    active.timeline = insertSorted(active.timeline, pend.card);
    winner = active;
    room.log.push({ ts: nowStr(), text: `✅ Correct ! "${pend.card.title}" (${pend.card.year}) rejoint la frise de ${active.name}.` });
    room.lastResult = { ts: Date.now(), kind: 'correct', title: pend.card.title, artist: pend.card.artist, year: pend.card.year, activeName: active.name, cover: pend.card.cover || null };
  } else if (pend.challenge) {
    const challenger = room.players.find(pl => pl.id === pend.challenge.playerId);
    const challengeCorrect = gapCorrect(activeYears, pend.challenge.gapIndex, pend.card.year);
    if (!room.missedCards) room.missedCards = [];
    room.missedCards.push({ playerId: active.id, title: pend.card.title, artist: pend.card.artist, year: pend.card.year, ts: Date.now() });
    if (challengeCorrect) {
      challenger.timeline = insertSorted(challenger.timeline, pend.card);
      winner = challenger;
      room.log.push({ ts: nowStr(), text: `🎯 ${active.name} s'est trompé, mais ${challenger.name} avait raison — la carte "${pend.card.title}" (${pend.card.year}) file dans sa frise !` });
      room.lastResult = { ts: Date.now(), kind: 'stolen', title: pend.card.title, artist: pend.card.artist, year: pend.card.year, activeName: active.name, extraName: challenger.name, cover: pend.card.cover || null };
    } else {
      room.discard.push(pend.card);
      room.log.push({ ts: nowStr(), text: `❌ Mauvais placement des deux côtés — "${pend.card.title}" (${pend.card.year}) est défaussée.` });
      room.lastResult = { ts: Date.now(), kind: 'wrong', title: pend.card.title, artist: pend.card.artist, year: pend.card.year, activeName: active.name, cover: pend.card.cover || null };
    }
  } else {
    room.discard.push(pend.card);
    if (!room.missedCards) room.missedCards = [];
    room.missedCards.push({ playerId: active.id, title: pend.card.title, artist: pend.card.artist, year: pend.card.year, ts: Date.now() });
    room.log.push({ ts: nowStr(), text: `❌ Raté — "${pend.card.title}" (${pend.card.year}) était mal placée et est défaussée.` });
    room.lastResult = { ts: Date.now(), kind: 'wrong', title: pend.card.title, artist: pend.card.artist, year: pend.card.year, activeName: active.name, cover: pend.card.cover || null };
  }

  room.pending = null;
  clearAutoReveal(room.code);

  if (winner && winner.timeline.length >= CARDS_TO_WIN) {
    finishGame(room, winner);
  } else {
    advanceTurn(room);
  }
}

async function botPlayTurn(room) {
  const bot = activePlayer(room);
  if (!bot || !bot.isBot) return;
  const card = await drawPlayableCard(room);
  if (!card) return;
  const years = timelineYears(bot.timeline);
  const correctGaps = [];
  for (let i = 0; i <= years.length; i++) { if (gapCorrect(years, i, card.year)) correctGaps.push(i); }
  let gap;
  if (Math.random() < 0.55 && correctGaps.length) gap = correctGaps[Math.floor(Math.random() * correctGaps.length)];
  else gap = Math.floor(Math.random() * (years.length + 1));
  room.pending = { card, activePlayerId: bot.id, stage: 'placed', placement: { gapIndex: gap }, challenge: null, guessCorrect: null, guessBy: 'bot-na', placedAt: Date.now() };
  room.log.push({ ts: nowStr(), text: `🤖 Le Bot pioche et place une chanson (${card.year}) sur sa frise. À vous de décider si vous le croyez !` });
  scheduleAutoReveal(room);
}

// ---------- express: static files + catalog REST ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/songs', (req, res) => res.json(catalog));
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));
app.get('/api/ready', (req, res) => res.json(readyState));
app.get('/api/public-rooms', (req, res) => {
  const list = Object.values(rooms)
    .filter(r => r.visibility === 'public' && r.phase === 'lobby' && !(r.maxPlayers && r.players.length >= r.maxPlayers))
    .map(r => ({
      code: r.code,
      playerCount: r.players.length,
      maxPlayers: r.maxPlayers || null,
      hostName: (r.players.find(p => p.id === r.hostId) || {}).name || '?'
    }));
  res.json(list);
});
app.get('/api/brackets', (req, res) => res.json(BRACKETS));

app.post('/api/songs', async (req, res) => {
  const { title, artist, year } = req.body || {};
  const t = (title || '').trim();
  const a = (artist || '').trim();
  const y = parseInt(year, 10);
  if (!t || !a) return res.status(400).json({ error: 'Titre et artiste obligatoires.' });
  if (!y || y < 1900 || y > 2035) return res.status(400).json({ error: 'Année invalide.' });
  const dup = catalog.some(s => normalize(s.title) === normalize(t) && normalize(s.artist) === normalize(a));
  if (dup) return res.status(400).json({ error: 'Cette chanson est déjà dans la bibliothèque.' });
  let deezerId = null;
  try {
    const results = await deezerSearch(`${a} ${t}`);
    if (results.length) deezerId = results[0].id;
  } catch (e) {
    return res.status(502).json({ error: "Impossible de joindre Deezer pour l'instant, réessaie." });
  }
  if (!deezerId) return res.status(400).json({ error: 'Introuvable sur Deezer — vérifie l\'orthographe du titre et de l\'artiste.' });
  catalog.push({ title: t, artist: a, year: y, deezerId });
  saveCatalog();
  res.json(catalog);
});

app.post('/api/songs/import', async (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'JSON invalide.' });
  let added = 0;
  for (const s of list) {
    if (!s || !s.title || !s.artist || !s.year) continue;
    const dup = catalog.some(x => normalize(x.title) === normalize(s.title) && normalize(x.artist) === normalize(s.artist));
    if (dup) continue;
    catalog.push({ title: String(s.title), artist: String(s.artist), year: parseInt(s.year, 10), deezerId: s.deezerId || null });
    added++;
  }
  if (added > 0) { saveCatalog(); ensureDeezerIds(); } // resolve any missing deezerId in the background
  res.json({ catalog, added });
});

app.delete('/api/songs', (req, res) => {
  const { title, artist } = req.body || {};
  const before = catalog.length;
  catalog = catalog.filter(s => !(normalize(s.title) === normalize(title) && normalize(s.artist) === normalize(artist)));
  if (catalog.length === before) return res.status(404).json({ error: 'Chanson introuvable.' });
  saveCatalog();
  res.json(catalog);
});

// Scans the WHOLE catalog against Deezer right now and reports exactly which
// songs are missing a match, and which have a match but no playable preview
// clip at this moment (previews can come and go — regional licensing, etc).
// This is a real-time check, not cached, so it can take a little while for a
// few hundred songs — batched in parallel groups to keep it reasonable.
app.get('/api/songs/health', async (req, res) => {
  const noMatch = [];
  const noPreview = [];
  let okCount = 0;
  const BATCH = 5; // small batches + a pause keeps us well under Deezer's ~50 req/5s limit
  for (let i = 0; i < catalog.length; i += BATCH) {
    const batch = catalog.slice(i, i + BATCH);
    await Promise.all(batch.map(async (song) => {
      if (!song.deezerId) { noMatch.push({ title: song.title, artist: song.artist, year: song.year }); return; }
      try {
        const t = await deezerTrack(song.deezerId);
        if (t.preview) okCount++;
        else noPreview.push({ title: song.title, artist: song.artist, year: song.year });
      } catch (e) {
        noPreview.push({ title: song.title, artist: song.artist, year: song.year, reason: e.message });
      }
    }));
    if (i + BATCH < catalog.length && !FAKE_DEEZER) await sleep(1200);
  }
  res.json({ total: catalog.length, ok: okCount, noMatch, noPreview });
});

// ---------- socket.io: real-time game events ----------
io.on('connection', (socket) => {

  socket.on('create-room', ({ name, visibility }) => {
    if (!readyState.ready) return socket.emit('error-msg', 'Le serveur vérifie encore la bibliothèque musicale, réessaie dans un instant.');
    name = (name || '').trim().slice(0, 20);
    if (!name) return socket.emit('error-msg', 'Entre ton prénom.');
    let code;
    do { code = genCode(); } while (rooms[code]);
    const playerId = genId();
    const room = {
      code, phase: 'lobby',
      visibility: visibility === 'public' ? 'public' : 'private',
      hostId: playerId, // the creator — only they can start the game or change settings
      players: [{ id: playerId, name, tokens: START_TOKENS, timeline: [] }],
      turnOrder: [], turnIndex: 0,
      deck: [], discard: [], pending: null, lastResult: null,
      djId: playerId,
      listenMode: 'together', // 'together' = one DJ plays for the room | 'remote' = everyone hears it on their own device
      revealDelaySeconds: 15, // minimum wait before "Révéler" can be pressed, so others have time to challenge
      audioMode: 'loop', // 'loop' = repeat the 30s preview | 'once' = play once and stop
      missedCards: [], // history of wrong guesses, per player, shown under their timeline
      maxPlayers: null, // null = no limit
      filters: emptyFilters(),
      log: [{ ts: nowStr(), text: `${name} a créé le salon.` }],
      history: []
    };
    rooms[code] = room;
    saveRooms();
    socket.join(code);
    socket.data.code = code;
    socket.data.playerId = playerId;
    socket.emit('joined', { playerId, code, room });
    broadcast(code);
  });

  socket.on('join-room', ({ code, name }) => {
    if (!readyState.ready) return socket.emit('error-msg', 'Le serveur vérifie encore la bibliothèque musicale, réessaie dans un instant.');
    code = (code || '').trim().toUpperCase();
    name = (name || '').trim().slice(0, 20);
    const room = rooms[code];
    if (!room) return socket.emit('error-msg', 'Aucun salon avec ce code.');
    if (!name) return socket.emit('error-msg', 'Entre ton prénom.');
    const existing = room.players.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      socket.join(code);
      socket.data.code = code;
      socket.data.playerId = existing.id;
      socket.emit('joined', { playerId: existing.id, code, room });
      return;
    }
    if (room.phase !== 'lobby') {
      return socket.emit('error-msg', 'La partie a déjà commencé. Ressaisis exactement le prénom utilisé pour reprendre ta place.');
    }
    if (room.maxPlayers && room.players.length >= room.maxPlayers) {
      return socket.emit('error-msg', `Ce salon est complet (maximum ${room.maxPlayers} joueurs).`);
    }
    const playerId = genId();
    room.players.push({ id: playerId, name, tokens: START_TOKENS, timeline: [] });
    room.log.push({ ts: nowStr(), text: `${name} a rejoint le salon.` });
    saveRooms();
    socket.join(code);
    socket.data.code = code;
    socket.data.playerId = playerId;
    socket.emit('joined', { playerId, code, room });
    broadcast(code);
  });

  function withRoom(handler) {
    return async (payload) => {
      const code = socket.data.code;
      const room = rooms[code];
      if (!room) return socket.emit('error-msg', 'Salon introuvable.');
      try { await handler(room, payload || {}); }
      catch (e) { console.error(e); socket.emit('error-msg', 'Erreur serveur.'); }
      saveRooms();
      broadcast(code);
    };
  }

  socket.on('start-game', withRoom((room) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut lancer la partie.');
    if (room.players.length < 2) return socket.emit('error-msg', 'Il faut au moins 2 joueurs.');
    const pool = catalog.filter(s => s._verifiedPreview && songMatchesFilters(s, room.filters));
    if (!pool.length || pool.length < CARDS_TO_WIN + 2) {
      return socket.emit('error-msg', `Seulement ${pool.length} chanson(s) jouables correspondent aux filtres actifs — il en faut au moins ${CARDS_TO_WIN + 2}. Élargis les filtres, ou attends que le serveur finisse d'associer le catalogue à Deezer (regarde les logs).`);
    }
    let deck = shuffle(pool.map((s, i) => ({ ...s, uid: 's' + i })));
    const players = room.players.map(p => ({ ...p, tokens: START_TOKENS, timeline: [] }));
    players.forEach(p => { p.timeline = [deck.pop()]; });
    room.players = players;
    room.deck = deck;
    room.discard = [];
    room.turnOrder = shuffle(players.map(p => p.id));
    room.turnIndex = 0;
    room.pending = null;
    room.lastResult = null;
    room.phase = 'playing';
    room.log.push({ ts: nowStr(), text: `La partie commence (${pool.length} chansons disponibles avec les filtres actifs) — chaque joueur a reçu une chanson de départ !` });
  }));

  socket.on('set-filters', withRoom((room, { filters }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut changer les filtres.');
    if (room.phase !== 'lobby' || !filters) return;
    room.filters = {
      brackets: Array.isArray(filters.brackets) ? filters.brackets : [],
      artists: Array.isArray(filters.artists) ? filters.artists : []
    };
  }));

  socket.on('set-listen-mode', withRoom((room, { mode }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut changer le mode d\'écoute.');
    if (room.phase !== 'lobby') return;
    if (mode !== 'together' && mode !== 'remote') return;
    room.listenMode = mode;
    room.log.push({
      ts: nowStr(),
      text: mode === 'remote'
        ? '🏠 Mode "Chacun chez soi" activé — la musique joue sur l\'appareil de chaque joueur.'
        : '🎉 Mode "Tous ensemble" activé — un DJ unique diffuse la musique pour la salle.'
    });
  }));

  socket.on('set-reveal-delay', withRoom((room, { seconds }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut changer ce réglage.');
    if (room.phase !== 'lobby') return;
    const s = parseInt(seconds, 10);
    if (!Number.isFinite(s) || s < 3 || s > 60) return socket.emit('error-msg', 'Le délai doit être entre 3 et 60 secondes.');
    room.revealDelaySeconds = s;
    room.log.push({ ts: nowStr(), text: `⏱️ Délai avant de pouvoir révéler réglé sur ${s} secondes.` });
  }));

  socket.on('set-audio-mode', withRoom((room, { mode }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut changer ce réglage.');
    if (room.phase !== 'lobby') return;
    if (mode !== 'loop' && mode !== 'once') return;
    room.audioMode = mode;
    room.log.push({ ts: nowStr(), text: mode === 'loop' ? '🔁 La musique jouera en boucle.' : '⏹️ La musique jouera une seule fois (30 secondes).' });
  }));

  socket.on('set-visibility', withRoom((room, { visibility }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut changer ce réglage.');
    if (room.phase !== 'lobby') return;
    if (visibility !== 'public' && visibility !== 'private') return;
    room.visibility = visibility;
    room.log.push({ ts: nowStr(), text: visibility === 'public' ? '🌐 Le salon est maintenant public (visible dans la liste).' : '🔒 Le salon est maintenant privé (uniquement par code).' });
  }));

  socket.on('set-max-players', withRoom((room, { max }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut changer ce réglage.');
    if (room.phase !== 'lobby') return;
    if (max === null) {
      room.maxPlayers = null;
      room.log.push({ ts: nowStr(), text: '👥 Plus de limite de joueurs.' });
      return;
    }
    const m = parseInt(max, 10);
    if (!Number.isFinite(m) || m < 2 || m > 20) return socket.emit('error-msg', 'Le nombre maximum doit être entre 2 et 20.');
    if (m < room.players.length) return socket.emit('error-msg', `Il y a déjà ${room.players.length} joueurs dans le salon — choisis un maximum plus grand.`);
    room.maxPlayers = m;
    room.log.push({ ts: nowStr(), text: `👥 Nombre de joueurs maximum réglé sur ${m}.` });
  }));

  socket.on('leave-room', withRoom(async (room) => {
    const targetId = socket.data.playerId;
    const left = removePlayerFromRoom(room, targetId);
    if (left && rooms[room.code]) room.log.push({ ts: nowStr(), text: `${left.name} a quitté le salon.` });
    socket.leave(room.code);
    socket.data.code = null;
    socket.data.playerId = null;
  }));

  socket.on('kick-player', withRoom(async (room, { playerId: targetId }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut exclure un joueur.');
    if (targetId === room.hostId) return socket.emit('error-msg', 'L\'hôte ne peut pas s\'exclure lui-même.');
    const kicked = removePlayerFromRoom(room, targetId);
    if (!kicked) return;
    if (rooms[room.code]) room.log.push({ ts: nowStr(), text: `🚫 ${kicked.name} a été exclu(e) du salon par l'hôte.` });

    const sockets = await io.in(room.code).fetchSockets();
    for (const s of sockets) {
      if (s.data.playerId === targetId) {
        s.emit('kicked');
        s.leave(room.code);
        s.data.code = null;
        s.data.playerId = null;
      }
    }
  }));

  socket.on('draw-card', withRoom(async (room) => {
    const playerId = socket.data.playerId;
    const active = activePlayer(room);
    if (!active || active.id !== playerId || room.pending) return;
    const card = await drawPlayableCard(room);
    if (!card) return socket.emit('error-msg', 'Plus de chansons avec un aperçu audio jouable dans la pioche !');
    room.pending = { card, activePlayerId: playerId, stage: 'listening', placement: null, challenge: null, guessCorrect: null, guessBy: null };
    room.log.push({ ts: nowStr(), text: `${me(room, playerId).name} pioche une chanson.` });
  }));

  socket.on('skip-card', withRoom(async (room) => {
    const playerId = socket.data.playerId;
    const p = me(room, playerId);
    if (!p || !room.pending || room.pending.activePlayerId !== playerId || p.tokens < 1) return;
    p.tokens -= 1;
    room.discard.push(room.pending.card);
    room.log.push({ ts: nowStr(), text: `${p.name} dépense 1 jeton pour passer la chanson.` });
    room.pending = null;
    const card = await drawPlayableCard(room);
    if (card) {
      room.pending = { card, activePlayerId: playerId, stage: 'listening', placement: null, challenge: null, guessCorrect: null, guessBy: null };
    }
  }));

  socket.on('free-card', withRoom((room) => {
    const playerId = socket.data.playerId;
    const p = me(room, playerId);
    const active = activePlayer(room);
    if (!p || !active || active.id !== playerId || room.pending || p.tokens < 3) return;
    if (room.deck.length === 0) {
      if (room.discard.length === 0) return socket.emit('error-msg', 'Plus de chansons disponibles !');
      room.deck = shuffle(room.discard); room.discard = [];
    }
    const card = room.deck.pop();
    p.tokens -= 3;
    p.timeline = insertSorted(p.timeline, card);
    room.log.push({ ts: nowStr(), text: `${p.name} échange 3 jetons contre une carte posée directement (${card.year}).` });
    if (p.timeline.length >= CARDS_TO_WIN) finishGame(room, p);
    else advanceTurn(room);
  }));

  socket.on('place-card', withRoom((room, { gapIndex }) => {
    const playerId = socket.data.playerId;
    if (!room.pending || room.pending.activePlayerId !== playerId || room.pending.stage !== 'listening') return;
    room.pending.placement = { gapIndex };
    room.pending.stage = 'placed';
    room.pending.placedAt = Date.now();
    room.log.push({ ts: nowStr(), text: `${me(room, playerId).name} a placé sa carte sur sa frise.` });
    scheduleAutoReveal(room);
  }));

  socket.on('submit-challenge', withRoom((room, { gapIndex }) => {
    const playerId = socket.data.playerId;
    const p = me(room, playerId);
    if (!p || !room.pending || room.pending.stage !== 'placed' || room.pending.challenge) return;
    if (room.pending.activePlayerId === playerId || p.tokens < 1) return;
    if (room.pending.placement && gapIndex === room.pending.placement.gapIndex) {
      return socket.emit('error-msg', 'Choisis un autre emplacement que celui déjà posé.');
    }
    p.tokens -= 1;
    room.pending.challenge = { playerId, gapIndex };
    room.log.push({ ts: nowStr(), text: `${p.name} crie "Défi !" et parie 1 jeton.` });
  }));

  socket.on('submit-guess', withRoom((room, { title, artist }) => {
    const playerId = socket.data.playerId;
    if (!room.pending || room.pending.guessBy || room.pending.activePlayerId !== playerId) return;
    const correct = matchGuess(title, artist, room.pending.card);
    room.pending.guessCorrect = correct;
    room.pending.guessBy = playerId;
    const p = me(room, playerId);
    if (correct) {
      if (p.tokens < MAX_TOKENS) p.tokens += 1;
      room.log.push({ ts: nowStr(), text: `${p.name} trouve le titre et l'artiste — +1 jeton !` });
    } else {
      room.log.push({ ts: nowStr(), text: `${p.name} n'a pas trouvé le titre/artiste.` });
    }
  }));

  socket.on('reveal', withRoom((room) => {
    const playerId = socket.data.playerId;
    if (!room.pending || room.pending.stage !== 'placed') return;
    const active = room.players.find(p => p.id === room.pending.activePlayerId);
    if (!active) return;
    const requester = room.players.find(p => p.id === playerId);
    if (!requester && !active.isBot) return; // must be a known player (or acting on behalf of a bot)

    // Only the active player revealing their OWN card is bound by the delay
    // — that's what gives everyone else a fair window to challenge. Anyone
    // ELSE choosing to reveal (because they're confident it's correct and
    // don't want to wait) does so voluntarily, so it skips the timer —
    // same for revealing on behalf of a bot's turn.
    const isActiveRevealingOwnCard = !active.isBot && active.id === playerId;
    if (isActiveRevealingOwnCard) {
      const delayMs = (room.revealDelaySeconds || 15) * 1000;
      const elapsed = Date.now() - (room.pending.placedAt || 0);
      if (elapsed < delayMs) {
        return socket.emit('error-msg', `Attends encore ${Math.ceil((delayMs - elapsed) / 1000)}s avant de pouvoir révéler — ça laisse une chance de défier.`);
      }
    }
    resolveReveal(room);
  }));

  socket.on('play-again', withRoom((room) => {
    clearAutoReveal(room.code);
    room.phase = 'lobby';
    room.players = room.players.map(p => ({ ...p, tokens: START_TOKENS, timeline: [] }));
    room.deck = []; room.discard = []; room.pending = null; room.lastResult = null;
    room.missedCards = [];
    room.turnOrder = []; room.turnIndex = 0;
    room.log.push({ ts: nowStr(), text: 'Nouvelle partie dans ce salon !' });
  }));

  socket.on('set-dj', withRoom((room, { playerId: targetId }) => {
    if (!isHost(room, socket.data.playerId)) return socket.emit('error-msg', 'Seul l\'hôte du salon peut changer le DJ.');
    const p = room.players.find(pl => pl.id === targetId);
    if (!p || p.isBot) return;
    room.djId = targetId;
    room.log.push({ ts: nowStr(), text: `🎚️ ${p.name} est maintenant le DJ.` });
  }));

  socket.on('add-bot', withRoom((room) => {
    if (room.players.some(p => p.isBot)) return;
    const bot = { id: 'bot-' + genId(), name: 'Bot 🤖', tokens: START_TOKENS, timeline: [], isBot: true };
    room.players.push(bot);
    room.log.push({ ts: nowStr(), text: 'Bot de test ajouté — tu peux lancer une partie en solo.' });
  }));

  socket.on('remove-bot', withRoom((room) => {
    room.players = room.players.filter(p => !p.isBot);
    room.log.push({ ts: nowStr(), text: 'Bot de test retiré.' });
  }));

  socket.on('bot-play', withRoom(async (room) => {
    await botPlayTurn(room);
  }));

  socket.on('disconnect', () => {
    // Players stay in the room; they can rejoin with the same name from any device.
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chronolozik v${APP_VERSION} — server running:`);
  console.log(`  - sur cet appareil : http://localhost:${PORT}`);
  console.log(`  - depuis le même Wi-Fi : http://<IP de ce téléphone>:${PORT}`);
  verifyAndPrepareCatalog();
});
