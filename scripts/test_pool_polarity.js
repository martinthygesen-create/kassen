#!/usr/bin/env node
// poolPolarity-verifikation (se KASSEMOTORPLAN.md's "Ny variabel fundet:
// poolPolarity"-afsnit). VIGTIGT FUND ved skrivning af denne test: INGEN
// eksisterende test (playtest.js's drivere bruger altid wager:'fun') rørte
// nogensinde reward-forgreningen i endGame/endMrbrokGame/endComplainerGame —
// kun wager:'euro' rammer isReward-koden overhovedet. Denne fil lukker det
// hul eksplicit, for alle tre spil, begge polariteter (så en regression i
// 'punishment'-grenen også fanges, ikke kun 'reward').
//
// BRUG: node scripts/test_pool_polarity.js

const path = require('path');
const store = require(path.join(__dirname, '..', 'api', '_lib', 'store'));
const gameFlow = require(path.join(__dirname, '..', 'api', '_lib', 'gameFlow'));
const mrbrokFlow = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrokFlow'));
const complainerFlow = require(path.join(__dirname, '..', 'api', '_lib', 'complainerFlow'));

function log(msg) { console.log(`  ${msg}`); }
function assert(cond, msg) { if (!cond) throw new Error(`POLARITY-FEJL: ${msg}`); }
function makeMembers(n) { return Array.from({ length: n }, (_, i) => ({ id: store.uid(), name: `Bot${i}` })); }

function eventFor(state, memberId) { return state.events.find(e => e.memberId === memberId && e.gameLoss); }

// --- Brokspillet ---
function testBrokspillet(poolPolarity) {
  const members = makeMembers(3);
  const [winner, loser1, loser2] = members;
  const state = store.emptyState();
  state.members = members;
  state.poolPolarity = poolPolarity;
  state.game = {
    active: true, wager: 'euro', players: members.map(m => m.id), round: 3, totalRounds: 3,
    scores: { [winner.id]: 10, [loser1.id]: 2, [loser2.id]: 2 },
  };
  gameFlow.endGame(state);
  const isReward = poolPolarity === 'reward';
  const winnerCredited = !!eventFor(state, winner.id);
  const loserCredited = !!eventFor(state, loser1.id);
  if (isReward) {
    assert(winnerCredited, 'reward: vinderen blev IKKE krediteret');
    assert(!loserCredited, 'reward: taberen blev fejlagtigt krediteret');
    assert(eventFor(state, winner.id).message.startsWith('Vandt'), 'reward: forkert besked, forventede "Vandt..."');
  } else {
    assert(!winnerCredited, 'punishment: vinderen blev fejlagtigt krediteret');
    assert(loserCredited, 'punishment: taberen blev IKKE krediteret');
    assert(eventFor(state, loser1.id).message.startsWith('Tabte'), 'punishment: forkert besked, forventede "Tabte..."');
  }
}

// --- MrBrok ---
function testMrbrok(poolPolarity) {
  const members = makeMembers(3);
  const mrBrokId = members[0].id;
  const state = store.emptyState();
  state.members = members;
  state.poolPolarity = poolPolarity;
  state.mrbrok = {
    active: true, wager: 'euro', players: members.map(m => m.id), mrBrokId,
    topic: 'test', current: { type: 'steal', guess: 'test' }, scores: {},
  };
  mrbrokFlow.endMrbrokGame(state, true); // mrBrok vandt (undslap/gættede rigtigt)
  const isReward = poolPolarity === 'reward';
  const mrBrokCredited = !!eventFor(state, mrBrokId);
  const othersCredited = members.slice(1).some(m => eventFor(state, m.id));
  if (isReward) {
    assert(mrBrokCredited, 'reward: MrBrok (vinderen) blev IKKE krediteret');
    assert(!othersCredited, 'reward: de andre (taberne) blev fejlagtigt krediteret');
  } else {
    assert(!mrBrokCredited, 'punishment: MrBrok blev fejlagtigt krediteret selvom de vandt');
    assert(othersCredited, 'punishment: taberne blev IKKE krediteret');
  }
}

// --- Det Store Brokkeri ---
function testComplainer(poolPolarity) {
  const members = makeMembers(3);
  const guiltyId = members[0].id;
  const state = store.emptyState();
  state.members = members;
  state.poolPolarity = poolPolarity;
  state.complainer = {
    active: true, wager: 'euro', players: members.map(m => m.id), guiltyId,
    current: { targetId: members[1].id, detail: 'test', votes: {} }, scores: {},
  };
  complainerFlow.endComplainerGame(state, true); // Den Store Brokker (guiltyId) vandt (undslap)
  const isReward = poolPolarity === 'reward';
  const guiltyCredited = !!eventFor(state, guiltyId);
  const othersCredited = members.slice(1).some(m => eventFor(state, m.id));
  if (isReward) {
    assert(guiltyCredited, 'reward: Den Store Brokker (vinderen) blev IKKE krediteret');
    assert(!othersCredited, 'reward: de andre blev fejlagtigt krediteret');
  } else {
    assert(!guiltyCredited, 'punishment: Den Store Brokker blev fejlagtigt krediteret selvom de vandt');
    assert(othersCredited, 'punishment: de andre blev IKKE krediteret');
  }
}

function main() {
  console.log('\n=== poolPolarity-verifikation (reward vs. punishment, alle tre spil) ===');
  try {
    ['punishment', 'reward'].forEach(p => {
      testBrokspillet(p);
      log(`✅ Brokspillet: ${p}-polaritet krediterer korrekt`);
      testMrbrok(p);
      log(`✅ MrBrok: ${p}-polaritet krediterer korrekt`);
      testComplainer(p);
      log(`✅ Det Store Brokkeri: ${p}-polaritet krediterer korrekt`);
    });
    console.log('\n✅ Begge polariteter verificeret korrekt for alle tre spil.\n');
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { testBrokspillet, testMrbrok, testComplainer };
