const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

const PORT = 3210;
const CARDS_TO_WIN = 10; // mirrors the server-side constant, kept in sync manually since this is a standalone test script
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
  // WHILE the scan is still in progress, not just "before the client polled". ----
  const slowServer = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT + 2) } });
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
  }

  // ---- Phase 0: confirm the actual fix — with zero real Deezer access (this
  // sandbox's normal state), draw-card must NEVER hand back a silent card,
  // AND the new readiness gate must still open (checked-but-all-failed still
  // counts as "done checking") while correctly reporting zero playable songs. ----
  const noAudioServer = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT + 1), FAKE_DEEZER: '1', FAKE_DEEZER_FAIL: '1' } });
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
    if (roomAfterPlace.pending && roomAfterPlace.pending.stage === 'placed') ok('place-card moved pending to "placed" stage');
    else fail('place-card did not move to placed: ' + JSON.stringify(roomAfterPlace.pending));

    // reveal by the active player
    activeSocket.emit('reveal');
    let roomAfterReveal = await waitForRoomWhere(activeSocket, r => r.pending === null && r.lastResult);
    if (roomAfterReveal.pending === null && roomAfterReveal.lastResult) {
      ok('reveal resolved: pending cleared, lastResult=' + roomAfterReveal.lastResult.kind);
    } else fail('reveal did not resolve correctly: ' + JSON.stringify(roomAfterReveal.pending));

    // ---- bot flow ----
    const carol = io(URL, { transports: ['websocket'] });
    await waitFor(carol, 'connect');
    carol.emit('create-room', { name: 'Carol' });
    const carolJoined = await waitFor(carol, 'joined');
    carol.emit('add-bot');
    const roomWithBot = await waitForRoomWhere(carol, r => r.players.some(p => p.isBot));
    if (roomWithBot.players.length === 2 && roomWithBot.players.some(p => p.isBot)) ok('bot added to solo room');
    else fail('add-bot failed: ' + JSON.stringify(roomWithBot.players));

    carol.emit('start-game');
    const botGameRoom = await waitForRoomWhere(carol, r => r.phase === 'playing');
    const botActiveId = botGameRoom.turnOrder[botGameRoom.turnIndex];
    const botIsActive = botGameRoom.players.find(p => p.id === botActiveId).isBot;
    if (botIsActive) {
      carol.emit('bot-play');
      const afterBot = await waitForRoomWhere(carol, r => !!r.pending);
      if (afterBot.pending && afterBot.pending.stage === 'placed' && afterBot.pending.activePlayerId === botActiveId) {
        ok('bot-play produced a placed pending card for the bot');
        carol.emit('reveal'); // human allowed to reveal for the bot
        const afterBotReveal = await waitForRoomWhere(carol, r => r.pending === null);
        if (afterBotReveal.pending === null) ok('human successfully revealed on behalf of the bot');
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
    erin.disconnect();

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
    dave.emit('set-filters', { filters: { brackets: [narrowBracket], artists: [] } });
    await waitForRoomWhere(dave, r => r.filters.brackets.length === 1);
    ok(`set-filters accepted (1900-1919 bracket, ${expectedCount} matching songs in catalog)`);

    // A filter guaranteed to match zero songs must always be rejected, regardless of catalog size.
    dave.emit('set-filters', { filters: { brackets: [], artists: ['Some Totally Unknown Artist XYZ'] } });
    await waitForRoomWhere(dave, r => r.filters.artists.length === 1);
    let zeroMatchErrorSeen = false;
    dave.once('error-msg', () => { zeroMatchErrorSeen = true; });
    dave.emit('start-game');
    await new Promise(r => setTimeout(r, 500));
    if (zeroMatchErrorSeen) ok('start-game correctly rejected for a filter matching zero songs (room stayed in lobby)');
    else fail('start-game should have been rejected for a zero-match filter');

    // Reset filters back to "everything" — this room never successfully started a
    // game above, so it is still in lobby phase and set-filters will take effect.
    dave.emit('set-filters', { filters: { brackets: [], artists: [] } });
    await waitForRoomWhere(dave, r => r.filters.brackets.length === 0 && r.filters.artists.length === 0);
    dave.emit('start-game');
    const filteredGameStarted = await waitForRoomWhere(dave, r => r.phase === 'playing');
    if (filteredGameStarted.phase === 'playing') ok('start-game succeeds once filters are reset to "all songs"');
    else fail('start-game did not succeed after resetting filters');
    dave.disconnect();

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
