#!/usr/bin/env node
// Stress-test af Vennekassens personlige lag + "kendskab"/"hvemskrev"-
// rundetyperne (se CLAUDE.md, "Mini-spil-kvalitet"-afsnittet — samme
// filosofi som quizmaster-audit'en: KØR mange rigtige simulerede spil
// direkte mod _lib-motorerne, ikke bare læs koden). Dækker fire ting,
// adskilt fra scripts/playtest.js (som kun kører ÉN runde, ikke et helt
// spil):
//
//  1. FLOW: hænger et helt spil sammen fra start til gameover, over mange
//     kørsler, forskellige spillerantal (inkl. lige præcis 2/3, de kendte
//     kanter hvor forfatter(+target) kunne opsluge alle spillere) og
//     varierende mængder personligt-lag-indhold (under/på/over tærsklen)?
//  2. TEMA: bliver 'kendskab'/'hvemskrev' KUN trukket i Vennekassens to
//     themeId'er (kende_venner, det legacy-alias kende_kolleger), og
//     respekterer kende_kolleger sin egen ekskluderingsliste (quiplash/rose)?
//     Ingen tema-"spring" ind i forkert indhold.
//  3. INDHOLD: er der nogensinde for få gyldige gættere til en trukket
//     kandidat (ville hænge runden permanent, se collectAboutCandidates'
//     eligibleGuessers-krav)?
//  4. VÆGTNING: udgør kendskab+hvemskrev samlet ~22-30% af trukne runder i
//     spil hvor de er eligible (Martins ønske: 1/3-1/4, ikke 50%)?
//
// Kører KUN mod _lib-funktionerne (samme begrænsning som playtest.js — se
// dets header for hvorfor: ingen live Redis i dette miljø).

const path = require('path');
const store = require(path.join(__dirname, '..', 'api', '_lib', 'store'));
const game = require(path.join(__dirname, '..', 'api', '_lib', 'game'));
const gameFlow = require(path.join(__dirname, '..', 'api', '_lib', 'gameFlow'));

function assert(cond, msg) { if (!cond) throw new Error(`STRESS-FEJL: ${msg}`); }

function makeMembers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: store.uid(), name: `Bot${i + 1}`, isBot: true }));
}

// Seeder det personlige lag med en variabel mængde indhold. "sparse" er
// BEVIDST holdt til PRÆCIS 2 kandidater (kun de to første forfattere skriver
// ét "about" hver) — strengt under MIN_ABOUT_FOR_KENDSKAB (=3), så
// tærskel-kontrollen nedenfor reelt tester noget. "full" giver rigeligt
// (2 om andre pr. forfatter, alle med).
function seedPersonalLayer(members, density) {
  const ids = members.map(m => m.id);
  const entries = {};
  ids.forEach((authorId, i) => {
    const others = ids.filter(id => id !== authorId);
    let about = [];
    if (density === 'none') about = [];
    else if (density === 'sparse') about = (i < 2 && others.length) ? [{ targetId: others[0], text: `Sparsomt udsagn om ${others[0]}` }] : [];
    else about = others.slice(0, 2).map(t => ({ targetId: t, text: `Fyldigt udsagn om ${t}` }));
    entries[authorId] = { submittedAt: Date.now(), self: `Om Bot${i + 1} selv`, about };
  });
  return { entries };
}

// Generisk auto-driver — dækker ALLE 8 rundetyper, samme resolve*-kald som
// api/game.js's 'submit'-handler bruger. Adskilt fra playtest.js's egen
// (identiske) version for at holde de to scripts uafhængige af hinanden.
function autoSubmitRound(state, players) {
  const cur = state.game.current;
  if (cur.type === 'quiplash' && cur.phase === 'answer') {
    cur.answers = cur.answers || {};
    players.forEach(id => { cur.answers[id] = `Testsvar ${id}`; });
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
    cur.targetId = players.find(p => p !== cur.authorId) || cur.authorId;
    cur.statement = 'Teststatement'; cur.isTrue = Math.random() < 0.5;
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
    players.forEach(id => { cur.choices[id] = Math.random() < 0.5 ? cur.correctIndex : (cur.correctIndex + 1) % (cur.options ? cur.options.length : 4); });
    gameFlow.resolveTriviaAnswer(state, cur);
    return;
  }
  if (cur.type === 'guessbrok' && cur.phase === 'write') {
    const decoys = game.pickDecoyBroks(state, 3, 'Testbrok');
    const { options, correctIndex } = game.buildOptions('Testbrok', decoys);
    cur.statement = 'Testbrok'; cur.options = options; cur.correctIndex = correctIndex;
    cur.phase = 'guess'; cur.guesses = {};
    return;
  }
  if (cur.type === 'guessbrok' && cur.phase === 'guess') {
    cur.guesses = cur.guesses || {};
    players.forEach(id => { if (id !== cur.authorId) cur.guesses[id] = Math.random() < 0.6 ? cur.correctIndex : 0; });
    gameFlow.resolveGuessBrok(state, cur);
    return;
  }
  if (cur.type === 'casinobrok' && cur.phase === 'write') {
    cur.words = cur.words || {};
    players.forEach(id => { cur.words[id] = 'ord'; });
    gameFlow.resolveCasinobrok(state, cur);
    return;
  }
  if (cur.type === 'casinobrok' && cur.phase === 'bet') {
    cur.bets = cur.bets || {};
    players.forEach(id => { if (cur.bets[id] === undefined) gameFlow.resolveCasinobrokBet(state, cur, id, Math.random() < 0.5 ? 'gamble' : 'safe'); });
    cur.phase = 'results';
    return;
  }
  if (cur.type === 'rose' && cur.phase === 'write') {
    cur.compliments = cur.compliments || {};
    players.forEach(id => { cur.compliments[id] = 'Overdreven ros'; });
    gameFlow.transitionRoseToMatch(state, cur, players);
    return;
  }
  if (cur.type === 'rose' && cur.phase === 'match') {
    cur.guesses = cur.guesses || {};
    players.forEach(id => { cur.guesses[id] = {}; });
    gameFlow.resolveRoseMatch(state, cur, players);
    return;
  }
  if (cur.type === 'selvindsigt' && cur.phase === 'vote') {
    players.forEach(id => {
      if (id === cur.predictorId) {
        const others = players.filter(p => p !== id);
        cur.predictorGuess = others.length ? others[Math.floor(Math.random() * others.length)] : id;
      } else {
        cur.votes[id] = players[Math.floor(Math.random() * players.length)];
      }
    });
    gameFlow.resolveSelvindsigt(state, cur, players);
    return;
  }
  if (cur.type === 'kendskab' && cur.phase === 'guess') {
    cur.guesses = cur.guesses || {};
    const eligible = players.filter(id => id !== cur.authorId && id !== cur.targetId);
    assert(eligible.length >= 2, `kendskab-runde trukket med under 2 gyldige gættere (spillere=${players.length}, author=${cur.authorId}, target=${cur.targetId}) — quizmaster-fund: for tyndt valgrum når gætterens eget navn altid er blandt options`);
    eligible.forEach(id => { cur.guesses[id] = Math.random() < 0.5 ? cur.correctIndex : 0; });
    gameFlow.resolveKendskab(state, cur);
    return;
  }
  if (cur.type === 'hvemskrev' && cur.phase === 'guess') {
    cur.guesses = cur.guesses || {};
    const eligible = players.filter(id => id !== cur.authorId);
    assert(eligible.length >= 3, `hvemskrev-runde trukket med under 3 gyldige gættere (spillere=${players.length}, author=${cur.authorId})`);
    eligible.forEach(id => { cur.guesses[id] = Math.random() < 0.5 ? cur.correctIndex : 0; });
    gameFlow.resolveHvemskrev(state, cur);
    return;
  }
  throw new Error(`STRESS-FEJL: ukendt runde-type/fase kombination: ${cur.type}/${cur.phase}`);
}

const KENDSKAB_THEMES = ['kende_venner', 'kende_kolleger'];
const EXCLUDED_BY_THEME = { kende_kolleger: ['quiplash', 'rose'] };

function playOneGame(themeId, playerCount, density, totalRounds) {
  const members = makeMembers(playerCount);
  const state = store.emptyState();
  state.themeId = themeId;
  state.members = members;
  state.events = []; state.history = [];
  state.personalLayer = seedPersonalLayer(members, density);
  const players = members.map(m => m.id);
  const scores = {}; players.forEach(id => (scores[id] = 0));
  state.game = { active: true, wager: 'fun', players, round: 0, totalRounds, scores, current: null, startedAt: Date.now() };

  const typesSeen = [];
  let guard = 0;
  const MAX_STEPS = totalRounds * 12; // rigelig margin pr. runde til fase-skift
  game.beginRound(state, members);
  gameFlow.stampPhase(state.game.current);

  while (state.game.current && state.game.current.type !== 'gameover' && guard < MAX_STEPS) {
    const cur = state.game.current;
    if (cur.phase === 'results' || cur.phase === 'skipped') {
      gameFlow.goToNextRoundOrEnd(state, players);
      guard++;
      continue;
    }
    const type = cur.type;
    autoSubmitRound(state, players);
    if (state.game.current.type === type && state.game.current.phase !== 'results' && state.game.current.phase !== 'skipped') {
      // multi-fase runde (fx guessbrok write->guess, rose write->match) —
      // stemplet igen så en evt. nødbremse-tjek andetsteds ikke ser en
      // gammel fase-starttid.
      gameFlow.stampPhase(state.game.current);
    }
    typesSeen.push(type);
    guard++;
  }

  assert(guard < MAX_STEPS, `spillet nåede aldrig gameover inden for ${MAX_STEPS} skridt (tema=${themeId}, spillere=${playerCount}, density=${density}) — mulig hæng`);
  assert(state.game.current && state.game.current.type === 'gameover', `spillet endte ikke i 'gameover' (tema=${themeId}, spillere=${playerCount})`);
  return { typesSeen, finalScores: state.game.current.scores };
}

function run() {
  const RUNS_PER_CONFIG = 40;
  const PLAYER_COUNTS = [2, 3, 4, 5, 6, 8];
  const DENSITIES = ['none', 'sparse', 'full'];
  let totalGames = 0;
  let kendskabDraws = 0;
  let hvemskrevDraws = 0;
  // Vægtnings-tælling holdes KUN for spil hvor familien reelt er eligible
  // (4+ spillere, 'full' density) — 2-3-spiller-spil og none/sparse-spil
  // kan STRUKTURELT aldrig trække kendskab/hvemskrev (se
  // MIN_ABOUT_FOR_KENDSKAB/eligibleGuessers-kravene), så de ville bare
  // udvande en samlet %-måling hen mod et lavt, meningsløst tal uden at
  // sige noget om selve vægtnings-MEKANIKKEN.
  let eligibleFamilyDraws = 0;
  let eligibleAllDraws = 0;
  const kendskabByPlayerCount = {};
  const hvemskrevByPlayerCount = {};
  const excludedViolations = [];

  console.log('=== Kendskab/personligt-lag stress-test (fulde spil, ikke kun én runde) ===\n');

  for (const themeId of KENDSKAB_THEMES) {
    console.log(`--- Tema: ${themeId} ---`);
    for (const playerCount of PLAYER_COUNTS) {
      for (const density of DENSITIES) {
        for (let i = 0; i < RUNS_PER_CONFIG; i++) {
          totalGames++;
          const { typesSeen } = playOneGame(themeId, playerCount, density, 12);
          const isEligibleConfig = playerCount >= 4 && density === 'full';
          if (isEligibleConfig) eligibleAllDraws += typesSeen.length;
          typesSeen.forEach(t => {
            if (t === 'kendskab') {
              kendskabDraws++;
              if (isEligibleConfig) eligibleFamilyDraws++;
              kendskabByPlayerCount[playerCount] = (kendskabByPlayerCount[playerCount] || 0) + 1;
            }
            if (t === 'hvemskrev') {
              hvemskrevDraws++;
              if (isEligibleConfig) eligibleFamilyDraws++;
              hvemskrevByPlayerCount[playerCount] = (hvemskrevByPlayerCount[playerCount] || 0) + 1;
            }
            const excluded = EXCLUDED_BY_THEME[themeId] || [];
            if (excluded.includes(t)) excludedViolations.push({ themeId, playerCount, density, type: t });
          });
        }
      }
    }
    console.log(`  ✅ ${PLAYER_COUNTS.length * DENSITIES.length * RUNS_PER_CONFIG} spil gennemført uden hæng eller fejl`);
  }

  assert(excludedViolations.length === 0, `EKSKLUDEREDE rundetyper blev alligevel trukket: ${JSON.stringify(excludedViolations.slice(0, 5))}`);
  console.log(`  ✅ Ingen ekskluderede rundetyper (quiplash/rose i kende_kolleger) trukket i ${totalGames} spil`);

  // Vægtningskontrol (Martins fund: "50/50 er for meget, 1/3-1/4") —
  // kendskab+hvemskrev SAMLET skal ligge i nærheden af 22-33% af alle
  // trukne runder, MÅLT KUN blandt spil hvor de reelt kunne være trukket
  // (9 ligeværdige typer + evt. 1 boost-plads, se KENDSKAB_FAMILY i
  // game.js), ikke tæt på 50%.
  const familyShare = eligibleFamilyDraws / eligibleAllDraws;
  assert(familyShare > 0.15 && familyShare < 0.40, `kendskab+hvemskrev udgjorde ${(familyShare * 100).toFixed(1)}% af trukne runder i eligible spil — forventede et sted mellem 15-40% (Martins ønske: 1/3-1/4, ikke 50%)`);
  console.log(`  ✅ Vægtning: kendskab+hvemskrev udgjorde ${(familyShare * 100).toFixed(1)}% af trukne runder i eligible spil (mål: ~22-30%)`);

  // 'none'/'sparse'-density skal ALDRIG udløse kendskab ELLER hvemskrev
  // (under tærsklen) — tjekkes separat, med rent tema+density, mange
  // kørsler. hvemskrev kræver 4+ spillere i sig selv (se
  // collectAboutCandidates), så testes ved præcis 4 for at ramme grænsen.
  console.log('\n--- Tærskel-kontrol (MIN_ABOUT_FOR_KENDSKAB) ---');
  for (const themeId of KENDSKAB_THEMES) {
    for (const density of ['none', 'sparse']) {
      let drawnKendskab = 0, drawnHvemskrev = 0;
      for (let i = 0; i < 60; i++) {
        const { typesSeen } = playOneGame(themeId, 4, density, 12);
        if (typesSeen.includes('kendskab')) drawnKendskab++;
        if (typesSeen.includes('hvemskrev')) drawnHvemskrev++;
      }
      assert(drawnKendskab === 0, `'kendskab' blev trukket ${drawnKendskab} gange trods density='${density}' (under tærsklen på ${themeId})`);
      assert(drawnHvemskrev === 0, `'hvemskrev' blev trukket ${drawnHvemskrev} gange trods density='${density}' (under tærsklen på ${themeId})`);
    }
  }
  console.log('  ✅ Under tærsklen (none/sparse) blev hverken "kendskab" eller "hvemskrev" ALDRIG trukket, i nogen kørsel');

  // Negativ kontrol: hverken 'kendskab' eller 'hvemskrev' må ALDRIG
  // forekomme i et ikke-Kendekasse-tema, selv med et (kunstigt) fyldt
  // personligt lag — beviser isRoundTypeEligible's KENDSKAB_THEMES-gate
  // reelt håndhæves, ikke bare tilfældigvis aldrig rammes.
  console.log('\n--- Negativ tema-kontrol (andre temaer) ---');
  const otherThemes = ['brok', 'bode', 'rose', 'venne', 'hjaelper', 'sladre', 'konkurrence', 'logn', 'drik'];
  let leaked = 0;
  for (const themeId of otherThemes) {
    for (let i = 0; i < 20; i++) {
      const { typesSeen } = playOneGame(themeId, 4, 'full', 12);
      if (typesSeen.includes('kendskab') || typesSeen.includes('hvemskrev')) leaked++;
    }
  }
  assert(leaked === 0, `'kendskab'/'hvemskrev' lækkede ind i ${leaked} spil UDEN for Kendekassen`);
  console.log(`  ✅ Hverken 'kendskab' eller 'hvemskrev' optrådte i ${otherThemes.length * 20} spil i de øvrige ${otherThemes.length} temaer`);

  console.log('\n--- Trækningsstatistik (kendskab/hvemskrev pr. spillerantal, alle densities) ---');
  PLAYER_COUNTS.forEach(pc => {
    console.log(`  ${pc} spillere: kendskab=${kendskabByPlayerCount[pc] || 0}, hvemskrev=${hvemskrevByPlayerCount[pc] || 0}`);
  });
  console.log(`\nSamlet: ${totalGames} fulde spil, ${kendskabDraws} kendskab-runder, ${hvemskrevDraws} hvemskrev-runder, 0 hæng, 0 tema-lækager, 0 tærskel-brud.`);
  console.log('\n✅ Alle kontroller (flow, tema-overholdelse, gyldig-gætter-invariant, vægtning) bestået.');
}

run();
