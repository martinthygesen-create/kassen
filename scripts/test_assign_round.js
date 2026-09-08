#!/usr/bin/env node
// Verifikation af "runde 0" (tildelt venneark-udfyldelse ved spilstart, se
// action:'start' i api/game.js) — kører de RIGTIGE HTTP-handlere
// (api/room.js, api/brok.js, api/game.js) mod en delt in-memory
// redis-mock, samme mønster som test_concurrency.js, IKKE bare et
// isoleret kald af _lib/game.js's funktioner. Formålet er at bevise hele
// kæden fungerer, inkl. mutateState/CAS, ikke kun de rene funktioner.
//
// BRUG: node scripts/test_assign_round.js

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
const stateHandler = require(path.join(__dirname, '..', 'api', 'state.js'));
const { getState, setState } = require(path.join(__dirname, '..', 'api', '_lib', 'store.js'));

// Nødbremsen (expireGamePhaseIfDue) kaldes i PRODUKTION fra api/state.js's
// almindelige polling (hver ~3. sekund fra klienten), IKKE fra api/game.js's
// action-handlere — de har hver deres egen validering der kan smide en
// ApiError, og mutateState skriver INTET hvis dens callback kaster
// undervejs (heller ikke det expiry allerede nåede at mutere i SAMME
// callback). Testen skal derfor polle via det rigtige, rene endpoint, ikke
// simulere det med en handling der efterfølgende selv fejler.
async function pollState(roomId, memberId) {
  const res = fakeRes();
  await stateHandler({ method: 'GET', query: { room: roomId, member: memberId } }, res);
  return res.body;
}

function fakeRes() { const res = {}; res.status = c => { res.code = c; return res; }; res.json = o => { res.body = o; }; return res; }
function assert(cond, msg) { if (!cond) throw new Error('FEJL: ' + msg); }
function log(msg) { console.log('  ' + msg); }

async function call(handler, body) {
  const res = fakeRes();
  await handler({ method: 'POST', body }, res);
  if (res.code && res.code >= 400) throw new Error('HTTP ' + res.code + ': ' + JSON.stringify(res.body));
  return res.body;
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

async function testBasicAssignFlow() {
  log('--- 1. Frisk rum, 5 spillere, ingen forudgående venneark ---');
  const { roomId, memberIds } = await setupRoom(5, 'kende_venner');
  const startRes = await call(gameHandler, { action: 'start', roomId, actorId: memberIds[0], playerIds: memberIds });
  assert(startRes.state.game.current.type === 'assign', 'spillet skal starte i en assign-runde 0 når ingen har venneark endnu');
  const cur = startRes.state.game.current;
  assert(Object.keys(cur.assigned).length === 5, 'alle 5 skal have fået tildelt targets: ' + JSON.stringify(cur.assigned));
  memberIds.forEach(id => {
    const targets = cur.assigned[id];
    assert(targets.length === 2, id + ' skal have præcis 2 targets, fik ' + targets.length);
    assert(!targets.includes(id), id + ' må ikke være tildelt sig selv');
  });
  // Målt balance: hver spiller skal optræde som target præcis 2 gange (5 spillere x 2 targets hver = 10 target-slots / 5 spillere = 2 hver, ved perfekt rotation)
  const targetCounts = {};
  memberIds.forEach(id => (targetCounts[id] = 0));
  Object.values(cur.assigned).forEach(targets => targets.forEach(t => (targetCounts[t] = (targetCounts[t] || 0) + 1)));
  Object.entries(targetCounts).forEach(([id, count]) => assert(count === 2, id + ' skal optræde som target 2 gange, fik ' + count));
  log('✅ Tildeling balanceret: alle 5 er target præcis 2 gange, ingen selv-target');

  // Indsend for alle undtagen den sidste — spillet må IKKE gå videre endnu
  for (let i = 0; i < 4; i++) {
    const id = memberIds[i];
    const targets = cur.assigned[id];
    const aboutTexts = targets.map(t => ({ targetId: t, text: 'Udsagn fra ' + id + ' om ' + t }));
    const r = await call(gameHandler, { action: 'submit', roomId, actorId: id, payload: { aboutTexts } });
    if (i < 3) assert(r.state.game.current.type === 'assign', 'skal blive i assign-fasen indtil alle 5 har indsendt (kun ' + (i + 1) + '/5 indsendt)');
  }
  const afterFour = await getState(roomId);
  assert(afterFour.game.current.type === 'assign', 'skal STADIG være i assign efter 4/5 — kun 5. mangler');
  assert(Object.keys(afterFour.game.current.submitted).length === 4, 'skal have registreret præcis 4 indsendelser');

  // Sidste spiller indsender — spillet skal nu gå videre til en rigtig runde
  const lastId = memberIds[4];
  const lastTargets = cur.assigned[lastId];
  const lastAbout = lastTargets.map(t => ({ targetId: t, text: 'Sidste udsagn fra ' + lastId + ' om ' + t }));
  const finalRes = await call(gameHandler, { action: 'submit', roomId, actorId: lastId, payload: { aboutTexts: lastAbout } });
  assert(finalRes.state.game.current.type !== 'assign', 'efter 5/5 skal spillet være gået videre til en rigtig runde, ikke stadig assign');
  assert(finalRes.state.game.round === 1, 'runde-tælleren skal stå på 1 efter runde 0');
  log('✅ Spillet går automatisk videre til runde 1 når alle 5 har indsendt: type=' + finalRes.state.game.current.type);

  // Bekræft at personalLayer reelt indeholder de tildelte udsagn (sammenhæng)
  const finalState = await getState(roomId);
  memberIds.forEach(id => {
    const entry = finalState.personalLayer.entries[id];
    assert(entry, id + ' skal have en personalLayer-entry efter runde 0');
    assert(entry.about.length === 2, id + ' skal have 2 about-udsagn, har ' + entry.about.length);
  });
  log('✅ Alle 5 har fået deres tildelte udsagn gemt i personalLayer');
  return roomId;
}

async function testMergeNotOverwrite() {
  log('--- 2. Merge: en spiller har allerede et FRIT udsagn før runde 0 kører ---');
  const { roomId, memberIds } = await setupRoom(4, 'kende_venner');
  // P0 udfylder frit på forhånd (opfylder selv brok.js's eget minimumskrav
  // på 2 andre, uafhængigt af runde 0) — om P1 og P2.
  await call(brokHandler, { action: 'personal', roomId, actorId: memberIds[0], aboutTexts: [{ targetId: memberIds[1], text: 'FRIT udsagn om P1, skrevet FØR runde 0' }, { targetId: memberIds[2], text: 'FRIT udsagn om P2, skrevet FØR runde 0' }] });
  const before = await getState(roomId);
  assert(before.personalLayer.entries[memberIds[0]].about.length === 2, 'P0 skal have 2 frie udsagn før runde 0');

  const startRes = await call(gameHandler, { action: 'start', roomId, actorId: memberIds[0], playerIds: memberIds });
  const cur = startRes.state.game.current;
  assert(cur.type === 'assign', 'skal stadig starte assign-fasen, da P1-P3 mangler lag');
  // P0 har allerede en entry, skal derfor IKKE være i cur.assigned
  assert(!cur.assigned[memberIds[0]], 'P0 skal springes over i tildelingen, da personen allerede har et lag');
  assert(cur.assigned[memberIds[1]] && cur.assigned[memberIds[2]] && cur.assigned[memberIds[3]], 'P1-P3 skal alle have fået tildelt targets');

  // De 3 manglende indsender
  for (const id of [memberIds[1], memberIds[2], memberIds[3]]) {
    const targets = cur.assigned[id];
    const aboutTexts = targets.map(t => ({ targetId: t, text: 'Nyt tildelt udsagn fra ' + id + ' om ' + t }));
    await call(gameHandler, { action: 'submit', roomId, actorId: id, payload: { aboutTexts } });
  }
  const after = await getState(roomId);
  // P0's gamle FRIE udsagn skal stadig eksistere — intet overskrevet
  const p0Entry = after.personalLayer.entries[memberIds[0]];
  assert(p0Entry.about.length === 2, 'P0 må ikke have fået rørt sin entry — skal stadig have 2 udsagn, har ' + p0Entry.about.length);
  assert(p0Entry.about[0].text === 'FRIT udsagn om P1, skrevet FØR runde 0', 'P0s oprindelige tekst må ikke være ændret');
  log('✅ P0s frie udsagn fra før runde 0 er uberørt — ' + JSON.stringify(p0Entry.about[0].text));

  // Nu lader vi P1 (som fik en tildelt entry) TILFØJE et ekstra frit udsagn
  // bagefter, via brok.js — om et target P1 IKKE allerede blev tildelt (ved
  // 4 spillere kan rotationen tilfældigt allerede have givet P1 netop det
  // target, hvilket ville være en opdatering, ikke en tilføjelse — vælg
  // derfor eksplicit et frit target udenfor den tildelte liste).
  const p1Before = after.personalLayer.entries[memberIds[1]];
  assert(p1Before.about.length === 2, 'P1 skal have 2 tildelte udsagn efter runde 0');
  const alreadyAssignedTargets = p1Before.about.map(a => a.targetId);
  const extraTargetId = memberIds.find(id => id !== memberIds[1] && !alreadyAssignedTargets.includes(id));
  assert(extraTargetId, 'skal kunne finde et target P1 ikke allerede er tildelt (4 spillere, 2 tildelte -> mindst 1 tilbage)');
  await call(brokHandler, { action: 'personal', roomId, actorId: memberIds[1], aboutTexts: [...p1Before.about, { targetId: extraTargetId, text: 'EKSTRA frit udsagn, tilføjet EFTER runde 0' }] });
  const afterExtra = await getState(roomId);
  const p1After = afterExtra.personalLayer.entries[memberIds[1]];
  assert(p1After.about.length === 3, 'P1 skal nu have 3 udsagn (2 tildelte + 1 nyt frit), har ' + p1After.about.length);
  const oldOnesStillThere = p1Before.about.every(a => p1After.about.some(b => b.targetId === a.targetId && b.text === a.text));
  assert(oldOnesStillThere, 'de 2 oprindelige tildelte udsagn skal stadig være uændrede efter det frie tillæg');
  log('✅ Frit tillæg EFTER runde 0 lægger sig oveni (3 udsagn), intet af de 2 tildelte gik tabt');
}

async function testNodbremse() {
  log('--- 3. Nødbremse: kun 3 af 5 indsender, resten skal IKKE kunne blokere spillet ---');
  const { roomId, memberIds } = await setupRoom(5, 'kende_venner');
  const startRes = await call(gameHandler, { action: 'start', roomId, actorId: memberIds[0], playerIds: memberIds });
  const cur = startRes.state.game.current;
  for (let i = 0; i < 3; i++) {
    const id = memberIds[i];
    const targets = cur.assigned[id];
    const aboutTexts = targets.map(t => ({ targetId: t, text: 'Udsagn ' + id }));
    await call(gameHandler, { action: 'submit', roomId, actorId: id, payload: { aboutTexts } });
  }
  const stuck = await getState(roomId);
  assert(stuck.game.current.type === 'assign', 'skal stadig vente på de sidste 2');

  // Simulerer at nødbremsens fulde ur er løbet ud (BROKSPILLET_AUTO_MS + COMPLAINT_COUNTDOWN_MS)
  // ved at rykke phaseStartedAt langt tilbage i tiden, og en evt. eksisterende brok endnu længere.
  // Polles via det RIGTIGE endpoint (api/state.js) — samme vej klienten reelt bruger.
  const { BROKSPILLET_AUTO_MS, COMPLAINT_COUNTDOWN_MS } = require(path.join(__dirname, '..', 'api', '_lib', 'gameFlow.js'));
  stuck.game.current.phaseStartedAt = Date.now() - (BROKSPILLET_AUTO_MS + 1000);
  await setState(roomId, stuck);
  // Første poll udløser Brokspillets EGEN brok (synlig, men rykker endnu ikke videre)
  await pollState(roomId, memberIds[0]);
  const midState = await getState(roomId);
  assert(midState.game.current.complaint, 'Brokspillet skal selv have brokket sig over de manglende efter AUTO_MS');
  // Ryk brokkets starttidspunkt tilbage så COMPLAINT_COUNTDOWN_MS også er udløbet
  midState.game.current.complaint.startedAt = Date.now() - (COMPLAINT_COUNTDOWN_MS + 1000);
  await setState(roomId, midState);
  await pollState(roomId, memberIds[0]);
  const finalState = await getState(roomId);
  assert(finalState.game.current.type !== 'assign', 'nødbremsen skal have tvunget spillet videre selvom 2/5 aldrig indsendte, type er nu: ' + finalState.game.current.type);
  assert(finalState.game.round === 1, 'runden skal være gået i gang (runde 1)');
  // De 2 der missede skal IKKE have en personalLayer-entry (de nåede ikke at indsende)
  assert(!finalState.personalLayer.entries[memberIds[3]], 'P3 nåede ikke at indsende og skal derfor ikke have en entry');
  assert(!finalState.personalLayer.entries[memberIds[4]], 'P4 nåede ikke at indsende og skal derfor ikke have en entry');
  log('✅ Nødbremsen tvang spillet i gang uden de 2 manglende — INGEN blokering, som krævet');
}

async function testGuaranteedDrawIntegration() {
  log('--- 4. Garanteret udtræk hænger sammen med runde 0 i et helt spil ---');
  const { roomId, memberIds } = await setupRoom(6, 'kende_venner');
  let res = await call(gameHandler, { action: 'start', roomId, actorId: memberIds[0], playerIds: memberIds, totalRounds: 5 });
  const cur = res.state.game.current;
  assert(cur.type === 'assign', 'skal starte med runde 0');
  for (const id of memberIds) {
    const targets = cur.assigned[id];
    const aboutTexts = targets.map(t => ({ targetId: t, text: 'X om ' + t + ' fra ' + id }));
    res = await call(gameHandler, { action: 'submit', roomId, actorId: id, payload: { aboutTexts } });
  }
  assert(res.state.game.current.type !== 'assign', 'runde 1 skal være i gang efter runde 0');
  // Spil de 5 rigtige runder igennem med tilfældige/simple svar og tæl kendskab/hvemskrev
  let familyDrawn = 0;
  let guardCounter = 0;
  while (res.state.game.active && guardCounter < 200) {
    guardCounter++;
    const c = res.state.game.current;
    if (c.type === 'gameover') break;
    if (c.type === 'kendskab' || c.type === 'hvemskrev') familyDrawn++;
    // Simpel, generisk "gør noget for alle spillere for at rydde runden" — bruger 'ready' hvor muligt, ellers force via nødbremse-genvej
    if (c.phase === 'results' || c.phase === 'skipped') {
      // 'ready' er idempotent (samme spiller kan roligt kaldes flere gange
      // uden fejl) — ingen grund til at afbryde tidligt her, og en
      // reference-sammenligning på res.state.game.current ville ALTID være
      // ulig (mutateState returnerer et frisk, deep-clonet objekt hver
      // gang, uanset om runden reelt skiftede).
      for (const id of memberIds) {
        res = await call(gameHandler, { action: 'ready', roomId, actorId: id }).catch(() => res);
      }
      continue;
    }
    // For alt andet: brug nødbremsen (via det rigtige state.js-polling-
    // endpoint, se pollState) til at tvinge runden videre i stedet for at
    // duplikere hver rundetypes payload-logik her (dækket allerede af
    // playtest.js/test_kendskab_stress.js) — TO polls, ligesom i test 3
    // (Brokspillets egen brok, så selve tvangen).
    const fresh = await getState(roomId);
    if (fresh.game.current && fresh.game.current.phaseStartedAt) fresh.game.current.phaseStartedAt = Date.now() - 1e9;
    await setState(roomId, fresh);
    await pollState(roomId, memberIds[0]);
    const withComplaint = await getState(roomId);
    if (withComplaint.game.current && withComplaint.game.current.complaint) withComplaint.game.current.complaint.startedAt = Date.now() - 1e9;
    await setState(roomId, withComplaint);
    await pollState(roomId, memberIds[0]);
    const advanced = await getState(roomId);
    res = { state: advanced };
    if (!res.state.game.active) break;
  }
  assert(familyDrawn >= 2, 'kvoten for 5 runder er 2 — skal være nået mindst 2 kendskab/hvemskrev-runder, fik ' + familyDrawn);
  log('✅ Helt spil (runde 0 + 5 rigtige runder) via de ægte HTTP-handlere: ' + familyDrawn + ' kendskab/hvemskrev-runder trukket (kvote: 2)');
}

(async () => {
  console.log('=== Verifikation: runde 0 (tildelt venneark-udfyldelse) mod de ægte handlere ===\n');
  await testBasicAssignFlow();
  await testMergeNotOverwrite();
  await testNodbremse();
  await testGuaranteedDrawIntegration();
  console.log('\n✅ Alle 4 scenarier bestået.');
})().catch(e => { console.error('\n❌ ' + e.message); console.error(e.stack); process.exit(1); });
