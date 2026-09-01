#!/usr/bin/env node
// Spilbot-playtest-harness (se god-finding-men-du-lovely-zephyr.md,
// "Spilbot-playtest-harness"-afsnittet under Dommer-mekanismen).
//
// VIGTIG BEGRÆNSNING, dokumenteret ærligt: dette script kører IN-PROCESS
// direkte mod de eksporterede _lib-funktioner (samme funktioner som
// api/*.js's HTTP-handlere kalder), IKKE via rigtige HTTP-kald mod en
// kørende server med en rigtig Redis-forbindelse — der findes ingen live
// Redis i dette udviklingsmiljø. Det betyder: CAS-konflikt-håndtering
// (mutateState's retry-logik), det faktiske HTTP-lag, og push-
// notifikationer er IKKE dækket af denne playtest. Hvad DER er dækket:
// selve spil-logikken (state-mutation, fase-overgange, pulje-matematik)
// opfører sig identisk med hvad en rigtig klient ville udløse.
//
// DÆKNING LIGE NU (ærligt, ikke overdrevet):
//  ✅ Krukke-livscyklus: opret → join → anklage → bekræft (kvorum) → "Gør op"
//  ✅ Brokspillet: én fuld runde, alle 6 undertyper (quiplash/truefalse/
//     trivia/guessbrok/casinobrok/rose) håndteret generisk ud fra
//     state.game.current.type/phase, samme logik som api/game.js's
//     'submit'-handler.
//  ❌ MrBrok/Det Store Brokkeri fulde runde-drivere — IKKE bygget endnu.
//     Samme mønster (inspicér state.X.current.type/phase, kald samme
//     resolve*-funktioner som api/mrbrok.js/api/complainer.js) er den
//     oplagte næste udvidelse, men er bevidst ikke lavet i denne omgang
//     for ikke at levere en overfladisk/utestet driver under dække af at
//     være "færdig". Se TODO nederst i filen.
//
// BRUG:
//   node scripts/playtest.js <themeId> [--fast]
//   --fast: minimale delays (CI-brug). Uden: korte, men IKKE-nul delays
//   mellem bot-handlinger (se REALISTIC_DELAY_MS) — en stand-in for
//   menneske-lignende, ikke-synkron pacing, ikke bogstaveligt
//   menneske-hastighed (det ville gøre automatiserede kørsler upraktisk
//   langsomme). Ægte tidsbaserede udløbsstier (PENDING_EXPIRE_AFTER osv.)
//   kræver separat, målrettet test af tidsspring, ikke reel ventetid.

const path = require('path');
const store = require(path.join(__dirname, '..', 'api', '_lib', 'store'));
const game = require(path.join(__dirname, '..', 'api', '_lib', 'game'));
const gameFlow = require(path.join(__dirname, '..', 'api', '_lib', 'gameFlow'));
const mrbrok = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrok'));
const mrbrokFlow = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrokFlow'));
const complainer = require(path.join(__dirname, '..', 'api', '_lib', 'complainer'));
const complainerFlow = require(path.join(__dirname, '..', 'api', '_lib', 'complainerFlow'));

const FAST = process.argv.includes('--fast');
const REALISTIC_DELAY_MS = () => FAST ? 0 : 50 + Math.floor(Math.random() * 200);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) { console.log(`  ${msg}`); }
function assert(cond, msg) { if (!cond) throw new Error(`PLAYTEST-FEJL: ${msg}`); }

function makeBotState(themeId, botNames) {
  const state = store.emptyState();
  state.themeId = themeId;
  const opts = { themeId };
  Object.assign(state, opts);
  state.members = botNames.map(name => ({ id: store.uid(), name, isBot: true }));
  return state;
}

// --- Del 1: krukke-livscyklus ---
async function playtestKrukke(themeId, botNames) {
  log('--- Krukke-livscyklus ---');
  const state = makeBotState(themeId, botNames);
  const [admin, accused, third] = state.members;

  // Anklage + bekræftelse (kvorum, samme logik som api/brok.js's default-gren)
  const need = store.neededVotes(state.members.filter(m => !m.isBot).length || state.members.length);
  const pending = {
    id: store.uid(), memberId: accused.id, message: 'Testhændelse fra playtest',
    votes: [], openedAt: Date.now(), need,
  };
  state.pendingList.push(pending);
  await sleep(REALISTIC_DELAY_MS());

  // De to andre bekræfter (samme mutation som api/brok.js's 'vote'-gren)
  [admin.id, third.id].forEach(voterId => {
    if (voterId === pending.memberId) return;
    const idx = pending.votes.indexOf(voterId);
    if (idx === -1) pending.votes.push(voterId);
  });
  const confirmedIds = store.healPendingVotes(state);
  assert(confirmedIds.includes(pending.id), 'anklagen blev ikke bekræftet ind i puljen ved kvorum');
  assert(state.events.some(e => e.id === pending.id), 'hændelsen mangler i state.events efter bekræftelse');
  log(`✅ Anklage bekræftet og landet i puljen (${state.events.length} hændelse(r))`);

  await sleep(REALISTIC_DELAY_MS());
  const before = state.events.length;
  store.settleRound(state);
  assert(state.events.length === 0, '"Gør op" tømte ikke puljen');
  assert(state.history.length === 1 && state.history[0].total === before, 'historikken matcher ikke det opgjorte antal');
  log(`✅ "Gør op" arkiverede ${before} hændelse(r) korrekt, puljen er tom`);
  return state;
}

// --- Del 2: Brokspillet, én fuld runde, alle 6 undertyper håndteret ---
function botSubmitForRound(state, players) {
  const cur = state.game.current;
  const memberById = id => state.members.find(m => m.id === id);

  if (cur.type === 'quiplash' && cur.phase === 'answer') {
    cur.answers = cur.answers || {};
    players.forEach(id => { cur.answers[id] = `Testsvar fra ${memberById(id).name}`; });
    if (players.length === 2) gameFlow.resolveQuiplashRandom(state, cur);
    else {
      cur.phase = 'vote'; cur.votes = {};
      const decoys = game.pickQuiplashDecoys(state, players.length <= 3 ? 2 : 1);
      cur.decoys = decoys.map((text, i) => ({ id: 'decoy' + i, text }));
    }
    return;
  }
  if (cur.type === 'quiplash' && cur.phase === 'vote') {
    cur.votes = cur.votes || {};
    players.forEach(id => {
      const others = players.filter(p => p !== id);
      if (others.length) cur.votes[id] = others[Math.floor(Math.random() * others.length)];
    });
    gameFlow.resolveQuiplashVote(state, cur);
    return;
  }
  if (cur.type === 'truefalse' && cur.phase === 'write') {
    const targetId = players.find(p => p !== cur.authorId) || cur.authorId;
    cur.targetId = targetId; cur.statement = 'Testudsagn fra playtest'; cur.isTrue = true;
    cur.phase = 'guess';
    return;
  }
  if (cur.type === 'truefalse' && cur.phase === 'guess') {
    cur.guesses = cur.guesses || {};
    players.forEach(id => { if (id !== cur.authorId) cur.guesses[id] = Math.random() < 0.5; });
    gameFlow.resolveTrueFalseGuess(state, cur);
    return;
  }
  if (cur.type === 'trivia' && cur.phase === 'answer') {
    cur.choices = cur.choices || {};
    players.forEach(id => { cur.choices[id] = cur.correctIndex; }); // bots svarer altid rigtigt — tester flowet, ikke tilfældig scoring
    gameFlow.resolveTriviaAnswer(state, cur);
    return;
  }
  if (cur.type === 'guessbrok' && cur.phase === 'write') {
    const decoys = game.pickDecoyBroks(state, 3, 'Testbrok fra playtest');
    const { options, correctIndex } = game.buildOptions('Testbrok fra playtest', decoys);
    cur.statement = 'Testbrok fra playtest'; cur.options = options; cur.correctIndex = correctIndex;
    cur.phase = 'guess'; cur.guesses = {};
    return;
  }
  if (cur.type === 'guessbrok' && cur.phase === 'guess') {
    cur.guesses = cur.guesses || {};
    players.forEach(id => { if (id !== cur.authorId) cur.guesses[id] = cur.correctIndex; });
    gameFlow.resolveGuessBrok(state, cur);
    return;
  }
  if (cur.type === 'casinobrok' && cur.phase === 'write') {
    cur.words = cur.words || {};
    players.forEach(id => { cur.words[id] = 'testord'; });
    gameFlow.resolveCasinobrok(state, cur);
    return;
  }
  if (cur.type === 'casinobrok' && cur.phase === 'bet') {
    cur.bets = cur.bets || {};
    players.forEach(id => { if (cur.bets[id] === undefined) gameFlow.resolveCasinobrokBet(state, cur, id, 'safe'); });
    cur.phase = 'results';
    return;
  }
  if (cur.type === 'rose' && cur.phase === 'write') {
    cur.compliments = cur.compliments || {};
    players.forEach(id => { cur.compliments[id] = 'Du er super til playtests'; });
    gameFlow.transitionRoseToMatch(state, cur, players);
    return;
  }
  if (cur.type === 'rose' && cur.phase === 'match') {
    cur.guesses = cur.guesses || {};
    players.forEach(id => { cur.guesses[id] = {}; });
    gameFlow.resolveRoseMatch(state, cur, players);
    return;
  }
  throw new Error(`PLAYTEST-FEJL: ukendt runde-type/fase kombination: ${cur.type}/${cur.phase}`);
}

async function playtestBrokspillet(themeId, botNames) {
  log('--- Brokspillet, én fuld runde ---');
  const state = makeBotState(themeId, botNames);
  const players = state.members.map(m => m.id);
  const scores = {}; players.forEach(id => (scores[id] = 0));
  state.game = { active: true, wager: 'fun', players, round: 0, totalRounds: 5, scores, current: null, startedAt: Date.now() };
  game.beginRound(state, state.members);
  gameFlow.stampPhase(state.game.current);

  let guard = 0;
  const startType = state.game.current.type;
  while (state.game.current && state.game.current.phase !== 'results' && guard < 10) {
    await sleep(REALISTIC_DELAY_MS());
    botSubmitForRound(state, players);
    guard++;
  }
  assert(guard < 10, `runden nåede aldrig 'results'-fasen inden for ${guard} forsøg — mulig uendelig løkke i botSubmitForRound`);
  assert(state.game.current.phase === 'results', `forventede fase 'results', fik '${state.game.current && state.game.current.phase}'`);
  log(`✅ Runde-type '${startType}' fuldført til resultat-fasen uden fejl`);
  return state;
}

// --- Del 3: MrBrok, én fuld runde (clue → vote/steal → gameover) ---
// Spejler api/mrbrok.js's action-håndtering direkte mod _lib/mrbrokFlow.js,
// samme "kald samme resolve*-funktioner" mønster som botSubmitForRound
// ovenfor for Brokspillet — se TODO'en der tidligere stod her.
async function playtestMrBrok(themeId, botNames) {
  log('--- MrBrok, én fuld runde ---');
  const state = makeBotState(themeId, botNames);
  const playerObjs = state.members;
  const players = playerObjs.map(m => m.id);
  const mrBrokId = mrbrok.pickMrBrok(state, playerObjs).id;
  const scores = {};
  players.forEach(id => { if (id !== mrBrokId) scores[id] = 0; });
  state.mrbrok = {
    active: true, wager: 'fun', players, activeIds: players.slice(), eliminatedIds: [],
    mrBrokId, topic: mrbrok.pickTopic(state), warmupRounds: 2,
    round: 0, scores, caught: false, voteHistory: [], current: null, startedAt: Date.now(),
  };
  mrbrokFlow.beginClueRound(state, 1);

  let guard = 0;
  while (state.mrbrok.current.type !== 'gameover' && guard < 60) {
    const cur = state.mrbrok.current;
    if (cur.type === 'clue') {
      mrbrokFlow.advanceClue(state);
    } else if (cur.type === 'vote') {
      state.mrbrok.activeIds.forEach(id => {
        const others = state.mrbrok.activeIds.filter(p => p !== id);
        cur.votes[id] = others[Math.floor(Math.random() * others.length)];
      });
      mrbrokFlow.resolveVote(state);
    } else if (cur.type === 'steal' && !cur.guess) {
      cur.guess = 'Testgæt fra playtest';
    } else if (cur.type === 'steal' && cur.guess) {
      state.mrbrok.activeIds.forEach(id => { cur.votes[id] = Math.random() < 0.5; });
      mrbrokFlow.resolveSteal(state);
    } else {
      throw new Error(`PLAYTEST-FEJL: ukendt MrBrok-fase: ${cur.type}`);
    }
    guard++;
    await sleep(REALISTIC_DELAY_MS());
  }
  assert(guard < 60, `MrBrok nåede aldrig 'gameover' inden for ${guard} forsøg — mulig uendelig løkke`);
  assert(state.mrbrok.current.type === 'gameover', `forventede fase 'gameover', fik '${state.mrbrok.current && state.mrbrok.current.type}'`);
  log(`✅ MrBrok fuldført til gameover (mrBrokWon=${state.mrbrok.current.mrBrokWon})`);
  return state;
}

// --- Del 4: Det Store Brokkeri, én fuld runde (complain → vote → bet →
// ... → reveal → interrogation → guess → judge → gameover) ---
// Samme mønster, spejler api/complainer.js mod _lib/complainerFlow.js.
async function playtestComplainer(themeId, botNames) {
  log('--- Det Store Brokkeri, én fuld runde ---');
  const state = makeBotState(themeId, botNames);
  const playerObjs = state.members;
  const players = playerObjs.map(m => m.id);
  const { archetypes, situations } = complainer.assignArchetypesAndSituations(playerObjs, themeId);
  const guiltyId = players[Math.floor(Math.random() * players.length)];
  const scores = {}; const brokScores = {};
  players.forEach(id => { scores[id] = 0; brokScores[id] = 0; });
  const totalRounds = 3;
  state.complainer = {
    active: true, wager: 'fun', players, archetypes, situations, totalRounds,
    guiltyId, revealed: false, revealedAt: null,
    round: 0, scores, pendingGamble: null, lastGambleResult: null,
    brokScores, brokApprovals: {},
    challengeEnabled: true, challengeUsedBy: {},
    topSuspectHistory: [], history: [], usedPromptIds: {},
    current: null, startedAt: Date.now(),
  };
  complainerFlow.beginComplainRound(state, 1);

  let guard = 0;
  let challengeTested = false;
  while (state.complainer.current.type !== 'gameover' && guard < 80) {
    const c = state.complainer;
    const cur = c.current;
    if (cur.type === 'complain') {
      complainerFlow.advanceComplain(state);
    } else if (cur.type === 'interrogation') {
      complainerFlow.advanceInterrogation(state);
    } else if (cur.type === 'vote') {
      players.forEach(id => {
        const others = players.filter(p => p !== id);
        cur.votes[id] = others[Math.floor(Math.random() * others.length)];
      });
      complainerFlow.resolveSuspicionRound(state);
    } else if (cur.type === 'bet') {
      // EXPERIMENTAL "Udfordring" (se complainerFlow.js's
      // applyComplainerChallenge): afprøves PRÆCIS én gang, på første
      // bet-runde, af en spiller der ikke selv er topId — spejler
      // api/complainer.js's 'challenge'-handlers egne betingelser
      // (challengeEnabled, !cur.choice, actorId !== topId, ikke brugt før).
      if (!challengeTested && c.challengeEnabled && !cur.challenged) {
        const challenger = players.find(p => p !== cur.topId);
        if (challenger) {
          complainerFlow.applyComplainerChallenge(state, challenger);
          challengeTested = true;
          assert(cur.challenged === true, 'Udfordring blev ikke registreret på cur.challenged');
          assert(cur.stakeMultiplier === 2, `Udfordring skulle fordoble stakeMultiplier, fik ${cur.stakeMultiplier}`);
        }
      }
      cur.choice = 'safe';
      complainerFlow.resolveBet(state);
    } else if (cur.type === 'guess') {
      const others = players.filter(p => p !== guiltyId);
      complainerFlow.submitGuess(state, others[Math.floor(Math.random() * others.length)], 'Testdetalje fra playtest');
    } else if (cur.type === 'judge') {
      players.filter(p => p !== guiltyId).forEach(id => { cur.votes[id] = Math.random() < 0.5; });
      complainerFlow.resolveJudge(state);
    } else {
      throw new Error(`PLAYTEST-FEJL: ukendt Det Store Brokkeri-fase: ${cur.type}`);
    }
    guard++;
    await sleep(REALISTIC_DELAY_MS());
  }
  assert(guard < 80, `Det Store Brokkeri nåede aldrig 'gameover' inden for ${guard} forsøg — mulig uendelig løkke`);
  assert(state.complainer.current.type === 'gameover', `forventede fase 'gameover', fik '${state.complainer.current && state.complainer.current.type}'`);
  assert(challengeTested, 'EXPERIMENTAL "Udfordring" blev aldrig afprøvet — ingen bet-runde med en ikke-topId-spiller opstod');
  log(`✅ Det Store Brokkeri fuldført til gameover (guiltyWon=${state.complainer.current.guiltyWon}), inkl. EXPERIMENTAL "Udfordring"`);
  return state;
}

async function main() {
  const themeId = process.argv[2];
  if (!themeId || themeId.startsWith('--')) {
    console.error('Brug: node scripts/playtest.js <themeId> [--fast]');
    process.exit(1);
  }
  const botNames = ['TestBot Anna', 'TestBot Bo', 'TestBot Casper'];
  console.log(`\n=== Playtest, tema: ${themeId} (${FAST ? 'hurtig' : 'realistisk timing'}) ===`);
  try {
    await playtestKrukke(themeId, botNames);
    await playtestBrokspillet(themeId, botNames);
    await playtestMrBrok(themeId, botNames);
    await playtestComplainer(themeId, botNames);
    console.log(`\n✅ Alle dækkede scenarier bestået for tema '${themeId}'.\n`);
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { playtestKrukke, playtestBrokspillet, playtestMrBrok, playtestComplainer, makeBotState };

// Tidligere TODO'er, nu lukket:
// - Ægte tidsudløbstest: se scripts/test_time_expiry.js (bagdaterede
//   tidsstempler mod PENDING_EXPIRE_AFTER/BROKSPILLET_AUTO_MS/
//   MRBROK_COMPLAINT_COUNTDOWN_MS/COMPLAINT_COUNTDOWN_MS).
// - EXPERIMENTAL "Udfordring": nu dækket inde i playtestComplainer ovenfor
//   (afprøves præcis én gang, første bet-runde).
