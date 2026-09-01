#!/usr/bin/env node
// Ægte tidsudløbstest (dokumenteret mangel i playtest.js's header, se
// KASSEMOTORPLAN.md's "Realistisk timing"-afsnit: "Ægte tidsbaserede
// udløbsstier... kræver separat, målrettet test af tidsspring, ikke reel
// ventetid"). I stedet for at vente timer/minutter i virkeligheden,
// bagdaterer denne test de relevante tidsstempler direkte (openedAt,
// phaseStartedAt, complaint.startedAt) og kalder de samme opportunistiske
// expire-funktioner api/state.js selv kalder ved hver poll — ingen fake
// clock/mock nødvendig, da funktionerne kun sammenligner MOD Date.now(),
// aldrig sætter det.
//
// BRUG: node scripts/test_time_expiry.js
// Exit code 0 = alle udløbsstier verificeret, 1 = fejl.

const path = require('path');
const store = require(path.join(__dirname, '..', 'api', '_lib', 'store'));
const gameFlow = require(path.join(__dirname, '..', 'api', '_lib', 'gameFlow'));
const mrbrokFlow = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrokFlow'));
const complainerFlow = require(path.join(__dirname, '..', 'api', '_lib', 'complainerFlow'));
const mrbrok = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrok'));
const complainer = require(path.join(__dirname, '..', 'api', '_lib', 'complainer'));

function log(msg) { console.log(`  ${msg}`); }
function assert(cond, msg) { if (!cond) throw new Error(`TIDSUDLØB-FEJL: ${msg}`); }

function makeMembers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: store.uid(), name: `Bot${i}`, isBot: true }));
}

// --- 1: krukke — påmindelse efter 12t, automatisk frikendelse efter 24t ---
function testKrukkeExpiry() {
  log('--- Krukke: PENDING_REMINDER_AFTER/PENDING_EXPIRE_AFTER ---');
  const state = store.emptyState();
  state.members = makeMembers(3);
  const [a, b, c] = state.members;

  // Lige under reminder-grænsen: ingen påmindelse endnu.
  state.pendingList = [{ id: store.uid(), memberId: a.id, message: 'test', votes: [], openedAt: Date.now() - (store.PENDING_REMINDER_AFTER - 60000), need: 2 }];
  let due = store.processPendingExpiry(state);
  assert(due.length === 0, 'påmindelse udløste for tidligt (lige under grænsen)');
  log('✅ Ingen påmindelse før 12t');

  // Over reminder-grænsen, under expire-grænsen: påmindelse, men stadig aktiv.
  state.pendingList = [{ id: store.uid(), memberId: a.id, message: 'test', votes: [], openedAt: Date.now() - (store.PENDING_REMINDER_AFTER + 60000), need: 2 }];
  due = store.processPendingExpiry(state);
  assert(due.length === 1, `forventede 1 påmindelse, fik ${due.length}`);
  assert(state.pendingList.length === 1, 'anklagen forsvandt for tidligt (skulle kun mindes om, ikke udløbe)');
  log('✅ Påmindelse udløser korrekt efter 12t, anklagen forbliver aktiv');

  // Over expire-grænsen: anklagen frikendes automatisk, havner i acquittals.
  state.acquittals = [];
  state.pendingList = [{ id: store.uid(), memberId: a.id, message: 'test', votes: [], openedAt: Date.now() - (store.PENDING_EXPIRE_AFTER + 60000), need: 2 }];
  due = store.processPendingExpiry(state);
  assert(state.pendingList.length === 0, 'anklagen udløb ikke efter 24t');
  assert(state.acquittals.length === 1, 'anklagen landede ikke i acquittals ved udløb');
  log('✅ Anklage frikendes automatisk efter 24t og lander i acquittals');
}

// --- 2: Brokspillet — BROKSPILLET_AUTO_MS (75s) + COMPLAINT_COUNTDOWN_MS (12s) ---
function testBrokspilletExpiry() {
  log('--- Brokspillet: BROKSPILLET_AUTO_MS/COMPLAINT_COUNTDOWN_MS ---');
  const players = makeMembers(3).map(m => m.id);
  const state = store.emptyState();
  state.game = {
    active: true, wager: 'fun', players, round: 1, totalRounds: 5, scores: {},
    current: { type: 'quiplash', phase: 'answer', answers: {}, phaseStartedAt: Date.now() },
  };

  let due = gameFlow.expireGamePhaseIfDue(state, players);
  assert(due === false, 'fasen tvang sig videre for tidligt (frisk phaseStartedAt)');
  log('✅ Ingen tvungen fremdrift lige efter faseskift');

  state.game.current.phaseStartedAt = Date.now() - (gameFlow.BROKSPILLET_AUTO_MS + 1000);
  due = gameFlow.expireGamePhaseIfDue(state, players);
  assert(due === true, 'automatisk brok blev ikke oprettet efter BROKSPILLET_AUTO_MS');
  assert(state.game.current.complaint, 'complaint mangler efter udløst nødbremse');
  log('✅ Automatisk "brok" oprettes korrekt efter 75s uden svar');

  due = gameFlow.expireGamePhaseIfDue(state, players);
  assert(due === false, 'fasen tvang sig videre for tidligt (frisk complaint.startedAt)');

  state.game.current.complaint.startedAt = Date.now() - (gameFlow.COMPLAINT_COUNTDOWN_MS + 1000);
  const phaseBefore = state.game.current.phase;
  due = gameFlow.expireGamePhaseIfDue(state, players);
  assert(due === true, 'fasen blev ikke tvunget videre efter COMPLAINT_COUNTDOWN_MS');
  assert(state.game.current.phase !== phaseBefore || state.game.current.type !== 'quiplash', 'fasen ser ikke ud til at være rykket videre');
  log('✅ Fasen tvinges korrekt videre efter yderligere 12s nedtælling');
}

// --- 3: MrBrok — MRBROK_COMPLAINT_COUNTDOWN_MS (30s, længere end Brokspillets) ---
function testMrbrokExpiry() {
  log('--- MrBrok: BROKSPILLET_AUTO_MS + MrBroks egen 30s-nedtælling ---');
  const memberObjs = makeMembers(3);
  const players = memberObjs.map(m => m.id);
  const mrBrokId = players[0];
  const state = store.emptyState();
  state.members = memberObjs;
  state.mrbrok = {
    active: true, wager: 'fun', players, activeIds: players.slice(), eliminatedIds: [],
    mrBrokId, topic: 'test', warmupRounds: 2, round: 1, scores: {}, caught: false, voteHistory: [],
    current: { type: 'clue', round: 1, order: players, turnIndex: 0, speakerId: players[0], phaseStartedAt: Date.now() },
  };

  let due = mrbrokFlow.expireMrbrokPhaseIfDue(state);
  assert(due === false, 'MrBrok-fasen tvang sig videre for tidligt');

  state.mrbrok.current.phaseStartedAt = Date.now() - (gameFlow.BROKSPILLET_AUTO_MS + 1000);
  due = mrbrokFlow.expireMrbrokPhaseIfDue(state);
  assert(due === true && state.mrbrok.current.complaint, 'automatisk brok mangler for MrBrok efter BROKSPILLET_AUTO_MS');
  log('✅ Automatisk "brok" oprettes korrekt for MrBrok efter 75s');

  // MrBroks EGEN, længere nedtælling (30s, ikke Brokspillets 12s) — den
  // vigtige forskel denne test faktisk beviser, ikke bare kopierer.
  state.mrbrok.current.complaint.startedAt = Date.now() - 20000; // over Brokspillets 12s, UNDER MrBroks 30s
  due = mrbrokFlow.expireMrbrokPhaseIfDue(state);
  assert(due === false, 'MrBrok brugte Brokspillets 12s-nedtælling i stedet for sin egen 30s (regression)');
  log('✅ MrBrok bruger korrekt sin egen længere 30s-nedtælling, ikke Brokspillets 12s');

  state.mrbrok.current.complaint.startedAt = Date.now() - 31000;
  const speakerBefore = state.mrbrok.current.speakerId;
  due = mrbrokFlow.expireMrbrokPhaseIfDue(state);
  assert(due === true, 'MrBrok-fasen blev ikke tvunget videre efter egen 30s-nedtælling');
  assert(state.mrbrok.current.speakerId !== speakerBefore, 'turen rykkede ikke videre efter tvunget fremdrift');
  log('✅ MrBrok-fasen tvinges korrekt videre efter 30s');
}

// --- 4: Det Store Brokkeri — samme COMPLAINT_COUNTDOWN_MS som Brokspillet ---
function testComplainerExpiry() {
  log('--- Det Store Brokkeri: BROKSPILLET_AUTO_MS + COMPLAINT_COUNTDOWN_MS ---');
  const memberObjs = makeMembers(3);
  const players = memberObjs.map(m => m.id);
  const { archetypes, situations } = complainer.assignArchetypesAndSituations(memberObjs, 'brok');
  const state = store.emptyState();
  state.members = memberObjs;
  state.complainer = {
    active: true, wager: 'fun', players, archetypes, situations, totalRounds: 3,
    guiltyId: players[0], revealed: false, round: 1, scores: {}, pendingGamble: null,
    brokScores: {}, brokApprovals: {}, challengeEnabled: true, challengeUsedBy: {},
    topSuspectHistory: [], history: [], usedPromptIds: {},
    current: { type: 'complain', round: 1, order: players, turnIndex: 0, speakerId: players[0], prompts: {}, phaseStartedAt: Date.now() },
  };

  let due = complainerFlow.expireComplainerPhaseIfDue(state);
  assert(due === false, 'Det Store Brokkeri-fasen tvang sig videre for tidligt');

  state.complainer.current.phaseStartedAt = Date.now() - (gameFlow.BROKSPILLET_AUTO_MS + 1000);
  due = complainerFlow.expireComplainerPhaseIfDue(state);
  assert(due === true && state.complainer.current.complaint, 'automatisk brok mangler for Det Store Brokkeri efter BROKSPILLET_AUTO_MS');
  log('✅ Automatisk "brok" oprettes korrekt efter 75s');

  state.complainer.current.complaint.startedAt = Date.now() - (complainerFlow.COMPLAINT_COUNTDOWN_MS + 1000);
  const speakerBefore = state.complainer.current.speakerId;
  due = complainerFlow.expireComplainerPhaseIfDue(state);
  assert(due === true, 'Det Store Brokkeri-fasen blev ikke tvunget videre efter COMPLAINT_COUNTDOWN_MS');
  assert(state.complainer.current.speakerId !== speakerBefore, 'turen rykkede ikke videre efter tvunget fremdrift');
  log('✅ Fasen tvinges korrekt videre efter 12s (samme nedtælling som Brokspillet)');
}

function main() {
  console.log('\n=== Ægte tidsudløbstest (bagdaterede tidsstempler, ingen reel ventetid) ===');
  try {
    testKrukkeExpiry();
    testBrokspilletExpiry();
    testMrbrokExpiry();
    testComplainerExpiry();
    console.log('\n✅ Alle tidsudløbsstier verificeret.\n');
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { testKrukkeExpiry, testBrokspilletExpiry, testMrbrokExpiry, testComplainerExpiry };
