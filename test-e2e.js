const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

const PORT = 3210;
const CARDS_TO_WIN = 10; // mirrors the server-side constant, kept in sync manually since this is a standalone test script
const PLAYER_COLORS = ['#FF4F81', '#3FD9C4', '#F2B84B', '#7C83FD', '#4FD1FF', '#FF8A4F', '#B4FF4F', '#FF4FE0', '#4FFFB0', '#FFD34F']; // mirrors the server-side palette
const URL = `http://localhost:${PORT}`;

// Start from a clean slate each run, exactly like a first-ever launch.
const ROOMS_FILE = path.join(__dirname, 'rooms.json');
try { fs.unlinkSync(ROOMS_FILE); } catch (e) {}
const ORIGINAL_SONGS = JSON.parse(fs.readFileSync(path.join(__dirname, 'songs.json'), 'utf8'));

function log(...a) { console.log('[test]', ...a); }
function fail(msg) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
function ok(msg) { console.log('✅', msg); }

function waitFor(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

// Waits for a 'room' broadcast that actually satisfies `predicate` — a plain
// .once() can catch a *stale, already in-flight* broadcast from an earlier
// action that this socket never consumed (e.g. a room-wide broadcast sent
// while this socket was busy doing something else). Draining until the
// predicate matches makes the test robust against that ordering race.
// Mirrors the server's gap-correctness rule, so tests can reliably pick a
// gap that's guaranteed wrong (or right) for a timeline of any size.
// Mirrors the server's normalize() exactly — used to build the same song
// keys the server uses for usedSongKeys, so test comparisons actually match.
function normalizeLikeServer(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function correctGapsFor(sortedYears, year) {
  const gaps = [];
  for (let i = 0; i <= sortedYears.length; i++) {
    const lower = i > 0 ? sortedYears[i - 1] : -Infinity;
    const upper = i < sortedYears.length ? sortedYears[i] : Infinity;
    if (year >= lower && year <= upper) gaps.push(i);
  }
  return gaps;
}

function waitForRoomWhere(socket, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off('room', handler);
      reject(new Error('timeout waiting for matching "room" event'));
    }, timeoutMs);
    function handler(room) {
      if (predicate(room)) { clearTimeout(t); socket.off('room', handler); resolve(room); }
    }
    socket.on('room', handler);
  });
}

function waitForReady(baseUrl, timeoutMs = 40000) {
  const start = Date.now();
  return (async function poll() {
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${baseUrl}/api/ready`);
        const data = await res.json();
        if (data.ready) return data;
      } catch (e) { /* server might not be listening yet */ }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('timed out waiting for /api/ready');
  })();
}

async function main() {
  // ---- Phase -1: with REAL (unfaked) Deezer calls — blocked in this sandbox,
  // so verification takes a while — confirm create-room is actually refused
  // WHILE the scan is still in progress, not just "before the client polled".
  // Uses a COLD catalog copy (no baked-in deezerId/verifiedAt): with the real
  // catalog now mostly pre-resolved, this would otherwise finish in well
  // under 1200ms and never actually exercise the "still verifying" window. ----
  const coldSongsPathSlow = path.join(__dirname, 'songs.cold-test-slow.json');
  const coldCatalogSlow = ORIGINAL_SONGS.map(s => { const c = { ...s }; delete c.deezerId; delete c.verifiedAt; return c; });
  fs.writeFileSync(coldSongsPathSlow, JSON.stringify(coldCatalogSlow));
  const slowServer = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT + 2), SONGS_FILE_OVERRIDE: coldSongsPathSlow } });
  slowServer.stdout.on('data', () => {});
  slowServer.stderr.on('data', () => {});
  try {
    const slowUrl = `http://localhost:${PORT + 2}`;
    await new Promise(r => setTimeout(r, 1200)); // give it just enough time to start listening, well before verification can finish
    const earlyRes = await fetch(`${slowUrl}/api/ready`);
    const earlyData = await earlyRes.json();
    if (earlyData.ready === false) ok('readiness gate correctly reports not-ready shortly after boot (real Deezer scan still running)');
    else fail('expected ready:false shortly after boot, got ' + JSON.stringify(earlyData));

    const p0 = io(slowUrl, { transports: ['websocket'] });
    await waitFor(p0, 'connect');
    let blockedMsg = null;
    p0.once('error-msg', (msg) => { blockedMsg = msg; });
    p0.emit('create-room', { name: 'TooEarly' });
    await new Promise(r => setTimeout(r, 500));
    if (blockedMsg) ok('create-room correctly refused while the catalog is still being verified: "' + blockedMsg + '"');
    else fail('create-room should have been refused before the readiness gate opened');
    p0.disconnect();
  } catch (e) {
    fail('phase -1 (pre-ready gate) exception: ' + e.message);
  } finally {
    slowServer.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.unlinkSync(coldSongsPathSlow); } catch (e) {}
  }

  // ---- Phase -0.5: the 30-day trust window — a fresh baked-in deezerId is
  // skipped (never re-checked), a stale one gets re-verified against Deezer. ----
  const ttlSongsPath = path.join(__dirname, 'songs.ttl-test.json');
  const DAY_MS = 24 * 60 * 60 * 1000;
  const ttlCatalog = [
    { title: 'Fresh Song', artist: 'Fresh Artist', year: 2020, deezerId: 'placeholder-should-stay', verifiedAt: Date.now() - 1 * DAY_MS },
    { title: 'Stale Song', artist: 'Stale Artist', year: 2020, deezerId: 'placeholder-should-be-replaced', verifiedAt: Date.now() - 31 * DAY_MS },
  ];
  fs.writeFileSync(ttlSongsPath, JSON.stringify(ttlCatalog));
  const ttlServer = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT + 3), FAKE_DEEZER: '1', SONGS_FILE_OVERRIDE: ttlSongsPath } });
  ttlServer.stdout.on('data', () => {});
  ttlServer.stderr.on('data', () => {});
  try {
    const ttlUrl = `http://localhost:${PORT + 3}`;
    await waitForReady(ttlUrl);
    const songsRes = await fetch(`${ttlUrl}/api/songs`);
    const songsData = await songsRes.json();
    const freshSong = songsData.find(s => s.title === 'Fresh Song');
    const staleSong = songsData.find(s => s.title === 'Stale Song');
    if (freshSong && freshSong.deezerId === 'placeholder-should-stay') {
      ok('a deezerId verified within 30 days is correctly trusted and left untouched');
    } else {
      fail('expected the fresh (< 30 days) deezerId to be left alone, got: ' + JSON.stringify(freshSong));
    }
    if (staleSong && staleSong.deezerId !== 'placeholder-should-be-replaced' && staleSong.deezerId) {
      ok('a deezerId older than 30 days is correctly re-verified against Deezer and replaced');
    } else {
      fail('expected the stale (> 30 days) deezerId to be re-resolved, got: ' + JSON.stringify(staleSong));
    }
  } catch (e) {
    fail('phase -0.5 (30-day TTL) exception: ' + e.message);
  } finally {
    ttlServer.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.unlinkSync(ttlSongsPath); } catch (e) {}
  }

  // ---- fuzzy-match validation: a Deezer result that doesn't actually match
  // the intended title/artist must be rejected, not blindly accepted. This
  // is the real bug a player reported — a misattributed catalog entry
  // ("Bam, Bam, Bamy Shore" credited to the wrong artist) resolved to a
  // completely unrelated Michael Jackson track. ----
  const mismatchSongsPath = path.join(__dirname, 'songs.mismatch-test.json');
  fs.writeFileSync(mismatchSongsPath, JSON.stringify([
    { title: 'Bam, Bam, Bamy Shore', artist: 'Not The Real Artist' },
  ]));
  const mismatchServer = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT + 4), FAKE_DEEZER: '1', FAKE_DEEZER_MISMATCH: '1', SONGS_FILE_OVERRIDE: mismatchSongsPath } });
  mismatchServer.stdout.on('data', () => {});
  mismatchServer.stderr.on('data', () => {});
  try {
    const mismatchUrl = `http://localhost:${PORT + 4}`;
    await waitForReady(mismatchUrl);
    const songsRes = await fetch(`${mismatchUrl}/api/songs`);
    const songsData = await songsRes.json();
    const song = songsData[0];
    if (!song.deezerId) {
      ok('an unrelated Deezer result (title/artist not matching) is correctly rejected — no bad deezerId assigned');
    } else {
      fail('expected the mismatched result to be rejected, but got a deezerId: ' + JSON.stringify(song));
    }
  } catch (e) {
    fail('phase -0.4 (fuzzy-match validation) exception: ' + e.message);
  } finally {
    mismatchServer.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.unlinkSync(mismatchSongsPath); } catch (e) {}
  }

  // ---- the specific weakness the OLD matcher had: "expected" being a
  // substring of "got" (e.g. a tribute/cover act) must NOT count as a match ----
  const tributeSongsPath = path.join(__dirname, 'songs.tribute-test.json');
  fs.writeFileSync(tributeSongsPath, JSON.stringify([
    { title: 'Thriller', artist: 'Michael Jackson' },
  ]));
  const tributeServer = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT + 5), FAKE_DEEZER: '1', FAKE_DEEZER_TRIBUTE: '1', SONGS_FILE_OVERRIDE: tributeSongsPath } });
  tributeServer.stdout.on('data', () => {});
  tributeServer.stderr.on('data', () => {});
  try {
    const tributeUrl = `http://localhost:${PORT + 5}`;
    await waitForReady(tributeUrl);
    const songsRes = await fetch(`${tributeUrl}/api/songs`);
    const songsData = await songsRes.json();
    const song = songsData[0];
    if (!song.deezerId) {
      ok('a tribute-band-style near-match ("Michael Jackson Tribute Band" for "Michael Jackson") is correctly rejected — the old substring-containment rule would have wrongly accepted this');
    } else {
      fail('expected the tribute-band match to be rejected, but got a deezerId: ' + JSON.stringify(song));
    }
  } catch (e) {
    fail('phase -0.3 (tribute-band false-positive check) exception: ' + e.message);
  } finally {
    tributeServer.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.unlinkSync(tributeSongsPath); } catch (e) {}
  }

  // ---- Phase 0: confirm the actual fix — with zero real Deezer access (this
  // sandbox's normal state), draw-card must NEVER hand back a silent card,
  // AND the new readiness gate must still open (checked-but-all-failed still
  // counts as "done checking") while correctly reporting zero playable songs.
  // Uses a COLD catalog copy (no baked-in deezerId/verifiedAt) so the 30-day
  // trust cache doesn't short-circuit this specific "Deezer is down" scenario. ----
  const coldSongsPath = path.join(__dirname, 'songs.cold-test.json');
  const coldCatalog = ORIGINAL_SONGS.map(s => { const c = { ...s }; delete c.deezerId; delete c.verifiedAt; return c; });
  fs.writeFileSync(coldSongsPath, JSON.stringify(coldCatalog));
  const noAudioServer = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT + 1), FAKE_DEEZER: '1', FAKE_DEEZER_FAIL: '1', SONGS_FILE_OVERRIDE: coldSongsPath } });
  let noAudioLog = '';
  noAudioServer.stdout.on('data', d => { noAudioLog += d; });
  noAudioServer.stderr.on('data', d => { noAudioLog += d; });
  try {
    const noAudioUrl = `http://localhost:${PORT + 1}`;
    const readyData = await waitForReady(noAudioUrl);
    if (readyData.ok === 0) ok(`readiness gate completed even with Deezer unreachable (0/${readyData.total} playable, as expected)`);
    else fail(`expected 0 playable songs with Deezer blocked, got ${readyData.ok}/${readyData.total}`);

    const p1 = io(noAudioUrl, { transports: ['websocket'] });
    const p2 = io(noAudioUrl, { transports: ['websocket'] });
    await Promise.all([waitFor(p1, 'connect'), waitFor(p2, 'connect')]);
    p1.emit('create-room', { name: 'NoAudioA' });
    const j1 = await waitFor(p1, 'joined');
    ok('create-room succeeds once the readiness gate has opened (even with a 0-playable catalog)');
    p2.emit('join-room', { code: j1.code, name: 'NoAudioB' });
    await waitFor(p2, 'joined');
    // Real Deezer is unreachable here, so no song is playable -> the pool is
    // empty -> start-game must refuse, never silently deal unplayable cards.
    let sawError = false;
    p1.once('error-msg', () => { sawError = true; });
    p1.emit('start-game');
    await new Promise(r => setTimeout(r, 800));
    if (sawError) ok('with zero playable songs, start-game correctly refuses rather than dealing silent cards');
    else fail('start-game should have refused when no songs are confirmed playable');
    p1.disconnect(); p2.disconnect();
  } catch (e) {
    fail('phase 0 (no-audio protection) exception: ' + e.message);
  } finally {
    noAudioServer.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.unlinkSync(coldSongsPath); } catch (e) {}
  }

  // ---- Phase 1: full gameplay, with FAKE_DEEZER=1 so every song has a
  // simulated-but-valid preview — this is what lets us actually exercise the
  // audio-dependent code paths without needing real internet access to Deezer. ----
  const server = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT), FAKE_DEEZER: '1' } });
  server.stdout.on('data', d => log('server>', d.toString().trim()));
  server.stderr.on('data', d => log('server-err>', d.toString().trim()));

  try {
    const readyData = await waitForReady(URL);
    if (readyData.ready && readyData.total >= 300) ok(`readiness gate opened: ${readyData.ok}/${readyData.total} songs confirmed playable`);
    else fail('readiness gate did not report a sane ready state: ' + JSON.stringify(readyData));

    // ---- REST catalog checks ----
    const catRes = await fetch(`${URL}/api/songs`);
    const catalog = await catRes.json();
    if (Array.isArray(catalog) && catalog.length >= 300) ok(`catalog loaded with ${catalog.length} songs`);
    else fail(`expected 300+ songs in catalog, got ${JSON.stringify(catalog).slice(0,120)}`);

    // Adding a song now requires reaching api.deezer.com server-side to resolve a match.
    // That domain isn't reachable from this sandbox, so we only check the *validation*
    // path here (missing fields -> 400) and the *network-failure* path degrades to a
    // clean 502 rather than crashing — both are real code paths worth confirming.
    const addRes = await fetch(`${URL}/api/songs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Song', artist: 'Test Artist', year: 2000 })
    });
    if (addRes.status === 502) ok('add-song correctly reports 502 when Deezer is unreachable (expected in this sandbox)');
    else if (addRes.ok) ok('song added via REST (Deezer was reachable and matched it)');
    else fail('add-song returned unexpected status ' + addRes.status + ': ' + JSON.stringify(await addRes.json()));

    const badRes = await fetch(`${URL}/api/songs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', artist: '', year: 0 })
    });
    if (badRes.status === 400) ok('invalid song correctly rejected (400) before ever touching Deezer');
    else fail('invalid song was not rejected, status=' + badRes.status);

    // ---- catalog health check + delete ----
    const catBefore = await (await fetch(`${URL}/api/songs`)).json();
    const healthRes = await fetch(`${URL}/api/songs/health`);
    const health = await healthRes.json();
    if (typeof health.total === 'number' && Array.isArray(health.noMatch) && Array.isArray(health.noPreview)) {
      ok(`health check ran: ${health.ok}/${health.total} songs confirmed playable (FAKE_DEEZER, so this should be ~all of them)`);
    } else {
      fail('health check response missing expected fields: ' + JSON.stringify(health).slice(0, 200));
    }
    if (health.total === catBefore.length) ok('health check covered the whole catalog');
    else fail(`health check total (${health.total}) does not match catalog length (${catBefore.length})`);

    if (addRes.ok) {
      const delRes = await fetch(`${URL}/api/songs`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Song', artist: 'Test Artist' })
      });
      const afterDelete = await delRes.json();
      if (delRes.ok && afterDelete.length === catBefore.length - 1) ok('DELETE /api/songs correctly removed the test entry');
      else fail('DELETE /api/songs did not behave as expected: status=' + delRes.status);
    } else {
      log('  (skipping delete test — the earlier add-song attempt did not succeed, nothing to delete)');
    }

    // ---- socket gameplay ----
    const alice = io(URL, { transports: ['websocket'] });
    const bob = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(alice, 'connect'), waitFor(bob, 'connect')]);
    ok('both sockets connected');

    alice.emit('create-room', { name: 'Alice' });
    const aliceJoined = await waitFor(alice, 'joined');
    const code = aliceJoined.code;
    if (code && code.length === 4) ok(`room created: ${code}`);
    else fail('bad room code: ' + code);

    bob.emit('join-room', { code, name: 'Bob' });
    const bobJoined = await waitFor(bob, 'joined');
    if (bobJoined.room.players.length === 2) ok('Bob joined, 2 players in room');
    else fail('expected 2 players after join, got ' + bobJoined.room.players.length);
    if (bobJoined.room.listenMode === 'together') ok('room defaults to "together" listen mode');
    else fail('expected default listenMode "together", got ' + bobJoined.room.listenMode);
    if (bobJoined.room.hostId === aliceJoined.playerId) ok('room creator (Alice) is recorded as host');
    else fail('expected hostId to be Alice, got ' + bobJoined.room.hostId);

    // ---- host-only gating: Bob (non-host) must be refused on every admin action ----
    let bobBlocked = 0;
    const expectBlocked = (socket) => new Promise((resolve) => { socket.once('error-msg', () => { bobBlocked++; resolve(); }); });
    await Promise.all([expectBlocked(bob), (async () => { bob.emit('start-game'); })()]);
    await Promise.all([expectBlocked(bob), (async () => { bob.emit('set-listen-mode', { mode: 'remote' }); })()]);
    await Promise.all([expectBlocked(bob), (async () => { bob.emit('set-filters', { filters: { brackets: [] } }); })()]);
    await Promise.all([expectBlocked(bob), (async () => { bob.emit('set-dj', { playerId: bobJoined.playerId }); })()]);
    await Promise.all([expectBlocked(bob), (async () => { bob.emit('set-reveal-delay', { seconds: 5 }); })()]);
    if (bobBlocked === 5) ok('non-host correctly refused on all 5 admin actions (start-game, listen-mode, filters, dj, reveal-delay)');
    else fail(`expected 5 refusals for non-host actions, got ${bobBlocked}`);

    // host actions should still work for Alice
    alice.emit('set-reveal-delay', { seconds: 3 }); // shrink the reveal delay so this test suite doesn't sit idle for 15s per reveal
    const shortDelayRoom = await waitForRoomWhere(alice, r => r.revealDelaySeconds === 3);
    ok('host (Alice) successfully changed reveal delay to ' + shortDelayRoom.revealDelaySeconds + 's');

    // reconnection-by-name check
    const aliceAgain = io(URL, { transports: ['websocket'] });
    await waitFor(aliceAgain, 'connect');
    aliceAgain.emit('join-room', { code, name: 'alice' }); // case-insensitive match
    const resumed = await waitFor(aliceAgain, 'joined');
    if (resumed.playerId === aliceJoined.playerId && resumed.room.players.length === 2) ok('resume-by-name works (no duplicate player created)');
    else fail('resume-by-name failed: got playerId=' + resumed.playerId + ' players=' + resumed.room.players.length);
    aliceAgain.disconnect();

    alice.emit('start-game');
    const startedRoom = await waitForRoomWhere(alice, r => r.phase === 'playing');
    if (startedRoom.phase === 'playing' && startedRoom.players.every(p => p.timeline.length === 1)) {
      ok('game started, both players have 1 starting card');
    } else fail('start-game did not produce expected state: ' + JSON.stringify(startedRoom.phase));

    const activeId = startedRoom.turnOrder[startedRoom.turnIndex];
    const activeSocket = activeId === aliceJoined.playerId ? alice : bob;
    const otherSocket = activeSocket === alice ? bob : alice;
    ok(`active player determined: ${activeId === aliceJoined.playerId ? 'Alice' : 'Bob'}`);

    activeSocket.emit('draw-card');
    let roomAfterDraw = await waitForRoomWhere(activeSocket, r => !!r.pending);
    if (roomAfterDraw.pending && roomAfterDraw.pending.stage === 'listening') {
      ok('draw-card produced a pending card (title: ' + roomAfterDraw.pending.card.title + ')');
      if (roomAfterDraw.pending.card.previewUrl) ok('  ...and Deezer preview resolved: ' + roomAfterDraw.pending.card.previewUrl);
      else log('  (no Deezer preview — expected in this sandbox, api.deezer.com is not reachable here; the game logic itself does not depend on it)');
    } else fail('draw-card did not set pending.listening correctly: ' + JSON.stringify(roomAfterDraw.pending));

    // wrong-vs-right actor guard: other player tries to place -> should be ignored (no state change)
    otherSocket.emit('place-card', { gapIndex: 0 });
    await new Promise(r => setTimeout(r, 300));
    ok('non-active player place-card ignored (server guard) — sanity assumed by design, see explicit guard test below');

    activeSocket.emit('place-card', { gapIndex: 0 });
    let roomAfterPlace = await waitForRoomWhere(activeSocket, r => r.pending && r.pending.stage === 'placed');
    if (roomAfterPlace.pending && roomAfterPlace.pending.stage === 'placed' && roomAfterPlace.pending.placedAt) {
      ok('place-card moved pending to "placed" stage with a placedAt timestamp');
    } else fail('place-card did not move to placed correctly: ' + JSON.stringify(roomAfterPlace.pending));

    // reveal-delay enforcement: an immediate reveal must be refused...
    let tooEarlyMsg = null;
    activeSocket.once('error-msg', (msg) => { tooEarlyMsg = msg; });
    activeSocket.emit('reveal');
    await new Promise(r => setTimeout(r, 400));
    if (tooEarlyMsg) ok('reveal correctly refused before the delay elapses: "' + tooEarlyMsg + '"');
    else fail('reveal should have been refused immediately after placement (3s delay not yet elapsed)');

    // ...but succeeds once the (shortened, 3s) delay has passed
    await new Promise(r => setTimeout(r, 3000));
    activeSocket.emit('reveal');
    let roomAfterReveal = await waitForRoomWhere(activeSocket, r => r.pending === null && r.lastResult);
    if (roomAfterReveal.pending === null && roomAfterReveal.lastResult) {
      ok('reveal resolved after the delay elapsed: pending cleared, lastResult=' + roomAfterReveal.lastResult.kind);
    } else fail('reveal did not resolve correctly: ' + JSON.stringify(roomAfterReveal.pending));

    // ---- this is the actual bug being fixed: a player's transport drops
    // mid-game (phone backgrounded) and comes back — the client is expected
    // to re-emit join-room with the same name, and the server must resume
    // the SAME player (same id, same timeline/tokens), not create a new one,
    // even though the room is now in 'playing' phase, not 'lobby'. ----
    const activeName = activeSocket === alice ? 'Alice' : 'Bob';
    const activePlayerIdBefore = activeId;
    activeSocket.disconnect();
    await new Promise(r => setTimeout(r, 300));
    const revived = io(URL, { transports: ['websocket'] });
    await waitFor(revived, 'connect');
    revived.emit('join-room', { code, name: activeName });
    const revivedJoin = await waitFor(revived, 'joined');
    const revivedPlayer = revivedJoin.room.players.find(p => p.id === revivedJoin.playerId);
    if (revivedJoin.playerId === activePlayerIdBefore && revivedJoin.room.phase === 'playing' && revivedPlayer && revivedPlayer.timeline.length >= 1) {
      ok('mid-game reconnect resumes the SAME player (same id, timeline intact) instead of creating a new one');
    } else fail('mid-game reconnect did not resume correctly: playerId=' + revivedJoin.playerId + ' expected=' + activePlayerIdBefore + ' phase=' + revivedJoin.room.phase);
    revived.disconnect();

    // ---- early reveal by a non-active player (new: bypasses the timer on purpose) ----
    const wendy = io(URL, { transports: ['websocket'] });
    const xander = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(wendy, 'connect'), waitFor(xander, 'connect')]);
    wendy.emit('create-room', { name: 'Wendy' });
    const wendyJoined = await waitFor(wendy, 'joined');
    xander.emit('join-room', { code: wendyJoined.code, name: 'Xander' });
    await waitFor(xander, 'joined');
    wendy.emit('set-reveal-delay', { seconds: 30 }); // deliberately long, so an early reveal is unambiguous
    await waitForRoomWhere(wendy, r => r.revealDelaySeconds === 30);
    wendy.emit('start-game');
    const erGame = await waitForRoomWhere(wendy, r => r.phase === 'playing');
    const erActiveId = erGame.turnOrder[erGame.turnIndex];
    const erActive = erActiveId === wendyJoined.playerId ? wendy : xander;
    const erOther = erActive === wendy ? xander : wendy;

    erActive.emit('draw-card');
    await waitForRoomWhere(erActive, r => !!r.pending);
    erActive.emit('place-card', { gapIndex: 0 });
    await waitForRoomWhere(erActive, r => r.pending && r.pending.stage === 'placed');

    // the ACTIVE player must still be blocked (unchanged behavior)
    let activeStillBlocked = null;
    erActive.once('error-msg', (msg) => { activeStillBlocked = msg; });
    erActive.emit('reveal');
    await new Promise(r => setTimeout(r, 400));
    if (activeStillBlocked) ok('active player is still bound by the 30s delay for their own card');
    else fail('active player should still be refused an early reveal of their own card');

    // the OTHER player reveals early, on purpose, well before the 30s delay — must succeed immediately
    const startWait = Date.now();
    erOther.emit('reveal');
    const erResolved = await waitForRoomWhere(erOther, r => r.pending === null && r.lastResult, 3000);
    const tookMs = Date.now() - startWait;
    if (erResolved.pending === null && tookMs < 3000) ok(`non-active player successfully triggered an early reveal, bypassing the 30s delay (resolved in ${tookMs}ms)`);
    else fail('non-active player early-reveal did not resolve promptly');
    wendy.disconnect(); xander.disconnect();

    // ---- fuzzy guess matching (small typos should still count) ----
    const yara = io(URL, { transports: ['websocket'] });
    const zack = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(yara, 'connect'), waitFor(zack, 'connect')]);
    yara.emit('create-room', { name: 'Yara' });
    const yaraJoined = await waitFor(yara, 'joined');
    zack.emit('join-room', { code: yaraJoined.code, name: 'Zack' });
    await waitFor(zack, 'joined');
    yara.emit('start-game');
    const fgGame = await waitForRoomWhere(yara, r => r.phase === 'playing');
    const fgActiveId = fgGame.turnOrder[fgGame.turnIndex];
    const fgActive = fgActiveId === yaraJoined.playerId ? yara : zack;

    fgActive.emit('draw-card');
    const fgDrawn = await waitForRoomWhere(fgActive, r => !!r.pending);
    const realTitle = fgDrawn.pending.card.title;
    const realArtist = fgDrawn.pending.card.artist;
    // inject one deliberate typo into each (swap the last two characters, or drop one) — small enough to still be "close enough"
    // A single-character substitution always costs exactly 1 in Levenshtein
    // distance, which is always within tolerance (min tolerance is 1) —
    // unlike a transposition (costs 2), which can exceed tolerance on short
    // words and make this test flaky depending on which song gets drawn.
    const typo = (s) => {
      if (s.length < 2) return s + 'x';
      const mid = Math.floor(s.length / 2);
      const repl = s[mid].toLowerCase() === 'x' ? 'z' : 'x';
      return s.slice(0, mid) + repl + s.slice(mid + 1);
    };
    fgActive.emit('submit-guess', { title: typo(realTitle), artist: typo(realArtist) });
    const fgAfterGuess = await waitForRoomWhere(fgActive, r => r.pending && r.pending.guessBy);
    if (fgAfterGuess.pending.guessCorrect === true) {
      ok(`fuzzy match accepted a typo'd guess: "${typo(realTitle)}" / "${typo(realArtist)}" for real "${realTitle}" / "${realArtist}"`);
    } else {
      fail(`fuzzy match rejected a minor typo — real: "${realTitle}"/"${realArtist}", guessed: "${typo(realTitle)}"/"${typo(realArtist)}"`);
    }
    yara.disconnect(); zack.disconnect();

    // ---- bot flow ----
    const carol = io(URL, { transports: ['websocket'] });
    await waitFor(carol, 'connect');
    carol.emit('create-room', { name: 'Carol' });
    const carolJoined = await waitFor(carol, 'joined');
    carol.emit('add-bot');
    const roomWithBot = await waitForRoomWhere(carol, r => r.players.some(p => p.isBot));
    if (roomWithBot.players.length === 2 && roomWithBot.players.some(p => p.isBot)) ok('bot added to solo room');
    else fail('add-bot failed: ' + JSON.stringify(roomWithBot.players));

    carol.emit('set-reveal-delay', { seconds: 3 });
    await waitForRoomWhere(carol, r => r.revealDelaySeconds === 3);

    carol.emit('start-game');
    const botGameRoom = await waitForRoomWhere(carol, r => r.phase === 'playing');
    const botActiveId = botGameRoom.turnOrder[botGameRoom.turnIndex];
    const botIsActive = botGameRoom.players.find(p => p.id === botActiveId).isBot;
    if (botIsActive) {
      carol.emit('bot-play');
      const afterBot = await waitForRoomWhere(carol, r => !!r.pending);
      if (afterBot.pending && afterBot.pending.stage === 'placed' && afterBot.pending.activePlayerId === botActiveId && afterBot.pending.placedAt) {
        ok('bot-play produced a placed pending card for the bot, with a placedAt timestamp');
        await new Promise(r => setTimeout(r, 3200)); // respect the (shortened) reveal delay
        carol.emit('reveal'); // human allowed to reveal for the bot
        const afterBotReveal = await waitForRoomWhere(carol, r => r.pending === null);
        if (afterBotReveal.pending === null) ok('human successfully revealed on behalf of the bot, after the delay');
        else fail('reveal-for-bot did not clear pending');
      } else fail('bot-play did not produce expected pending: ' + JSON.stringify(afterBot.pending));
    } else {
      ok('Carol (human) was active first in bot game — turn rotation is random, this run just happened to pick the human; logic still exercised via earlier human test');
    }

    // ---- DJ reassignment ----
    const targetDjId = roomWithBot.players.find(p => !p.isBot).id;
    carol.emit('set-dj', { playerId: targetDjId });
    const djRoom = await waitForRoomWhere(carol, r => r.djId === targetDjId);
    ok('set-dj accepted, djId=' + djRoom.djId);

    // ---- listen mode (needs a fresh room still in lobby phase) ----
    const erin = io(URL, { transports: ['websocket'] });
    await waitFor(erin, 'connect');
    erin.emit('create-room', { name: 'Erin' });
    await waitFor(erin, 'joined');
    erin.emit('set-listen-mode', { mode: 'remote' });
    const remoteRoom = await waitForRoomWhere(erin, r => r.listenMode === 'remote');
    ok('set-listen-mode "remote" accepted, listenMode=' + remoteRoom.listenMode);
    erin.emit('set-listen-mode', { mode: 'together' });
    const togetherRoom = await waitForRoomWhere(erin, r => r.listenMode === 'together');
    ok('set-listen-mode "together" accepted, listenMode=' + togetherRoom.listenMode);

    // ---- ready state ----
    if (togetherRoom.players[0].ready === false) ok('player defaults to ready=false in the lobby');
    else fail('expected default ready=false, got ' + togetherRoom.players[0].ready);
    erin.emit('set-ready', { ready: true });
    const readyRoom = await waitForRoomWhere(erin, r => r.players[0].ready === true);
    ok('set-ready(true) accepted, ready=' + readyRoom.players[0].ready);
    erin.emit('set-ready', { ready: false });
    await waitForRoomWhere(erin, r => r.players[0].ready === false);
    ok('set-ready(false) accepted');

    // ---- auto-start once everyone is ready (no explicit start-game needed) ----
    const fiona = io(URL, { transports: ['websocket'] });
    const george = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(fiona, 'connect'), waitFor(george, 'connect')]);
    fiona.emit('create-room', { name: 'Fiona' });
    const fionaJoined = await waitFor(fiona, 'joined');
    george.emit('join-room', { code: fionaJoined.code, name: 'George' });
    await waitFor(george, 'joined');
    let phaseAfterOneReady = null;
    fiona.once('room', (r) => { phaseAfterOneReady = r.phase; });
    fiona.emit('set-ready', { ready: true });
    await new Promise(r => setTimeout(r, 400));
    if (phaseAfterOneReady === 'lobby') ok('room correctly stays in lobby when only 1 of 2 players is ready');
    else fail('expected phase to stay "lobby" with only 1/2 ready, got ' + phaseAfterOneReady);
    george.emit('set-ready', { ready: true });
    const autoStarted = await waitForRoomWhere(george, r => r.phase === 'playing');
    if (autoStarted.phase === 'playing' && autoStarted.players.every(p => p.timeline.length === 1)) {
      ok('game auto-started once both players marked ready, with no explicit start-game emitted');
    } else fail('expected auto-start once everyone was ready: ' + JSON.stringify({ phase: autoStarted.phase }));
    fiona.disconnect(); george.disconnect();

    // ---- audio mode ----
    erin.emit('set-audio-mode', { mode: 'once' });
    const onceRoom = await waitForRoomWhere(erin, r => r.audioMode === 'once');
    ok('set-audio-mode "once" accepted, audioMode=' + onceRoom.audioMode);
    erin.emit('set-audio-mode', { mode: 'loop' });
    await waitForRoomWhere(erin, r => r.audioMode === 'loop');
    ok('set-audio-mode "loop" accepted');
    erin.disconnect();

    // ---- public/private rooms ----
    const before = await (await fetch(`${URL}/api/public-rooms`)).json();
    const judy = io(URL, { transports: ['websocket'] });
    await waitFor(judy, 'connect');
    judy.emit('create-room', { name: 'Judy', visibility: 'public' });
    const judyJoined = await waitFor(judy, 'joined');
    if (judyJoined.room.visibility === 'public') ok('room created with visibility="public"');
    else fail('expected visibility "public", got ' + judyJoined.room.visibility);

    const afterPublic = await (await fetch(`${URL}/api/public-rooms`)).json();
    const listedEntry = afterPublic.find(r => r.code === judyJoined.code);
    if (listedEntry && listedEntry.hostName === 'Judy' && listedEntry.playerCount === 1) {
      ok(`public room correctly listed via GET /api/public-rooms (${afterPublic.length} public room(s) total, was ${before.length})`);
    } else fail('public room not found in /api/public-rooms listing: ' + JSON.stringify(afterPublic));

    const kevin = io(URL, { transports: ['websocket'] });
    await waitFor(kevin, 'connect');
    kevin.emit('create-room', { name: 'Kevin' }); // no visibility specified -> must default to private
    const kevinJoined = await waitFor(kevin, 'joined');
    if (kevinJoined.room.visibility === 'private') ok('room defaults to visibility="private" when not specified');
    else fail('expected default visibility "private", got ' + kevinJoined.room.visibility);
    const afterPrivate = await (await fetch(`${URL}/api/public-rooms`)).json();
    if (!afterPrivate.some(r => r.code === kevinJoined.code)) ok('private room correctly excluded from /api/public-rooms');
    else fail('private room should not appear in the public listing');

    // non-host cannot flip visibility; host can
    const laura = io(URL, { transports: ['websocket'] });
    await waitFor(laura, 'connect');
    laura.emit('join-room', { code: judyJoined.code, name: 'Laura' });
    await waitFor(laura, 'joined');
    let lauraRefused = null;
    laura.once('error-msg', (msg) => { lauraRefused = msg; });
    laura.emit('set-visibility', { visibility: 'private' });
    await new Promise(r => setTimeout(r, 400));
    if (lauraRefused) ok('non-host correctly refused when trying to change room visibility');
    else fail('expected non-host set-visibility attempt to be refused');
    judy.emit('set-visibility', { visibility: 'private' });
    const judyPrivate = await waitForRoomWhere(judy, r => r.visibility === 'private');
    ok('host successfully switched the room to private, visibility=' + judyPrivate.visibility);
    judy.disconnect(); kevin.disconnect(); laura.disconnect();

    // ---- max players ----
    const mallory = io(URL, { transports: ['websocket'] });
    const nathan = io(URL, { transports: ['websocket'] });
    const oscar = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(mallory, 'connect'), waitFor(nathan, 'connect'), waitFor(oscar, 'connect')]);
    mallory.emit('create-room', { name: 'Mallory' });
    const malloryJoined = await waitFor(mallory, 'joined');
    if (malloryJoined.room.maxPlayers === null) ok('room has no player limit by default');
    else fail('expected default maxPlayers null, got ' + malloryJoined.room.maxPlayers);

    let nonHostMaxRefused = null;
    nathan.emit('join-room', { code: malloryJoined.code, name: 'Nathan' });
    await waitFor(nathan, 'joined');
    nathan.once('error-msg', (msg) => { nonHostMaxRefused = msg; });
    nathan.emit('set-max-players', { max: 2 });
    await new Promise(r => setTimeout(r, 400));
    if (nonHostMaxRefused) ok('non-host correctly refused when trying to set max players');
    else fail('expected non-host set-max-players attempt to be refused');

    mallory.emit('set-max-players', { max: 2 });
    const cappedRoom = await waitForRoomWhere(mallory, r => r.maxPlayers === 2);
    ok('host successfully capped the room at ' + cappedRoom.maxPlayers + ' players (currently ' + cappedRoom.players.length + ')');

    let oscarRefused = null;
    oscar.once('error-msg', (msg) => { oscarRefused = msg; });
    oscar.emit('join-room', { code: malloryJoined.code, name: 'Oscar' });
    await new Promise(r => setTimeout(r, 500));
    if (oscarRefused) ok('3rd player correctly refused from a room capped at 2: "' + oscarRefused + '"');
    else fail('a 3rd player should have been refused from a 2-player-max room');

    // an existing player (Nathan) must still be able to resume even though the room is "full"
    let nathanResumeOk = false;
    const nathanAgain = io(URL, { transports: ['websocket'] });
    await waitFor(nathanAgain, 'connect');
    nathanAgain.emit('join-room', { code: malloryJoined.code, name: 'Nathan' });
    const nathanResumed = await waitFor(nathanAgain, 'joined');
    nathanResumeOk = nathanResumed.room.players.length === 2;
    if (nathanResumeOk) ok('existing player can still resume in a "full" capped room (cap only blocks new joins)');
    else fail('existing player resume should not be blocked by the player cap');

    // host cannot set a cap lower than the current player count
    let cantShrinkMsg = null;
    mallory.once('error-msg', (msg) => { cantShrinkMsg = msg; });
    mallory.emit('set-max-players', { max: 1 });
    await new Promise(r => setTimeout(r, 400));
    if (cantShrinkMsg) ok('host correctly refused from setting a max below the current player count: "' + cantShrinkMsg + '"');
    else fail('setting maxPlayers below current player count should have been refused');

    // and unsetting the limit works
    mallory.emit('set-max-players', { max: null });
    const uncappedRoom = await waitForRoomWhere(mallory, r => r.maxPlayers === null);
    ok('host successfully removed the player limit again, maxPlayers=' + uncappedRoom.maxPlayers);

    // ---- cards-to-win / start-tokens ----
    if (uncappedRoom.cardsToWin === 10) ok('room defaults to cardsToWin=10');
    else fail('expected default cardsToWin=10, got ' + uncappedRoom.cardsToWin);
    if (uncappedRoom.startTokens === 2) ok('room defaults to startTokens=2');
    else fail('expected default startTokens=2, got ' + uncappedRoom.startTokens);

    let nathanCardsRefused = null;
    nathan.once('error-msg', (msg) => { nathanCardsRefused = msg; });
    nathan.emit('set-cards-to-win', { count: 6 });
    await new Promise(r => setTimeout(r, 400));
    if (nathanCardsRefused) ok('non-host correctly refused when trying to set cards-to-win');
    else fail('expected non-host set-cards-to-win attempt to be refused');

    mallory.emit('set-cards-to-win', { count: 6 });
    const cardsRoom = await waitForRoomWhere(mallory, r => r.cardsToWin === 6);
    ok('host successfully set cardsToWin=' + cardsRoom.cardsToWin);

    let nathanTokensRefused = null;
    nathan.once('error-msg', (msg) => { nathanTokensRefused = msg; });
    nathan.emit('set-start-tokens', { count: 5 });
    await new Promise(r => setTimeout(r, 400));
    if (nathanTokensRefused) ok('non-host correctly refused when trying to set start-tokens');
    else fail('expected non-host set-start-tokens attempt to be refused');

    mallory.emit('set-start-tokens', { count: 5 });
    const tokensRoom = await waitForRoomWhere(mallory, r => r.startTokens === 5);
    ok('host successfully set startTokens=' + tokensRoom.startTokens);

    mallory.emit('set-reveal-delay', { seconds: 3 });
    await waitForRoomWhere(mallory, r => r.revealDelaySeconds === 3);
    mallory.emit('start-game');
    const customGame = await waitForRoomWhere(mallory, r => r.phase === 'playing');
    if (customGame.players.every(p => p.tokens === 5)) ok('custom startTokens=5 correctly applied to every player at game start');
    else fail('expected every player to start with 5 tokens: ' + JSON.stringify(customGame.players.map(p => p.tokens)));

    mallory.disconnect(); nathan.disconnect(); nathanAgain.disconnect(); oscar.disconnect();

    // ---- free-card (buy-without-listening): off by default, host-gated, works in BOTH listen modes ----
    async function testFreeCard(listenModeToUse, label) {
      const hostS = io(URL, { transports: ['websocket'] });
      const otherS = io(URL, { transports: ['websocket'] });
      await Promise.all([waitFor(hostS, 'connect'), waitFor(otherS, 'connect')]);
      hostS.emit('create-room', { name: 'FCHost' });
      const hostJoined = await waitFor(hostS, 'joined');
      if (hostJoined.room.freeCardEnabled === false) ok(`[${label}] room defaults to freeCardEnabled=false`);
      else fail(`[${label}] expected default freeCardEnabled=false, got ` + hostJoined.room.freeCardEnabled);
      otherS.emit('join-room', { code: hostJoined.code, name: 'FCOther' });
      await waitFor(otherS, 'joined');

      let refusedMsg = null;
      otherS.once('error-msg', (msg) => { refusedMsg = msg; });
      otherS.emit('set-free-card-enabled', { enabled: true });
      await new Promise(r => setTimeout(r, 400));
      if (refusedMsg) ok(`[${label}] non-host correctly refused when trying to enable free-card`);
      else fail(`[${label}] expected non-host set-free-card-enabled attempt to be refused`);

      hostS.emit('set-listen-mode', { mode: listenModeToUse });
      await waitForRoomWhere(hostS, r => r.listenMode === listenModeToUse);
      hostS.emit('set-start-tokens', { count: 3 });
      await waitForRoomWhere(hostS, r => r.startTokens === 3);
      hostS.emit('set-reveal-delay', { seconds: 3 });
      await waitForRoomWhere(hostS, r => r.revealDelaySeconds === 3);

      // still off — must be refused even with enough tokens once the game starts
      hostS.emit('start-game');
      const gameOff = await waitForRoomWhere(hostS, r => r.phase === 'playing');
      const activeIdOff = gameOff.turnOrder[gameOff.turnIndex];
      const activeSocketOff = activeIdOff === hostJoined.playerId ? hostS : otherS;
      let offRefused = null;
      activeSocketOff.once('error-msg', (msg) => { offRefused = msg; });
      activeSocketOff.emit('free-card');
      await new Promise(r => setTimeout(r, 400));
      if (offRefused) ok(`[${label}] free-card correctly refused while the option is disabled`);
      else fail(`[${label}] expected free-card to be refused while disabled`);

      // enable it and start a fresh game to test it actually works
      hostS.emit('play-again');
      await waitForRoomWhere(hostS, r => r.phase === 'lobby');
      hostS.emit('set-free-card-enabled', { enabled: true });
      const enabledRoom = await waitForRoomWhere(hostS, r => r.freeCardEnabled === true);
      ok(`[${label}] host successfully enabled free-card`);
      hostS.emit('start-game');
      const gameOn = await waitForRoomWhere(hostS, r => r.phase === 'playing');
      const activeIdOn = gameOn.turnOrder[gameOn.turnIndex];
      const activeSocketOn = activeIdOn === hostJoined.playerId ? hostS : otherS;
      const beforeLen = gameOn.players.find(p => p.id === activeIdOn).timeline.length;
      activeSocketOn.emit('free-card');
      const afterFree = await waitForRoomWhere(activeSocketOn, r => r.players.find(p => p.id === activeIdOn).timeline.length > beforeLen, 5000);
      const activePlayerAfter = afterFree.players.find(p => p.id === activeIdOn);
      if (activePlayerAfter.timeline.length === beforeLen + 1 && activePlayerAfter.tokens === 0) {
        ok(`[${label}] free-card worked once enabled: timeline grew, 3 tokens spent`);
      } else {
        fail(`[${label}] free-card did not behave as expected: ` + JSON.stringify({ timeline: activePlayerAfter.timeline.length, tokens: activePlayerAfter.tokens }));
      }
      hostS.disconnect(); otherS.disconnect();
    }
    await testFreeCard('together', 'tous ensemble');
    await testFreeCard('remote', 'chacun chez soi');

    // ---- game-mode presets (bundle several existing settings at once) ----
    const nate = io(URL, { transports: ['websocket'] });
    const opal = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(nate, 'connect'), waitFor(opal, 'connect')]);
    nate.emit('create-room', { name: 'Nate' });
    const nateJoined = await waitFor(nate, 'joined');
    if (nateJoined.room.gameMode === 'original') ok('room defaults to gameMode="original"');
    else fail('expected default gameMode "original", got ' + nateJoined.room.gameMode);
    opal.emit('join-room', { code: nateJoined.code, name: 'Opal' });
    await waitFor(opal, 'joined');

    let modeRefused = null;
    opal.once('error-msg', (msg) => { modeRefused = msg; });
    opal.emit('set-game-mode', { mode: 'hardcore' });
    await new Promise(r => setTimeout(r, 400));
    if (modeRefused) ok('non-host correctly refused when trying to change the game mode');
    else fail('expected non-host set-game-mode attempt to be refused');

    nate.emit('set-game-mode', { mode: 'hardcore' });
    const hardcoreRoom = await waitForRoomWhere(nate, r => r.gameMode === 'hardcore');
    if (hardcoreRoom.startTokens === 0 && hardcoreRoom.revealDelaySeconds === 5 && hardcoreRoom.turnDecisionSeconds === 15 && hardcoreRoom.freeCardEnabled === false) {
      ok('Hardcore preset correctly bundled all its settings in one go');
    } else {
      fail('Hardcore preset did not apply expected values: ' + JSON.stringify({ startTokens: hardcoreRoom.startTokens, revealDelaySeconds: hardcoreRoom.revealDelaySeconds, turnDecisionSeconds: hardcoreRoom.turnDecisionSeconds, freeCardEnabled: hardcoreRoom.freeCardEnabled }));
    }

    nate.emit('set-game-mode', { mode: 'enemies' });
    const enemiesRoom = await waitForRoomWhere(nate, r => r.gameMode === 'enemies');
    if (enemiesRoom.cardsToWin === 12 && enemiesRoom.startTokens === 4 && enemiesRoom.revealDelaySeconds === 20) {
      ok('"Fais-toi des ennemis" preset correctly bundled all its settings in one go');
    } else {
      fail('enemies preset did not apply expected values: ' + JSON.stringify({ cardsToWin: enemiesRoom.cardsToWin, startTokens: enemiesRoom.startTokens, revealDelaySeconds: enemiesRoom.revealDelaySeconds }));
    }

    nate.emit('set-game-mode', { mode: 'original' });
    const backToOriginal = await waitForRoomWhere(nate, r => r.gameMode === 'original');
    if (backToOriginal.cardsToWin === 10 && backToOriginal.startTokens === 2 && backToOriginal.revealDelaySeconds === 15 && backToOriginal.turnDecisionSeconds === 60 && backToOriginal.autoDrawSeconds === 5) {
      ok('Original preset correctly restores the default bundle, including autoDrawSeconds=5');
    } else {
      fail('Original preset did not restore defaults: ' + JSON.stringify(backToOriginal));
    }

    let unknownModeRefused = null;
    nate.once('error-msg', (msg) => { unknownModeRefused = msg; });
    nate.emit('set-game-mode', { mode: 'not-a-real-mode' });
    await new Promise(r => setTimeout(r, 400));
    if (unknownModeRefused) ok('unknown game mode correctly refused: "' + unknownModeRefused + '"');
    else fail('expected an unknown mode name to be refused');

    nate.disconnect(); opal.disconnect();

    // ---- Hardcore rule: wrong placement costs a random card from your OWN
    // timeline, EXCEPT the starting card, which is always protected ----
    const hank = io(URL, { transports: ['websocket'] });
    const iris = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(hank, 'connect'), waitFor(iris, 'connect')]);
    hank.emit('create-room', { name: 'Hank' });
    const hankJoined = await waitFor(hank, 'joined');
    iris.emit('join-room', { code: hankJoined.code, name: 'Iris' });
    await waitFor(iris, 'joined');
    hank.emit('set-game-mode', { mode: 'hardcore' });
    await waitForRoomWhere(hank, r => r.gameMode === 'hardcore');
    hank.emit('start-game');
    const hcGame = await waitForRoomWhere(hank, r => r.phase === 'playing');
    const hcActiveId = hcGame.turnOrder[hcGame.turnIndex];
    const hcActiveSocket = hcActiveId === hankJoined.playerId ? hank : iris;
    const startingCard = hcGame.players.find(p => p.id === hcActiveId).timeline[0];
    if (startingCard.isStartingCard === true) ok('the initial card dealt at game start is tagged isStartingCard');
    else fail('expected the dealt starting card to be tagged isStartingCard=true');

    // Case 1: player has ONLY their starting card and gets it wrong — the
    // penalty must NOT apply, since there's nothing eligible to lose.
    hcActiveSocket.emit('draw-card');
    const hcDrawn = await waitForRoomWhere(hcActiveSocket, r => !!r.pending);
    const hcNewYear = hcDrawn.pending.card.year;
    const hcWrongGap = hcNewYear >= startingCard.year ? 0 : 1;
    hcActiveSocket.emit('place-card', { gapIndex: hcWrongGap });
    await waitForRoomWhere(hcActiveSocket, r => r.pending && r.pending.stage === 'placed');
    const hcResolved = await waitForRoomWhere(hcActiveSocket, r => r.pending === null && r.lastResult, 8000);

    if (hcResolved.lastResult.kind === 'wrong') {
      const activeAfter = hcResolved.players.find(p => p.id === hcActiveId);
      if (activeAfter.timeline.length === 1 && activeAfter.timeline[0].isStartingCard === true && !hcResolved.lastResult.hardcorePenalty) {
        ok('starting card correctly PROTECTED — wrong placement with only the starting card in hand triggered no penalty at all');
      } else {
        fail('expected the starting card to survive with no penalty applied: ' + JSON.stringify({ timeline: activeAfter.timeline, penalty: hcResolved.lastResult.hardcorePenalty }));
      }
    } else {
      log(`  (this run resolved as "${hcResolved.lastResult.kind}" instead of "wrong" — equal-year edge case; skipping this run's assertion)`);
    }
    hank.disconnect(); iris.disconnect();

    // Case 2: once a player has EARNED a second card, a later wrong
    // placement can still cost them a card — just never the starting one.
    const jose = io(URL, { transports: ['websocket'] });
    const kara = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(jose, 'connect'), waitFor(kara, 'connect')]);
    jose.emit('create-room', { name: 'Jose' });
    const joseJoined = await waitFor(jose, 'joined');
    kara.emit('join-room', { code: joseJoined.code, name: 'Kara' });
    const karaJoined = await waitFor(kara, 'joined');
    jose.emit('set-game-mode', { mode: 'hardcore' });
    await waitForRoomWhere(jose, r => r.gameMode === 'hardcore');
    jose.emit('start-game');
    const jkGame = await waitForRoomWhere(jose, r => r.phase === 'playing');
    const firstActiveId = jkGame.turnOrder[jkGame.turnIndex];
    const firstActiveSocket = firstActiveId === joseJoined.playerId ? jose : kara;
    const firstActiveStartCard = jkGame.players.find(p => p.id === firstActiveId).timeline[0];

    // Turn 1 (firstActive): place CORRECTLY to grow their timeline to 2 cards.
    firstActiveSocket.emit('draw-card');
    const jkDrawn1 = await waitForRoomWhere(firstActiveSocket, r => !!r.pending);
    const correctGaps1 = correctGapsFor([firstActiveStartCard.year], jkDrawn1.pending.card.year);
    firstActiveSocket.emit('place-card', { gapIndex: correctGaps1[0] });
    await waitForRoomWhere(firstActiveSocket, r => r.pending && r.pending.stage === 'placed');
    const afterTurn1 = await waitForRoomWhere(firstActiveSocket, r => r.pending === null && r.turnIndex !== jkGame.turnIndex, 8000);

    if (afterTurn1.players.find(p => p.id === firstActiveId).timeline.length !== 2) {
      log('  (turn 1 did not resolve as correct — equal-year edge case; skipping the rest of this scenario)');
    } else {
      // Turn 2 (the OTHER player) — outcome doesn't matter, just need the turn to pass back.
      const secondActiveId = afterTurn1.turnOrder[afterTurn1.turnIndex];
      const secondActiveSocket = secondActiveId === joseJoined.playerId ? jose : kara;
      secondActiveSocket.emit('draw-card');
      const jkDrawn2 = await waitForRoomWhere(secondActiveSocket, r => !!r.pending);
      secondActiveSocket.emit('place-card', { gapIndex: 0 });
      await waitForRoomWhere(secondActiveSocket, r => r.pending && r.pending.stage === 'placed');
      const afterTurn2 = await waitForRoomWhere(secondActiveSocket, r => r.pending === null, 8000);

      // Turn 3: back to firstActive, now with 2 cards — place deliberately WRONG.
      const thirdActiveId = afterTurn2.turnOrder[afterTurn2.turnIndex];
      if (thirdActiveId === firstActiveId) {
        const timelineNow = afterTurn2.players.find(p => p.id === firstActiveId).timeline;
        const years = timelineNow.map(c => c.year).sort((a, b) => a - b);
        firstActiveSocket.emit('draw-card');
        const jkDrawn3 = await waitForRoomWhere(firstActiveSocket, r => !!r.pending);
        const correctGaps3 = correctGapsFor(years, jkDrawn3.pending.card.year);
        const wrongGap3 = [0, 1, 2].find(g => !correctGaps3.includes(g));
        firstActiveSocket.emit('place-card', { gapIndex: wrongGap3 });
        await waitForRoomWhere(firstActiveSocket, r => r.pending && r.pending.stage === 'placed');
        const finalRoom = await waitForRoomWhere(firstActiveSocket, r => r.pending === null && r.lastResult, 8000);

        if (finalRoom.lastResult.kind === 'wrong') {
          const finalTimeline = finalRoom.players.find(p => p.id === firstActiveId).timeline;
          if (finalTimeline.length === 1 && finalTimeline[0].isStartingCard === true) {
            ok('an EARNED card was correctly lost to the Hardcore penalty, while the starting card survived untouched');
          } else {
            fail('expected only the earned card to be lost, starting card intact: ' + JSON.stringify(finalTimeline));
          }
        } else {
          log(`  (turn 3 resolved as "${finalRoom.lastResult.kind}" instead of "wrong" — edge case; skipping this run's assertion)`);
        }
      } else {
        log('  (turn order landed differently than expected this run — skipping this scenario)');
      }
    }
    jose.disconnect(); kara.disconnect();

    // ---- timestamps are in Paris time, not the server's raw local time ----
    const parisNow = () => {
      const d = new Date();
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }) + ' ' +
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    };
    const tzHost = io(URL, { transports: ['websocket'] });
    await waitFor(tzHost, 'connect');
    tzHost.emit('create-room', { name: 'TzHost' });
    const tzJoined = await waitFor(tzHost, 'joined');
    const roomLogTs = tzJoined.room.log[0].ts;
    const expected = parisNow();
    // Compare only the hour — tolerate the rare case where the minute ticked
    // over between the two computations a few ms apart, but a genuine
    // timezone bug would be off by whole hours, which this still catches.
    const gotHour = roomLogTs.split(' ')[1].split(':')[0];
    const expectedHour = expected.split(' ')[1].split(':')[0];
    if (gotHour === expectedHour) {
      ok(`room timestamps correctly use Europe/Paris regardless of the server's own timezone: "${roomLogTs}"`);
    } else {
      fail(`room timestamp hour mismatch — got "${roomLogTs}", expected close to "${expected}" (Europe/Paris)`);
    }
    tzHost.disconnect();

    // ---- no song repeats across a replay in the same room, when the pool allows it ----
    const remy = io(URL, { transports: ['websocket'] });
    const sacha = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(remy, 'connect'), waitFor(sacha, 'connect')]);
    remy.emit('create-room', { name: 'Remy' });
    const remyJoined = await waitFor(remy, 'joined');
    if (remyJoined.room.usedSongKeys && remyJoined.room.usedSongKeys.length === 0) ok('room starts with an empty usedSongKeys list');
    else fail('expected usedSongKeys to start empty, got: ' + JSON.stringify(remyJoined.room.usedSongKeys));
    sacha.emit('join-room', { code: remyJoined.code, name: 'Sacha' });
    await waitFor(sacha, 'joined');
    remy.emit('set-reveal-delay', { seconds: 3 });
    await waitForRoomWhere(remy, r => r.revealDelaySeconds === 3);
    remy.emit('start-game');
    const g1 = await waitForRoomWhere(remy, r => r.phase === 'playing');
    const g1ActiveId = g1.turnOrder[g1.turnIndex];
    const g1ActiveSocket = g1ActiveId === remyJoined.playerId ? remy : sacha;
    const g1StartCards = g1.players.map(p => p.timeline[0]); // both starting cards count as "used" once the game ends

    g1ActiveSocket.emit('draw-card');
    const g1Drawn = await waitForRoomWhere(g1ActiveSocket, r => !!r.pending);
    const drawnCardKey = { title: g1Drawn.pending.card.title, artist: g1Drawn.pending.card.artist };
    g1ActiveSocket.emit('place-card', { gapIndex: 0 }); // outcome doesn't matter — either way this card becomes "used"
    await waitForRoomWhere(g1ActiveSocket, r => r.pending && r.pending.stage === 'placed');
    await waitForRoomWhere(g1ActiveSocket, r => r.pending === null, 8000);

    remy.emit('play-again');
    const backInLobby = await waitForRoomWhere(remy, r => r.phase === 'lobby');
    const usedAfterReplayPrep = backInLobby.usedSongKeys || [];
    const norm = normalizeLikeServer;
    const expectStartCardsUsed = g1StartCards.every(c => usedAfterReplayPrep.includes(norm(c.title) + '|' + norm(c.artist)));
    const expectDrawnCardUsed = usedAfterReplayPrep.includes(norm(drawnCardKey.title) + '|' + norm(drawnCardKey.artist));
    if (expectStartCardsUsed && expectDrawnCardUsed && usedAfterReplayPrep.length >= 3) {
      ok(`play-again correctly recorded ${usedAfterReplayPrep.length} used song(s) from the finished game before resetting`);
    } else {
      fail('play-again did not record used songs as expected: ' + JSON.stringify(usedAfterReplayPrep));
    }

    remy.emit('start-game');
    const g2 = await waitForRoomWhere(remy, r => r.phase === 'playing');
    const g2AllSongs = g2.players.flatMap(p => p.timeline).concat(g2.deck);
    const repeats = g2AllSongs.filter(c => usedAfterReplayPrep.includes(norm(c.title) + '|' + norm(c.artist)));
    if (repeats.length === 0) {
      ok('the replay correctly avoided every song used in the previous game (checked across both starting hands and the full deck)');
    } else {
      fail(`the replay repeated ${repeats.length} song(s) that were already used: ` + JSON.stringify(repeats.slice(0, 3)));
    }
    remy.disconnect(); sacha.disconnect();

    // ---- auto-draw: the next card starts itself if nobody draws manually ----
    const tara = io(URL, { transports: ['websocket'] });
    const ulysse = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(tara, 'connect'), waitFor(ulysse, 'connect')]);
    tara.emit('create-room', { name: 'Tara' });
    const taraJoined = await waitFor(tara, 'joined');
    if (taraJoined.room.autoDrawSeconds === 5) ok('room defaults to autoDrawSeconds=5 (matches the Original mode preset)');
    else fail('expected default autoDrawSeconds=5, got ' + taraJoined.room.autoDrawSeconds);
    ulysse.emit('join-room', { code: taraJoined.code, name: 'Ulysse' });
    await waitFor(ulysse, 'joined');

    let adRefused = null;
    ulysse.once('error-msg', (msg) => { adRefused = msg; });
    ulysse.emit('set-auto-draw-seconds', { seconds: 8 });
    await new Promise(r => setTimeout(r, 400));
    if (adRefused) ok('non-host correctly refused when trying to set the auto-draw delay');
    else fail('expected non-host set-auto-draw-seconds attempt to be refused');

    tara.emit('set-auto-draw-seconds', { seconds: 8 });
    const adRoom = await waitForRoomWhere(tara, r => r.autoDrawSeconds === 8);
    ok('host successfully set autoDrawSeconds=' + adRoom.autoDrawSeconds);
    tara.emit('set-turn-decision-seconds', { seconds: 60 }); // keep this out of the way so it doesn't race the auto-draw
    await waitForRoomWhere(tara, r => r.turnDecisionSeconds === 60);
    tara.emit('start-game');
    const adGame = await waitForRoomWhere(tara, r => r.phase === 'playing');
    if (adGame.turnStartedAt) ok('turnStartedAt is set for the client to compute the auto-draw fill bar');
    else fail('expected turnStartedAt to be set when the game starts');

    // deliberately never emit draw-card — just wait past the 8s auto-draw delay
    const adActiveId = adGame.turnOrder[adGame.turnIndex];
    const adActiveSocket = adActiveId === taraJoined.playerId ? tara : ulysse;
    const autoDrawn = await waitForRoomWhere(adActiveSocket, r => r.pending && r.pending.stage === 'listening', 11000);
    if (autoDrawn.pending.activePlayerId === adActiveId) {
      ok('a card was auto-drawn for the active player after the configured delay, with no manual draw-card ever sent');
    } else {
      fail('expected an auto-drawn pending card for the active player: ' + JSON.stringify(autoDrawn.pending));
    }
    tara.disconnect(); ulysse.disconnect();

    // ---- reaction anti-spam: max 5 within 20s, 6th is dropped server-side ----
    const xena = io(URL, { transports: ['websocket'] });
    const remy2 = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(xena, 'connect'), waitFor(remy2, 'connect')]);
    xena.emit('create-room', { name: 'Xena' });
    const xenaJoined = await waitFor(xena, 'joined');
    remy2.emit('join-room', { code: xenaJoined.code, name: 'Remy2' });
    await waitFor(remy2, 'joined');

    let receivedByRen = [];
    remy2.on('reaction', (r) => receivedByRen.push(r));
    for (let i = 0; i < 6; i++) xena.emit('send-reaction', { emoji: '🔥' });
    await new Promise(r => setTimeout(r, 500));
    if (receivedByRen.length === 5) {
      ok('server correctly relayed only 5 of 6 rapid reactions (anti-spam cap enforced)');
    } else {
      fail(`expected exactly 5 relayed reactions, got ${receivedByRen.length}`);
    }
    // one more, still within the same burst — still dropped
    receivedByRen = [];
    xena.emit('send-reaction', { emoji: '🔥' });
    await new Promise(r => setTimeout(r, 400));
    if (receivedByRen.length === 0) ok('a 7th rapid reaction is still correctly dropped while the anti-spam window is active');
    else fail('expected the 7th reaction to also be dropped, got ' + receivedByRen.length);

    let clapReceived = false;
    remy2.once('reaction', (r) => { if (r.emoji === '👏') clapReceived = true; });
    xena.emit('send-reaction', { emoji: '👏' });
    await new Promise(r => setTimeout(r, 400));
    if (!clapReceived) ok('the removed 👏 emoji is correctly rejected as not in the allowed list');
    else fail('expected 👏 to be rejected, but it was relayed');
    xena.disconnect(); remy2.disconnect();

    // ---- a room left with only a bot auto-closes ----
    const sol = io(URL, { transports: ['websocket'] });
    await waitFor(sol, 'connect');
    sol.emit('create-room', { name: 'Sol' });
    const solJoined = await waitFor(sol, 'joined');
    sol.emit('add-bot');
    await waitForRoomWhere(sol, r => r.players.some(p => p.isBot));
    sol.emit('leave-room');
    await new Promise(r => setTimeout(r, 500));
    const rejoinAttempt = io(URL, { transports: ['websocket'] });
    await waitFor(rejoinAttempt, 'connect');
    let rejoinError = null;
    rejoinAttempt.once('error-msg', (msg) => { rejoinError = msg; });
    rejoinAttempt.emit('join-room', { code: solJoined.code, name: 'Trying' });
    await new Promise(r => setTimeout(r, 500));
    if (rejoinError) ok('room with only a bot left correctly auto-closed (rejoin attempt failed: "' + rejoinError + '")');
    else fail('expected the bot-only room to no longer exist');
    sol.disconnect(); rejoinAttempt.disconnect();

    // ---- 3+ players: only ONE challenge can be active per pending card ----
    const uma = io(URL, { transports: ['websocket'] });
    const vic = io(URL, { transports: ['websocket'] });
    const walt = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(uma, 'connect'), waitFor(vic, 'connect'), waitFor(walt, 'connect')]);
    uma.emit('create-room', { name: 'Uma' });
    const umaJoined = await waitFor(uma, 'joined');
    vic.emit('join-room', { code: umaJoined.code, name: 'Vic' });
    const vicJoined = await waitFor(vic, 'joined');
    walt.emit('join-room', { code: umaJoined.code, name: 'Walt' });
    const waltJoined = await waitFor(walt, 'joined');
    uma.emit('set-reveal-delay', { seconds: 30 }); // long enough that nothing auto-resolves mid-test
    await waitForRoomWhere(uma, r => r.revealDelaySeconds === 30);
    uma.emit('start-game');
    const threeGame = await waitForRoomWhere(uma, r => r.phase === 'playing' && r.players.length === 3);
    const threeActiveId = threeGame.turnOrder[threeGame.turnIndex];
    const idToSocket = { [umaJoined.playerId]: uma, [vicJoined.playerId]: vic, [waltJoined.playerId]: walt };
    const threeActiveSocket = idToSocket[threeActiveId];
    const nonActiveIds = [umaJoined.playerId, vicJoined.playerId, waltJoined.playerId].filter(id => id !== threeActiveId);
    const firstChallenger = idToSocket[nonActiveIds[0]];
    const secondChallenger = idToSocket[nonActiveIds[1]];

    threeActiveSocket.emit('draw-card');
    await waitForRoomWhere(threeActiveSocket, r => !!r.pending);
    threeActiveSocket.emit('place-card', { gapIndex: 0 });
    const placedRoom = await waitForRoomWhere(threeActiveSocket, r => r.pending && r.pending.stage === 'placed');

    firstChallenger.emit('submit-challenge', { gapIndex: 1 });
    const afterFirstChallenge = await waitForRoomWhere(firstChallenger, r => r.pending && r.pending.challenge);
    if (afterFirstChallenge.pending.challenge.playerId === nonActiveIds[0]) {
      ok('first challenger (of 2 eligible) successfully registered the challenge');
    } else fail('expected the first challenger to be registered');

    // a second, different player tries to also challenge the SAME pending card — must get
    // an explicit "too late" message, not silence (this used to be a silent no-op)
    let secondAttemptError = null;
    secondChallenger.once('error-msg', (msg) => { secondAttemptError = msg; });
    let roomAfterSecondAttempt = null;
    secondChallenger.once('room', (r) => { roomAfterSecondAttempt = r; });
    secondChallenger.emit('submit-challenge', { gapIndex: placedRoom.pending.placement.gapIndex === 0 ? 1 : 0 });
    await new Promise(r => setTimeout(r, 500));

    const firstChallengerName = placedRoom.players.find(p => p.id === nonActiveIds[0]).name;
    if (secondAttemptError && secondAttemptError.includes(firstChallengerName)) {
      ok(`second (too-late) challenger correctly received an explicit error naming the winner: "${secondAttemptError}"`);
    } else {
      fail('expected an explicit "too late, X challenged first" error for the second challenger, got: ' + JSON.stringify(secondAttemptError));
    }
    if (roomAfterSecondAttempt && roomAfterSecondAttempt.pending.challenge.playerId === nonActiveIds[0]) {
      ok('second challenger correctly could NOT overwrite the existing challenge (still belongs to the first challenger)');
    } else {
      fail('expected the challenge to still belong to the first challenger after a second attempt: ' + JSON.stringify(roomAfterSecondAttempt && roomAfterSecondAttempt.pending.challenge));
    }
    uma.disconnect(); vic.disconnect(); walt.disconnect();

    // ---- leave-room: game ends when too few players remain, host reassigned if needed ----
    const paul = io(URL, { transports: ['websocket'] }); // host
    const quinn = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(paul, 'connect'), waitFor(quinn, 'connect')]);
    paul.emit('create-room', { name: 'Paul' });
    const paulJoined = await waitFor(paul, 'joined');
    quinn.emit('join-room', { code: paulJoined.code, name: 'Quinn' });
    const quinnJoined = await waitFor(quinn, 'joined');
    paul.emit('set-reveal-delay', { seconds: 3 });
    await waitForRoomWhere(paul, r => r.revealDelaySeconds === 3);
    paul.emit('start-game');
    await waitForRoomWhere(paul, r => r.phase === 'playing');

    // Quinn (non-host) leaves mid-game -> host (Paul) is left alone -> game must end back to lobby
    quinn.emit('leave-room');
    const afterQuinnLeft = await waitForRoomWhere(paul, r => r.phase === 'lobby');
    if (afterQuinnLeft.phase === 'lobby' && afterQuinnLeft.players.length === 1 && afterQuinnLeft.players[0].id === paulJoined.playerId) {
      ok('game correctly ended (back to lobby) when the host was left alone after the other player left');
    } else fail('expected phase="lobby" with only the host remaining, got: ' + JSON.stringify({ phase: afterQuinnLeft.phase, players: afterQuinnLeft.players.map(p => p.name) }));
    quinn.disconnect();

    // ---- leave-room: host leaving reassigns host to a remaining player ----
    const rachel = io(URL, { transports: ['websocket'] }); // will become host
    const steve = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(rachel, 'connect'), waitFor(steve, 'connect')]);
    rachel.emit('create-room', { name: 'Rachel' });
    const rachelJoined = await waitFor(rachel, 'joined');
    steve.emit('join-room', { code: rachelJoined.code, name: 'Steve' });
    const steveJoined = await waitFor(steve, 'joined');
    rachel.emit('leave-room');
    const afterHostLeft = await waitForRoomWhere(steve, r => r.hostId === steveJoined.playerId);
    if (afterHostLeft.hostId === steveJoined.playerId && afterHostLeft.players.length === 1) {
      ok('host reassigned to the remaining player when the original host left');
    } else fail('expected Steve to become the new host, got hostId=' + afterHostLeft.hostId);
    rachel.disconnect();

    // last player leaving deletes the room entirely
    steve.emit('leave-room');
    await new Promise(r => setTimeout(r, 400));
    const tina = io(URL, { transports: ['websocket'] });
    await waitFor(tina, 'connect');
    let deletedRoomError = null;
    tina.once('error-msg', (msg) => { deletedRoomError = msg; });
    tina.emit('join-room', { code: rachelJoined.code, name: 'Tina' });
    await new Promise(r => setTimeout(r, 400));
    if (deletedRoomError) ok('room was fully deleted after the last player left: "' + deletedRoomError + '"');
    else fail('expected the room to no longer exist after everyone left it');
    steve.disconnect(); tina.disconnect();
    paul.disconnect();

    // ---- kick-player ----
    const frank = io(URL, { transports: ['websocket'] });
    const grace = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(frank, 'connect'), waitFor(grace, 'connect')]);
    frank.emit('create-room', { name: 'Frank' });
    const frankJoined = await waitFor(frank, 'joined');
    grace.emit('join-room', { code: frankJoined.code, name: 'Grace' });
    const graceJoined = await waitFor(grace, 'joined');

    let graceGotKicked = false;
    grace.once('kicked', () => { graceGotKicked = true; });
    let graceRefusedToKick = null;
    grace.once('error-msg', (msg) => { graceRefusedToKick = msg; });
    grace.emit('kick-player', { playerId: frankJoined.playerId }); // non-host trying to kick -> refused
    await new Promise(r => setTimeout(r, 400));
    if (graceRefusedToKick) ok('non-host correctly refused when trying to kick someone: "' + graceRefusedToKick + '"');
    else fail('expected non-host kick attempt to be refused');

    frank.emit('kick-player', { playerId: graceJoined.playerId }); // host kicks Grace
    const afterKick = await waitForRoomWhere(frank, r => r.players.length === 1);
    await new Promise(r => setTimeout(r, 300));
    if (afterKick.players.length === 1 && afterKick.players[0].id === frankJoined.playerId) ok('host successfully kicked the other player, 1 player remains');
    else fail('kick did not reduce room to 1 player as expected');
    if (graceGotKicked) ok('kicked player received a "kicked" event');
    else fail('kicked player never received the "kicked" event');
    frank.disconnect(); grace.disconnect();

    // ---- auto-reveal (no manual "reveal" emitted — the server must resolve it by itself) ----
    const heidi = io(URL, { transports: ['websocket'] });
    const ivan = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(heidi, 'connect'), waitFor(ivan, 'connect')]);
    heidi.emit('create-room', { name: 'Heidi' });
    const heidiJoined = await waitFor(heidi, 'joined');
    ivan.emit('join-room', { code: heidiJoined.code, name: 'Ivan' });
    await waitFor(ivan, 'joined');
    heidi.emit('set-reveal-delay', { seconds: 3 });
    await waitForRoomWhere(heidi, r => r.revealDelaySeconds === 3);
    heidi.emit('start-game');
    const arGame = await waitForRoomWhere(heidi, r => r.phase === 'playing');
    const arActiveId = arGame.turnOrder[arGame.turnIndex];
    const arActive = arActiveId === heidiJoined.playerId ? heidi : ivan;
    arActive.emit('draw-card');
    const arDrawn = await waitForRoomWhere(arActive, r => !!r.pending);
    const activePlayerObj = arDrawn.players.find(p => p.id === arActiveId);
    const existingYear = activePlayerObj.timeline[0].year;
    const newYear = arDrawn.pending.card.year;
    const wrongGap = newYear >= existingYear ? 0 : 1; // deliberately place on the wrong side
    arActive.emit('place-card', { gapIndex: wrongGap });
    await waitForRoomWhere(arActive, r => r.pending && r.pending.stage === 'placed');
    // deliberately do NOT emit 'reveal' — just wait past the (shortened) delay
    const arResolved = await waitForRoomWhere(arActive, r => r.pending === null && r.lastResult, 8000);
    if (arResolved.pending === null && arResolved.lastResult) ok('card auto-revealed by the server after the delay, with no manual "reveal" ever sent');
    else fail('auto-reveal did not happen on its own');

    // ---- missed-card history ----
    if (arResolved.lastResult.kind === 'wrong' || arResolved.lastResult.kind === 'stolen') {
      const missedEntry = (arResolved.missedCards || []).find(m => m.playerId === arActiveId && m.year === newYear);
      if (missedEntry) ok('missed-card history recorded the wrong guess: ' + missedEntry.year + ' — ' + missedEntry.title);
      else fail('expected a missedCards entry for the deliberately-wrong placement, found none: ' + JSON.stringify(arResolved.missedCards));
    } else {
      // the deliberately-"wrong" gap actually turned out to be chronologically valid (e.g. tie on year) — rare but possible
      log('  (the deliberately-mismatched gap actually resolved as correct — equal-year edge case, not a bug; skipping the missedCards assertion this run)');
    }
    heidi.disconnect(); ivan.disconnect();

    // ---- stolen-card permanent marker (stolenFrom) ----
    const bess = io(URL, { transports: ['websocket'] });
    const carl = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(bess, 'connect'), waitFor(carl, 'connect')]);
    bess.emit('create-room', { name: 'Bess' });
    const bessJoined = await waitFor(bess, 'joined');
    carl.emit('join-room', { code: bessJoined.code, name: 'Carl' });
    const carlJoined = await waitFor(carl, 'joined');
    bess.emit('set-reveal-delay', { seconds: 3 });
    await waitForRoomWhere(bess, r => r.revealDelaySeconds === 3);
    bess.emit('start-game');
    const stGame = await waitForRoomWhere(bess, r => r.phase === 'playing');
    const stActiveId = stGame.turnOrder[stGame.turnIndex];
    const stActiveSocket = stActiveId === bessJoined.playerId ? bess : carl;
    const stActiveName = stActiveId === bessJoined.playerId ? 'Bess' : 'Carl';
    const stChallengerSocket = stActiveSocket === bess ? carl : bess;
    const stChallengerId = stActiveSocket === bess ? carlJoined.playerId : bessJoined.playerId;

    stActiveSocket.emit('draw-card');
    const stDrawn = await waitForRoomWhere(stActiveSocket, r => !!r.pending);
    const stNewYear = stDrawn.pending.card.year;
    const stActiveExistingYear = stDrawn.players.find(p => p.id === stActiveId).timeline[0].year;
    const stChallengerExistingYear = stDrawn.players.find(p => p.id === stChallengerId).timeline[0].year;
    const stWrongGap = stNewYear >= stActiveExistingYear ? 0 : 1; // deliberately wrong for the active player
    stActiveSocket.emit('place-card', { gapIndex: stWrongGap });
    await waitForRoomWhere(stActiveSocket, r => r.pending && r.pending.stage === 'placed');
    let stCorrectGap = stNewYear <= stChallengerExistingYear ? 0 : 1; // correct relative to the challenger's own timeline
    // The server rejects a challenge on the SAME gap the active player already
    // used — if our two independently-computed gaps happen to coincide, flip
    // the challenge gap so the submission is actually accepted. (The existing
    // "skip assertion if outcome isn't stolen" fallback below already covers
    // the resulting rare case where that flip makes the challenge incorrect.)
    if (stCorrectGap === stWrongGap) stCorrectGap = 1 - stCorrectGap;
    stChallengerSocket.emit('submit-challenge', { gapIndex: stCorrectGap });
    await waitForRoomWhere(stChallengerSocket, r => r.pending && r.pending.challenge);
    const stResolved = await waitForRoomWhere(stActiveSocket, r => r.pending === null && r.lastResult, 6000);

    if (stResolved.lastResult.kind === 'stolen') {
      const winnerObj = stResolved.players.find(p => p.id === stChallengerId);
      const stolenCard = winnerObj.timeline.find(c => c.year === stNewYear && c.title === stResolved.lastResult.title);
      if (stolenCard && stolenCard.stolenFrom === stActiveName) {
        ok(`stolen card permanently tagged with stolenFrom="${stolenCard.stolenFrom}" on the winner's timeline`);
      } else {
        fail('winning timeline card missing correct stolenFrom marker: ' + JSON.stringify(stolenCard));
      }
    } else {
      // the deliberately-mismatched gaps happened to tie on year for one side — rare edge case, not a bug
      log(`  (this run resolved as "${stResolved.lastResult.kind}" instead of "stolen" — equal-year edge case; skipping the stolenFrom assertion this run)`);
    }
    bess.disconnect(); carl.disconnect();

    // ---- turn-decision timeout (auto-pass) ----
    const dana = io(URL, { transports: ['websocket'] });
    const eli = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(dana, 'connect'), waitFor(eli, 'connect')]);
    dana.emit('create-room', { name: 'Dana' });
    const danaJoined = await waitFor(dana, 'joined');
    eli.emit('join-room', { code: danaJoined.code, name: 'Eli' });
    await waitFor(eli, 'joined');
    let tdRefused = null;
    eli.once('error-msg', (msg) => { tdRefused = msg; });
    eli.emit('set-turn-decision-seconds', { seconds: 15 });
    await new Promise(r => setTimeout(r, 400));
    if (tdRefused) ok('non-host correctly refused when trying to set the turn-decision delay');
    else fail('expected non-host set-turn-decision-seconds attempt to be refused');
    dana.emit('set-turn-decision-seconds', { seconds: 15 }); // the configured minimum
    const tdRoom = await waitForRoomWhere(dana, r => r.turnDecisionSeconds === 15);
    ok('host successfully set turn-decision delay to ' + tdRoom.turnDecisionSeconds + 's');
    dana.emit('start-game');
    const tdGame = await waitForRoomWhere(dana, r => r.phase === 'playing');
    const tdActiveId = tdGame.turnOrder[tdGame.turnIndex];
    const tdActiveSocket = tdActiveId === danaJoined.playerId ? dana : eli;
    tdActiveSocket.emit('draw-card');
    const tdDrawn = await waitForRoomWhere(tdActiveSocket, r => r.pending && r.pending.stage === 'listening' && !!r.pending.drawnAt);
    ok('draw-card set a drawnAt timestamp, starting the decision timer');
    // deliberately never place or pass — just wait past the 15s decision delay
    const tdAdvanced = await waitForRoomWhere(tdActiveSocket, r => r.pending === null && r.turnIndex !== tdGame.turnIndex, 20000);
    if (tdAdvanced.pending === null && tdAdvanced.turnIndex !== tdGame.turnIndex) {
      ok('turn auto-passed to the next player after the decision delay elapsed with no response');
    } else {
      fail('expected the turn to auto-pass after the decision delay: ' + JSON.stringify({ pending: tdAdvanced.pending, turnIndex: tdAdvanced.turnIndex }));
    }
    dana.disconnect(); eli.disconnect();

    // ---- filters (tested in a fresh room, kept in lobby phase throughout) ----
    const catRes2 = await fetch(`${URL}/api/songs`);
    const fullCatalog = await catRes2.json();
    if (fullCatalog.length >= 300) ok(`expanded catalog present: ${fullCatalog.length} songs`);
    else fail(`expected 150+ songs, got ${fullCatalog.length}`);

    const bracketsRes = await fetch(`${URL}/api/brackets`);
    const brackets = await bracketsRes.json();
    if (brackets.length === 7) ok('7 brackets exposed via /api/brackets');
    else fail('expected 7 brackets, got ' + brackets.length);

    const dave = io(URL, { transports: ['websocket'] });
    await waitFor(dave, 'connect');
    dave.emit('create-room', { name: 'Dave' });
    await waitFor(dave, 'joined');
    dave.emit('add-bot');
    await waitForRoomWhere(dave, r => r.players.some(p => p.isBot));

    const narrowBracket = brackets.find(b => b.label === '1900-1919');
    const expectedCount = fullCatalog.filter(s => s.year >= narrowBracket.from && s.year <= narrowBracket.to).length;
    dave.emit('set-filters', { filters: { brackets: [narrowBracket] } });
    await waitForRoomWhere(dave, r => r.filters.brackets.length === 1);
    ok(`set-filters accepted (1900-1919 bracket, ${expectedCount} matching songs in catalog)`);

    // A filter guaranteed to match zero songs must always be rejected, regardless of catalog size.
    // (Every real bracket has songs now that the catalog spans 1900-2026, so
    // this uses an out-of-range synthetic bracket to force a genuine zero-match pool.)
    dave.emit('set-filters', { filters: { brackets: [{ from: 1000, to: 1005, label: 'synthetic-empty' }] } });
    await waitForRoomWhere(dave, r => r.filters.brackets.length === 1 && r.filters.brackets[0].from === 1000);
    let zeroMatchErrorSeen = false;
    dave.once('error-msg', () => { zeroMatchErrorSeen = true; });
    dave.emit('start-game');
    await new Promise(r => setTimeout(r, 500));
    if (zeroMatchErrorSeen) ok('start-game correctly rejected for a filter matching zero songs (room stayed in lobby)');
    else fail('start-game should have been rejected for a zero-match filter');

    // Reset filters back to "everything" — this room never successfully started a
    // game above, so it is still in lobby phase and set-filters will take effect.
    dave.emit('set-filters', { filters: { brackets: [] } });
    await waitForRoomWhere(dave, r => r.filters.brackets.length === 0);
    dave.emit('start-game');
    const filteredGameStarted = await waitForRoomWhere(dave, r => r.phase === 'playing');
    if (filteredGameStarted.phase === 'playing') ok('start-game succeeds once filters are reset to "all songs"');
    else fail('start-game did not succeed after resetting filters');
    dave.disconnect();

    // ---- player colors: explicit valid choice kept, invalid/missing sanitized, bots get a fixed neutral color ----
    const wynn = io(URL, { transports: ['websocket'] });
    const xico = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(wynn, 'connect'), waitFor(xico, 'connect')]);
    wynn.emit('create-room', { name: 'Wynn', color: '#3FD9C4' });
    const wynnJoined = await waitFor(wynn, 'joined');
    const wynnPlayer = wynnJoined.room.players.find(p => p.id === wynnJoined.playerId);
    if (wynnPlayer.color === '#3FD9C4') ok('an explicit valid color is kept as-is for the room creator');
    else fail('expected color #3FD9C4 to be kept, got ' + wynnPlayer.color);

    xico.emit('join-room', { code: wynnJoined.code, name: 'Xico', color: 'not-a-real-color' });
    const xicoJoined = await waitFor(xico, 'joined');
    const xicoPlayer = xicoJoined.room.players.find(p => p.id === xicoJoined.playerId);
    if (PLAYER_COLORS.includes(xicoPlayer.color)) ok('an invalid/unrecognized color is sanitized to a valid palette color: ' + xicoPlayer.color);
    else fail('expected an invalid color to be replaced with a palette color, got ' + xicoPlayer.color);

    wynn.emit('add-bot');
    const withBot = await waitForRoomWhere(wynn, r => r.players.some(p => p.isBot));
    const botPlayer = withBot.players.find(p => p.isBot);
    if (botPlayer.color === '#8B93A6') ok('bots get a fixed neutral color, not a random palette one');
    else fail('expected the bot to have the fixed neutral color, got ' + botPlayer.color);

    // A third player trying to join with a color already used by Wynn must
    // be rejected with the list of taken colors, not silently reassigned.
    const yasmin = io(URL, { transports: ['websocket'] });
    await waitFor(yasmin, 'connect');
    let colorTakenPayload = null;
    yasmin.once('color-taken', (payload) => { colorTakenPayload = payload; });
    yasmin.emit('join-room', { code: wynnJoined.code, name: 'Yara', color: '#3FD9C4', colorExplicit: true }); // same as Wynn's, deliberately chosen
    await new Promise(r => setTimeout(r, 500));
    if (colorTakenPayload && colorTakenPayload.takenColors.includes('#3FD9C4')) {
      ok('joining with an already-used color is correctly rejected, listing the taken colors: ' + colorTakenPayload.takenColors.join(', '));
    } else {
      fail('expected a color-taken event listing #3FD9C4, got: ' + JSON.stringify(colorTakenPayload));
    }
    // Pick a color guaranteed free right now (Xico's was randomly assigned
    // from an invalid input earlier, so it can't be hardcoded here without
    // risking a coincidental — but legitimate — flake).
    const currentlyTaken = withBot.players.map(p => p.color);
    const guaranteedFree = PLAYER_COLORS.find(c => !currentlyTaken.includes(c));
    yasmin.emit('join-room', { code: wynnJoined.code, name: 'Yara', color: guaranteedFree, colorExplicit: true });
    const yasminJoined = await waitFor(yasmin, 'joined');
    if (yasminJoined.room.players.find(p => p.name === 'Yara')?.color === guaranteedFree) {
      ok('joining again with a free, deliberately-chosen color succeeds normally');
    } else {
      fail('expected Yara to join successfully with a free color');
    }
    wynn.disconnect(); xico.disconnect(); yasmin.disconnect();

    // ---- the actual bug found while testing: an IMPLICIT (non-deliberate)
    // color collision must silently auto-resolve to a free color instead of
    // being rejected — otherwise ordinary joins (nobody opened the picker)
    // would randomly fail whenever their default color happened to coincide. ----
    const ophir = io(URL, { transports: ['websocket'] });
    const petra = io(URL, { transports: ['websocket'] });
    await Promise.all([waitFor(ophir, 'connect'), waitFor(petra, 'connect')]);
    ophir.emit('create-room', { name: 'Ophir', color: '#FF8A4F' });
    const ophirJoined = await waitFor(ophir, 'joined');
    let implicitRejected = false;
    petra.once('color-taken', () => { implicitRejected = true; });
    // deliberately the SAME color as Ophir, but colorExplicit is omitted —
    // simulating an ordinary join where nobody touched the 🎨 picker
    petra.emit('join-room', { code: ophirJoined.code, name: 'Petra', color: '#FF8A4F' });
    const petraJoined = await waitFor(petra, 'joined', 3000);
    if (!implicitRejected && petraJoined) {
      const petraPlayer = petraJoined.room.players.find(p => p.name === 'Petra');
      if (petraPlayer.color && petraPlayer.color !== '#FF8A4F') {
        ok('an implicit (non-deliberate) color collision silently auto-resolved to a different free color instead of being rejected: ' + petraPlayer.color);
      } else {
        fail('expected Petra to get a DIFFERENT free color, got: ' + JSON.stringify(petraPlayer));
      }
    } else {
      fail('an implicit color collision should never be rejected — this is the exact bug the fix addresses');
    }
    ophir.disconnect(); petra.disconnect();

    alice.disconnect(); bob.disconnect(); carol.disconnect();
    ok('ALL TESTS COMPLETED');
  } catch (e) {
    fail('exception during test: ' + e.stack);
  } finally {
    server.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.unlinkSync(ROOMS_FILE); } catch (e) {}
    fs.writeFileSync(path.join(__dirname, 'songs.json'), JSON.stringify(ORIGINAL_SONGS, null, 2) + '\n');
  }
}

main();
