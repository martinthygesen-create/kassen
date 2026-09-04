#!/usr/bin/env node
// Interaktiv spil-tester — lader ET RIGTIGT MENNESKE (dig) spille MrBrok
// eller Det Store Brokkeri igennem med 3 bot-modspillere, i-process mod
// samme _lib/mrbrokFlow.js/_lib/complainerFlow.js-funktioner som
// scripts/playtest.js's fuldautomatiske bot-simulering bruger — men her
// stopper flowet op og venter på DIT input hver gang det er din tur, i
// stedet for at bot-simulere den også. Formålet er at du reelt OPLEVER
// spillets tekst/indhold (emner, arketyper, prompts, clue-tips) for et givet
// skin, ikke bare at læse koden — se opgavebeskrivelsens pointe om at
// tematiske fejl (fx Drikkekassens penge/tema-mismatch,
// Kollegakassens uklare enhedsnavn) blev fundet ved at SPILLE, ikke gætte.
//
// AFVIGELSE FRA DEN RIGTIGE APP, bevidst og synligt: i den rigtige app
// siges MrBroks clues og Det Store Brokkeris brok/svar-på-spørgsmål HØJT
// ved bordet — der er intet tekstfelt, og appen gemmer/viser aldrig selve
// ordlyden, kun HVEM der har turen (se komментarerne i _lib/mrbrokFlow.js/
// _lib/complainerFlow.js). Her, uden 3 rigtige medspillere ved et bord,
// GENERERER dette script i stedet en tekst-linje for hver bot, så du kan
// bedømme om INDHOLDET (topic/prompt/arketype) giver mening i det valgte
// skin — det er en test-facilitet, ikke en afspejling af den rigtige UI.
//
// BRUG:
//   node scripts/play.js mrbrok <themeId> [--name "Dit navn"]
//   node scripts/play.js complainer <themeId> [--name "Dit navn"]

const path = require('path');
const readline = require('readline');
const store = require(path.join(__dirname, '..', 'api', '_lib', 'store'));
const mrbrok = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrok'));
const mrbrokFlow = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrokFlow'));
const complainer = require(path.join(__dirname, '..', 'api', '_lib', 'complainer'));
const complainerFlow = require(path.join(__dirname, '..', 'api', '_lib', 'complainerFlow'));
const { SKIN_REGISTRY } = require(path.join(__dirname, '..', 'api', '_lib', 'themeRegistry'));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(resolve => rl.question(q, resolve)); }
function say(msg = '') { console.log(msg); }
function botLine(text) { console.log(`  🤖 ${text}`); }
function humanPrompt(text) { console.log(`\n  👉 ${text}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BOT_NAMES = ['Bot Anna', 'Bot Bo', 'Bot Casper'];

async function pickIndex(options, question) {
  options.forEach((o, i) => say(`     ${i + 1}) ${o}`));
  while (true) {
    const raw = await ask(`  ${question} [1-${options.length}]: `);
    const n = parseInt(raw.trim(), 10);
    if (n >= 1 && n <= options.length) return n - 1;
    say('     Ugyldigt valg, prøv igen.');
  }
}

async function pickYesNo(question) {
  while (true) {
    const raw = (await ask(`  ${question} (j/n): `)).trim().toLowerCase();
    if (raw === 'j' || raw === 'ja') return true;
    if (raw === 'n' || raw === 'nej') return false;
  }
}

// ============================================================
// MrBrok
// ============================================================
async function playMrBrok(themeId, humanName) {
  const entry = SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
  if (!entry.allowedGames.includes('mrbrok')) {
    say(`\n⚠️  Skin '${themeId}' tillader ikke MrBrok (allowedGames: ${entry.allowedGames.join(', ')}) — spiller alligevel til test-formål.`);
  }
  const state = store.emptyState();
  state.themeId = themeId;
  const human = { id: store.uid(), name: humanName, isBot: false };
  const bots = BOT_NAMES.map(name => ({ id: store.uid(), name, isBot: true }));
  state.members = [human, ...bots];
  const players = state.members.map(m => m.id);
  const memberById = id => state.members.find(m => m.id === id);

  const mrBrokId = mrbrok.pickMrBrok(state, state.members).id;
  const gameName = mrbrok.getThemeContent(themeId).gameName;
  const clueTips = mrbrok.getThemeContent(themeId).mrbrokClueTips;
  const scores = {};
  players.forEach(id => { if (id !== mrBrokId) scores[id] = 0; });
  state.mrbrok = {
    active: true, wager: 'fun', players, activeIds: players.slice(), eliminatedIds: [],
    mrBrokId, topic: mrbrok.pickTopic(state), warmupRounds: 2,
    round: 0, scores, caught: false, voteHistory: [], current: null, startedAt: Date.now(),
  };

  say(`\n=== ${gameName} (skin: ${themeId}) ===`);
  say(`Spillere: ${state.members.map(m => m.name).join(', ')}`);
  const isHumanMrBrok = mrBrokId === human.id;
  if (isHumanMrBrok) {
    say(`\n🎭 Du har MrBrok-rollen (i ${gameName})! Du kender IKKE emnet — du skal bluffe dig igennem ud fra de andres clues.`);
  } else {
    say(`\nEmnet er: "${state.mrbrok.topic}"`);
    say(`(Én af de andre 3 er ${gameName.toLowerCase()} og kender IKKE dette emne — find dem.)`);
  }

  mrbrokFlow.beginClueRound(state, 1);

  let guard = 0;
  while (state.mrbrok.current.type !== 'gameover' && guard++ < 60) {
    const m = state.mrbrok;
    const cur = m.current;

    if (cur.type === 'clue') {
      const speaker = memberById(cur.speakerId);
      const isMrBrokSpeaking = cur.speakerId === mrBrokId;
      if (cur.speakerId === human.id) {
        if (isMrBrokSpeaking) {
          humanPrompt(`Din tur (runde ${cur.round}) — du kender IKKE emnet. Bluff et clue der lyder plausibelt.`);
        } else {
          humanPrompt(`Din tur (runde ${cur.round}) — emnet er "${m.topic}". Giv et clue uden at sige det direkte.`);
        }
        const tip = clueTips[Math.floor(Math.random() * clueTips.length)];
        say(`     (Tip: ${tip})`);
        await ask('     Sig dit clue højt, og tryk Enter når du er færdig...');
      } else {
        await sleep(150);
        botLine(`${speaker.name} siger et clue højt${isMrBrokSpeaking ? ' (de er faktisk ' + gameName.toLowerCase() + ', men du ved det ikke endnu)' : ''}.`);
      }
      mrbrokFlow.advanceClue(state);
      continue;
    }

    if (cur.type === 'vote') {
      say(`\n--- Afstemning: hvem tror I er ${gameName.toLowerCase()}? ---`);
      cur.votes = cur.votes || {};
      for (const voterId of m.activeIds) {
        const others = m.activeIds.filter(id => id !== voterId);
        if (voterId === human.id) {
          const idx = await pickIndex(others.map(id => memberById(id).name), 'Hvem stemmer du på');
          cur.votes[voterId] = others[idx];
        } else {
          cur.votes[voterId] = others[Math.floor(Math.random() * others.length)];
        }
      }
      mrbrokFlow.resolveVote(state);
      if (m.current.type === 'gameover') {
        say(`\n(${gameName} overlevede til finalen med kun to spillere tilbage — automatisk sejr.)`);
      } else if (m.current.type === 'steal') {
        const eliminated = memberById(m.eliminatedIds[m.eliminatedIds.length - 1].id);
        say(`\n${eliminated.name} blev stemt ud — og var faktisk ${gameName.toLowerCase()}!`);
      } else {
        const eliminated = memberById(m.eliminatedIds[m.eliminatedIds.length - 1].id);
        say(`${eliminated.name} blev stemt ud (var IKKE ${gameName.toLowerCase()}). Videre til runde ${m.current.round}.`);
      }
      continue;
    }

    if (cur.type === 'steal' && !cur.guess) {
      say(`\n--- ${memberById(mrBrokId).name} er afsløret! Sidste chance: gæt emnet for at stjæle sejren. ---`);
      if (mrBrokId === human.id) {
        cur.guess = await ask('  Dit gæt på emnet: ');
      } else {
        await sleep(150);
        cur.guess = 'Testgæt fra bot';
        botLine(`${memberById(mrBrokId).name} gætter: "${cur.guess}"`);
      }
      continue;
    }

    if (cur.type === 'steal' && cur.guess) {
      say(`  Gæt: "${cur.guess}" (det rigtige emne var: "${m.topic}")`);
      for (const voterId of m.activeIds) {
        if (voterId === mrBrokId) continue;
        if (voterId === human.id) {
          cur.votes[voterId] = await pickYesNo('  Var gættet tæt nok på det rigtige emne?');
        } else {
          cur.votes[voterId] = Math.random() < 0.4;
        }
      }
      mrbrokFlow.resolveSteal(state);
      continue;
    }
  }

  const result = state.mrbrok.current;
  say(`\n=== GAME OVER ===`);
  say(`${memberById(mrBrokId).name} var ${gameName.toLowerCase()}. Emnet var: "${result.topic}"`);
  say(result.mrBrokWon ? `${gameName} VANDT! 🎭` : `De andre spillere vandt! 🕵️`);
  say(`Point: ${Object.entries(result.scores).map(([id, s]) => `${memberById(id).name}: ${s}`).join(', ')}`);
}

// ============================================================
// Det Store Brokkeri
// ============================================================
async function playComplainer(themeId, humanName) {
  const entry = SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
  if (!entry.allowedGames.includes('complainer')) {
    say(`\n⚠️  Skin '${themeId}' tillader ikke Det Store Brokkeri ifølge registeret — spiller alligevel til test-formål.`);
  }
  const state = store.emptyState();
  state.themeId = themeId;
  const human = { id: store.uid(), name: humanName, isBot: false };
  const bots = BOT_NAMES.map(name => ({ id: store.uid(), name, isBot: true }));
  state.members = [human, ...bots];
  const players = state.members.map(m => m.id);
  const memberById = id => state.members.find(m => m.id === id);

  const { archetypes, situations } = complainer.assignArchetypesAndSituations(state.members, themeId);
  const gameName = complainer.getThemeContent(themeId).gameName;
  const themeArchetypes = complainer.getThemeContent(themeId).archetypes;
  const archetypeById = id => themeArchetypes.find(a => a.id === archetypes[id]);
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

  say(`\n=== ${gameName} (skin: ${themeId}) ===`);
  say(`Spillere: ${state.members.map(m => m.name).join(', ')}`);
  say(`Din rolle: ${archetypeById(human.id).name}`);
  say(`(Alle 4 har hemmeligt fået en rolle + situation. Én af jer er "Den Store Brokker" — det afsløres først til sidst, KUN for den det gælder.)`);

  complainerFlow.beginComplainRound(state, 1);

  let guard = 0;
  while (state.complainer.current.type !== 'gameover' && guard++ < 100) {
    const c = state.complainer;
    const cur = c.current;

    if (cur.type === 'complain') {
      const speaker = memberById(cur.speakerId);
      const prompt = cur.prompts[cur.speakerId];
      if (cur.speakerId === human.id) {
        humanPrompt(`Din tur (runde ${cur.round}, tema: ${prompt.category}) — din arketype er "${archetypeById(human.id).name}".`);
        say(`     "${prompt.text}"`);
        await ask('     Sig dit brok/svar højt i karakter, og tryk Enter når du er færdig...');
      } else {
        await sleep(150);
        botLine(`${speaker.name} (${archetypeById(cur.speakerId).name}): "${prompt.text}"`);
      }
      complainerFlow.advanceComplain(state);
      continue;
    }

    if (cur.type === 'vote') {
      say(`\n--- Hemmelig mistankeafstemning${cur.final ? ' (SIDSTE runde)' : ''} ---`);
      cur.votes = cur.votes || {};
      for (const voterId of c.players) {
        const others = c.players.filter(id => id !== voterId);
        if (voterId === human.id) {
          const idx = await pickIndex(others.map(id => memberById(id).name), 'Hvem mistænker du mest');
          cur.votes[voterId] = others[idx];
        } else {
          cur.votes[voterId] = others[Math.floor(Math.random() * others.length)];
        }
      }
      complainerFlow.resolveSuspicionRound(state);
      if (c.current.type === 'bet') {
        say(`${memberById(c.current.topId).name} er rundens topmest mistænkte.`);
      }
      continue;
    }

    if (cur.type === 'bet') {
      if (cur.topId === human.id) {
        say(`\n--- Du er topmest mistænkt! Bank ${complainerFlow.SUSPECT_POINTS} point sikkert, eller sats dem på at du topper mistanken IGEN næste runde (dobbelt op / tabt)? ---`);
        const gamble = await pickYesNo('  Sats (gamble)?');
        cur.choice = gamble ? 'gamble' : 'safe';
      } else {
        await sleep(150);
        cur.choice = Math.random() < 0.3 ? 'gamble' : 'safe';
        botLine(`${memberById(cur.topId).name} vælger at ${cur.choice === 'gamble' ? 'satse' : 'banke sikkert'}.`);
      }
      complainerFlow.resolveBet(state);
      continue;
    }

    if (cur.type === 'interrogation') {
      const speaker = memberById(cur.speakerId);
      if (!c.__revealAnnounced) {
        c.__revealAnnounced = true;
        say(`\n=== AFSLØRING ===`);
        if (guiltyId === human.id) {
          say(`🎭 DU er "Den Store Brokker"! Bliv i karakter — én sidste spørgerunde før gættefinalen.`);
        } else {
          say(`Én af de andre er nu blevet afsløret som "Den Store Brokker" (kun for dem selv). Én sidste spørgerunde før gættefinalen.`);
        }
      }
      if (cur.speakerId === human.id) {
        humanPrompt(`Din tur til at svare på et spørgsmål fra de andre — bliv i karakter (${archetypeById(human.id).name}).`);
        await ask('     Svar højt, og tryk Enter når du er færdig...');
      } else {
        await sleep(150);
        botLine(`${speaker.name} svarer på et spørgsmål, stadig i karakter.`);
      }
      complainerFlow.advanceInterrogation(state);
      continue;
    }

    if (cur.type === 'guess') {
      say(`\n--- Gættefinale: "Den Store Brokker" skal udpege en medspiller og en konkret detalje fra deres brok. ---`);
      if (guiltyId === human.id) {
        const others = players.filter(p => p !== human.id);
        const idx = await pickIndex(others.map(id => memberById(id).name), 'Hvem udpeger du');
        const detail = await ask('  Hvilken konkret detalje gætter du fra deres brok? ');
        complainerFlow.submitGuess(state, others[idx], detail);
      } else {
        await sleep(150);
        const others = players.filter(p => p !== guiltyId);
        const target = others[Math.floor(Math.random() * others.length)];
        const detail = 'en detalje fra runderne';
        botLine(`${memberById(guiltyId).name} udpeger ${memberById(target).name} og gætter: "${detail}"`);
        complainerFlow.submitGuess(state, target, detail);
      }
      continue;
    }

    if (cur.type === 'judge') {
      say(`  ${memberById(cur.targetId).name} udpeget, gæt: "${cur.detail}" — var det tæt nok?`);
      for (const voterId of players) {
        if (voterId === guiltyId) continue;
        if (voterId === human.id) {
          cur.votes[voterId] = await pickYesNo('  Var gættet tæt nok?');
        } else {
          cur.votes[voterId] = Math.random() < 0.5;
        }
      }
      complainerFlow.resolveJudge(state);
      continue;
    }
  }

  const result = state.complainer.current;
  say(`\n=== GAME OVER ===`);
  say(`${memberById(guiltyId).name} var "Den Store Brokker".`);
  say(result.guiltyWon ? `Den Store Brokker VANDT! 🎭` : `De andre spillere afslørede korrekt! 🕵️`);
  say(`Point: ${Object.entries(result.scores).map(([id, s]) => `${memberById(id).name}: ${s}`).join(', ')}`);
}

async function main() {
  const [game, themeId] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const nameFlagIdx = process.argv.indexOf('--name');
  const humanName = nameFlagIdx !== -1 ? process.argv[nameFlagIdx + 1] : 'Martin';
  if (!game || !themeId || !['mrbrok', 'complainer'].includes(game)) {
    console.error('Brug: node scripts/play.js <mrbrok|complainer> <themeId> [--name "Dit navn"]');
    console.error(`Kendte skins: ${Object.keys(SKIN_REGISTRY).join(', ')}`);
    process.exit(1);
  }
  try {
    if (game === 'mrbrok') await playMrBrok(themeId, humanName);
    else await playComplainer(themeId, humanName);
  } finally {
    rl.close();
  }
}

if (require.main === module) main();
