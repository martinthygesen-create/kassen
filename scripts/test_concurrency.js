#!/usr/bin/env node
// Concurrency-verifikation (opdaget under et autonomt teknisk rette-loop,
// ikke gættet på forhånd): api/room.js's 'join'-handler brugte tidligere
// almindelig getState+setState i stedet for den CAS-beskyttede
// mutateState — to SAMTIDIGE join-kald med samme navn (fx et dobbeltklik,
// eller to browserfaner der joiner i samme øjeblik) kunne begge nå at
// læse "navnet findes ikke" FØR nogen af dem skrev, og skabe to
// duplikerede medlemmer. Denne test kører de rigtige handlers i ægte
// parallelle Promise.all-kald (ikke i serie) mod en delt in-memory
// redis-mock, for at bevise raceet reelt er lukket, ikke bare "ser
// rigtigt ud" i kildekoden.
//
// BRUG: node scripts/test_concurrency.js

const path = require('path');

// In-memory redis-mock — matcher kun det api/_lib/store.js reelt kalder
// (get/set/eval for CAS-scriptet), samme minimale kontrakt som
// @upstash/redis's REST-klient.
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

function log(msg) { console.log(`  ${msg}`); }
function assert(cond, msg) { if (!cond) throw new Error(`CONCURRENCY-FEJL: ${msg}`); }
function fakeRes() { const res = {}; res.status = c => { res.code = c; return res; }; res.json = o => { res.body = o; }; return res; }

async function testDuplicateJoinRace() {
  log('--- Samtidige join-kald med SAMME navn (dobbeltklik-scenarie) ---');
  let res = fakeRes();
  await roomHandler({ method: 'POST', body: {} }, res);
  const roomId = res.body.roomId;

  // Rummets opretter skal ind først (ellers rammer vi accessModel-stien,
  // ikke selve raceet vi vil teste).
  res = fakeRes();
  await roomHandler({ method: 'POST', body: { action: 'join', roomId, name: 'Admin' } }, res);

  // 10 SAMTIDIGE join-forsøg med PRÆCIS samme navn — simulerer et
  // dobbeltklik (eller værre, mange klik) før første svar er nået tilbage.
  const results = await Promise.all(Array.from({ length: 10 }, () => {
    const r = fakeRes();
    return roomHandler({ method: 'POST', body: { action: 'join', roomId, name: 'Racer' } }, r).then(() => r);
  }));

  const memberIds = new Set(results.map(r => r.body.memberId));
  assert(memberIds.size === 1, `forventede PRÆCIS ét unikt memberId på tværs af 10 samtidige joins, fik ${memberIds.size}: ${[...memberIds].join(', ')}`);

  // Verificér direkte i selve state at der KUN findes ét medlem med navnet.
  const finalRaw = mockInstance.store.get(`brokkekassen:room:${roomId}`);
  const finalState = JSON.parse(finalRaw);
  const racerMembers = finalState.members.filter(m => m.name.toLowerCase() === 'racer');
  assert(racerMembers.length === 1, `forventede 1 medlem ved navn 'Racer' i den endelige state, fandt ${racerMembers.length}`);
  log(`✅ 10 samtidige joins med samme navn resulterede korrekt i ÉT medlem (memberId=${[...memberIds][0]})`);
}

async function testDuplicateJoinRaceWithApproval() {
  log('--- Samme race, men under accessModel:approval (pendingMembers-stien) ---');
  let res = fakeRes();
  await roomHandler({ method: 'POST', body: { accessModel: 'approval' } }, res);
  const roomId = res.body.roomId;

  res = fakeRes();
  await roomHandler({ method: 'POST', body: { action: 'join', roomId, name: 'Admin' } }, res);

  const results = await Promise.all(Array.from({ length: 10 }, () => {
    const r = fakeRes();
    return roomHandler({ method: 'POST', body: { action: 'join', roomId, name: 'NyBruger' } }, r).then(() => r);
  }));

  const pendingIds = new Set(results.map(r => r.body.pendingId));
  assert(pendingIds.size === 1, `forventede PRÆCIS ét unikt pendingId på tværs af 10 samtidige joins, fik ${pendingIds.size}`);

  const finalRaw = mockInstance.store.get(`brokkekassen:room:${roomId}`);
  const finalState = JSON.parse(finalRaw);
  const pendingEntries = finalState.pendingMembers.filter(p => p.name.toLowerCase() === 'nybruger');
  assert(pendingEntries.length === 1, `forventede 1 ventende anmodning ved navn 'NyBruger', fandt ${pendingEntries.length}`);
  log(`✅ 10 samtidige joins under godkendelse resulterede korrekt i ÉN ventende anmodning`);
}

async function main() {
  console.log('\n=== Concurrency-verifikation (ægte parallelle Promise.all-kald) ===');
  try {
    await testDuplicateJoinRace();
    await testDuplicateJoinRaceWithApproval();
    console.log('\n✅ Ingen race conditions fundet i join-handleren.\n');
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();
