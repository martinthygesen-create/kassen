#!/usr/bin/env node
// Verifikation af den nye "udsagn"-rundetype (se collectSecretCandidates/
// pickSecretCandidate i api/_lib/game.js, action:'secret' i api/brok.js,
// resolveUdsagn i api/_lib/gameFlow.js) — kører de RIGTIGE HTTP-handlere
// mod en delt in-memory redis-mock, samme mønster som test_concurrency.js
// og test_assign_round.js.
//
// BRUG: node scripts/test_udsagn_round.js

const path = require('path');

class MockRedis {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async set(key, value) { this.store.set(key, value); return 'OK'; }
  async del(key) { this.store.delete(key); return 1; }
  async eval(script, keys, args) {
    const key = keys[0];
    const [oldRaw, newRaw] = args;
    const current = this.store.has(key) ? this.store.get(key) : null;
    if (current === oldRaw) { this.store.set(key, newRaw); return 1; }
    return 0;
  }
}
const mockInstance = new MockRedis();
const redisPath = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'redis.js'));
require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: { redis: () => mockInstance } };

const roomHandler = require(path.join(__dirname, '..', 'api', 'room.js'));
const brokHandler = require(path.join(__dirname, '..', 'api', 'brok.js'));
const gameHandler = require(path.join(__dirname, '..', 'api', 'game.js'));
const { getState, setState } = require(path.join(__dirname, '..', 'api', '_lib', 'store.js'));

function fakeRes() { const res = {}; res.status = c => { res.code = c; return res; }; res.json = o => { res.body = o; }; return res; }
function assert(cond, msg) { if (!cond) throw new Error('FEJL: ' + msg); }
function log(msg) { console.log('  ' + msg); }

async function call(handler, body) {
  const res = fakeRes();
  await handler({ method: 'POST', body }, res);
  if (res.code && res.code >= 400) throw new Error('HTTP ' + res.code + ': ' + JSON.stringify(res.body));
  return res.body;
}
async function callExpectError(handler, body) {
  const res = fakeRes();
  await handler({ method: 'POST', body }, res);
  return res;
}

async function setupRoom(memberCount, themeId) {
  const created = await call(roomHandler, { themeId });
  const roomId = created.roomId;
  const memberIds = [];
  for (let i = 0; i < memberCount; i++) {
    const r = await call(roomHandler, { action: 'join', roomId, name: 'P' + i });
    memberIds.push(r.state.members[r.state.members.length - 1].id);
  }
  return { roomId, memberIds };
}

async function testLockedAfterSave() {
  log('--- 1. Gemt udsagn er permanent låst ---');
  const { roomId, memberIds } = await setupRoom(4, 'bod');
  const r = await call(brokHandler, { action: 'secret', roomId, actorId: memberIds[0], text: 'Jeg har aldrig set den mest kendte film i mit hjem' });
  assert(r.state.personalLayer.entries[memberIds[0]].secret.text === 'Jeg har aldrig set den mest kendte film i mit hjem', 'skal gemme teksten uredigeret');
  const err = await callExpectError(brokHandler, { action: 'secret', roomId, actorId: memberIds[0], text: 'Et forsøg på at ændre det' });
  assert(err.code === 409, 'et andet forsøg på samme spiller skal afvises (409), fik ' + err.code);
  const after = await getState(roomId);
  assert(after.personalLayer.entries[memberIds[0]].secret.text === 'Jeg har aldrig set den mest kendte film i mit hjem', 'teksten må IKKE være ændret af det afviste forsøg');
  log('✅ Andet forsøg afvist (409), original tekst uændret');
}

async function testGenericNotThemeGated() {
  log('--- 2. Generisk: virker i et IKKE-Vennekassen-tema (bod), ikke gated af KENDSKAB_THEMES ---');
  const { roomId, memberIds } = await setupRoom(5, 'bod');
  for (let i = 0; i < 4; i++) {
    await call(brokHandler, { action: 'secret', roomId, actorId: memberIds[i], text: 'Hemmelig-agtigt udsagn nr ' + i });
  }
  // Kør mange runder og se om 'udsagn' nogensinde trækkes i et 'bod'-rum
  let sawUdsagn = false;
  let res = await call(gameHandler, { action: 'start', roomId, actorId: memberIds[0], playerIds: memberIds, totalRounds: 12 });
  let guard = 0;
  while (res.state.game.active && guard < 100) {
    guard++;
    const cur = res.state.game.current;
    if (cur.type === 'gameover') break;
    if (cur.type === 'udsagn') { sawUdsagn = true; }
    if (cur.phase === 'results' || cur.phase === 'skipped') {
      for (const id of memberIds) res = await call(gameHandler, { action: 'ready', roomId, actorId: id }).catch(() => res);
      continue;
    }
    // Tving fasen videre uanset type (nødbremse), for at nå gennem alle 12 runder hurtigt
    const fresh = await getState(roomId);
    if (fresh.game.current && fresh.game.current.phaseStartedAt) fresh.game.current.phaseStartedAt = Date.now() - 1e9;
    await setState(roomId, fresh);
    const { BROKSPILLET_AUTO_MS } = require(path.join(__dirname, '..', 'api', '_lib', 'gameFlow.js'));
    void BROKSPILLET_AUTO_MS;
    // Direkte poll via state.js for at udløse nødbremsen (samme mønster som test_assign_round.js)
    const stateHandler = require(path.join(__dirname, '..', 'api', 'state.js'));
    const pollRes = fakeRes();
    await stateHandler({ method: 'GET', query: { room: roomId, member: memberIds[0] } }, pollRes);
    const withComplaint = await getState(roomId);
    if (withComplaint.game.current && withComplaint.game.current.complaint) withComplaint.game.current.complaint.startedAt = Date.now() - 1e9;
    await setState(roomId, withComplaint);
    const pollRes2 = fakeRes();
    await stateHandler({ method: 'GET', query: { room: roomId, member: memberIds[0] } }, pollRes2);
    const advanced = await getState(roomId);
    res = { state: advanced };
    if (!res.state.game.active) break;
  }
  assert(sawUdsagn, 'udsagn-rundetypen skal kunne trækkes i et almindeligt (ikke-Vennekassen) tema, blev aldrig trukket over 12 runder');
  log('✅ "udsagn" trukket i et bod-rum — bekræftet generisk, ikke temabundet');
}

async function testCoherenceAndPermanentBurn() {
  log('--- 3. Sammenhæng (rigtig tekst/forfatter) + permanent engangsbrug på tværs af FLERE spil ---');
  const { roomId, memberIds } = await setupRoom(4, 'venne');
  const texts = {};
  for (let i = 0; i < 4; i++) {
    const t = 'Unikt udsagn ' + i + ' — ' + Math.random().toString(36).slice(2, 8);
    texts[memberIds[i]] = t;
    await call(brokHandler, { action: 'secret', roomId, actorId: memberIds[i], text: t });
  }
  // Spil 1: kør indtil 'udsagn' trækkes, verificér sammenhæng
  let res = await call(gameHandler, { action: 'start', roomId, actorId: memberIds[0], playerIds: memberIds, totalRounds: 12 });
  let drawnFor = null;
  let guard = 0;
  const stateHandler = require(path.join(__dirname, '..', 'api', 'state.js'));
  while (res.state.game.active && guard < 100 && !drawnFor) {
    guard++;
    const cur = res.state.game.current;
    if (cur.type === 'gameover') break;
    if (cur.type === 'udsagn' && cur.phase === 'guess') {
      // Sammenhæng: teksten skal matche PRÆCIS det den navngivne forfatter skrev
      assert(texts[cur.authorId] === cur.text, 'den viste tekst skal matche ordret hvad authorId reelt skrev');
      const authorName = (await getState(roomId)).members.find(m => m.id === cur.authorId).name;
      assert(cur.options.includes(authorName), 'forfatterens navn skal være blandt svarmulighederne');
      assert(cur.options[cur.correctIndex] === authorName, 'correctIndex skal pege på forfatterens navn');
      drawnFor = cur.authorId;
      // Lad alle undtagen forfatteren gætte rigtigt
      for (const id of memberIds) {
        if (id === cur.authorId) continue;
        res = await call(gameHandler, { action: 'submit', roomId, actorId: id, payload: { choiceIndex: cur.correctIndex } }).catch(() => res);
      }
      break;
    }
    if (cur.phase === 'results' || cur.phase === 'skipped') {
      for (const id of memberIds) res = await call(gameHandler, { action: 'ready', roomId, actorId: id }).catch(() => res);
      continue;
    }
    const fresh = await getState(roomId);
    if (fresh.game.current && fresh.game.current.phaseStartedAt) fresh.game.current.phaseStartedAt = Date.now() - 1e9;
    await setState(roomId, fresh);
    await new Promise(r => stateHandler({ method: 'GET', query: { room: roomId, member: memberIds[0] } }, fakeRes()).then(r));
    const withComplaint = await getState(roomId);
    if (withComplaint.game.current && withComplaint.game.current.complaint) withComplaint.game.current.complaint.startedAt = Date.now() - 1e9;
    await setState(roomId, withComplaint);
    await new Promise(r => stateHandler({ method: 'GET', query: { room: roomId, member: memberIds[0] } }, fakeRes()).then(r));
    const advanced = await getState(roomId);
    res = { state: advanced };
    if (!res.state.game.active) break;
  }
  assert(drawnFor, '"udsagn" skal være trukket mindst én gang inden for 100 forsøgte fase-fremryk');
  log('✅ Sammenhæng bekræftet: tekst/forfatter/svarmuligheder matcher det reelt indsendte, for authorId=' + drawnFor);

  const afterGame1 = await getState(roomId);
  assert(afterGame1.personalLayer.entries[drawnFor].secret.usedAt, 'det trukne udsagn skal være markeret brugt (usedAt sat)');
  const otherSecrets = memberIds.filter(id => id !== drawnFor);
  otherSecrets.forEach(id => {
    // De IKKE-trukne skal stadig være ubrugte
    if (afterGame1.personalLayer.entries[id] && afterGame1.personalLayer.entries[id].secret) {
      assert(!afterGame1.personalLayer.entries[id].secret.usedAt, id + 's udsagn blev ikke trukket og skal derfor stadig være ubrugt');
    }
  });

  // Afslut spillet, start et HELT NYT spil i samme rum — det brugte udsagn må ALDRIG dukke op igen
  await call(gameHandler, { action: 'end', roomId, actorId: memberIds[0] });
  let res2 = await call(gameHandler, { action: 'start', roomId, actorId: memberIds[0], playerIds: memberIds, totalRounds: 12 });
  let guard2 = 0;
  let sawBurnedAgain = false;
  while (res2.state.game.active && guard2 < 100) {
    guard2++;
    const cur = res2.state.game.current;
    if (cur.type === 'gameover') break;
    if (cur.type === 'udsagn' && cur.authorId === drawnFor) sawBurnedAgain = true;
    if (cur.phase === 'results' || cur.phase === 'skipped') {
      for (const id of memberIds) res2 = await call(gameHandler, { action: 'ready', roomId, actorId: id }).catch(() => res2);
      continue;
    }
    const fresh = await getState(roomId);
    if (fresh.game.current && fresh.game.current.phaseStartedAt) fresh.game.current.phaseStartedAt = Date.now() - 1e9;
    await setState(roomId, fresh);
    await new Promise(r => stateHandler({ method: 'GET', query: { room: roomId, member: memberIds[0] } }, fakeRes()).then(r));
    const withComplaint = await getState(roomId);
    if (withComplaint.game.current && withComplaint.game.current.complaint) withComplaint.game.current.complaint.startedAt = Date.now() - 1e9;
    await setState(roomId, withComplaint);
    await new Promise(r => stateHandler({ method: 'GET', query: { room: roomId, member: memberIds[0] } }, fakeRes()).then(r));
    const advanced = await getState(roomId);
    res2 = { state: advanced };
    if (!res2.state.game.active) break;
  }
  assert(!sawBurnedAgain, 'det allerede-afslørede udsagn må ALDRIG blive trukket igen, heller ikke i et nyt spil i samme rum');
  log('✅ Permanent engangsbrug bekræftet på tværs af to separate spil i samme rum');
}

async function testRedactionHidesOthersSecrets() {
  log('--- 4. Redaktion: en spiller kan ikke se en ANDENS ugættede udsagn i deres egen state ---');
  const { roomId, memberIds } = await setupRoom(3, 'venne');
  await call(brokHandler, { action: 'secret', roomId, actorId: memberIds[0], text: 'Kun P0 og serveren kender denne tekst' });
  const viewAsP1 = await call(brokHandler, { action: 'personal', roomId, actorId: memberIds[1], aboutTexts: [] }).catch(async () => {
    // 'personal' kræver mindst MIN_ABOUT_PER_PLAYER andre i 'venne'-temaet — brug i stedet et rent poll for at hente P1s redigerede syn
    const stateHandler = require(path.join(__dirname, '..', 'api', 'state.js'));
    const res = fakeRes();
    await stateHandler({ method: 'GET', query: { room: roomId, member: memberIds[1] } }, res);
    return res.body;
  });
  const seenState = viewAsP1.state || viewAsP1;
  assert(!seenState.personalLayer.entries[memberIds[0]], 'P1s redigerede state må IKKE indeholde P0s entry overhovedet (kun egen entry eksponeres, se redactPersonalLayerFor)');
  log('✅ P1 kan ikke se P0s udsagn i sin egen (redigerede) state');
}

(async () => {
  console.log('=== Verifikation: "udsagn"-rundetypen mod de ægte handlere ===\n');
  await testLockedAfterSave();
  await testGenericNotThemeGated();
  await testCoherenceAndPermanentBurn();
  await testRedactionHidesOthersSecrets();
  console.log('\n✅ Alle 4 scenarier bestået.');
})().catch(e => { console.error('\n❌ ' + e.message); console.error(e.stack); process.exit(1); });
