const { uid } = require('./store');
const { beginRound, pickChanceVisual, getThemeContent } = require('./game');

const ROUND_POINTS = 2;

// Spillemaskine-bonusrunden (casinobrok+bet, se beginRound i game.js): ingen
// kan bare springe over — man vælger mellem en sikker, lille gevinst uden
// risiko, eller en rigtig satsning med højere gevinst men reel tabsrisiko.
// Chancen for gevinst er bevidst under 50% (ægte spillemaskine-følelse: den
// sikre vej er den "kloge", satsningen er for dem der jagter den store
// gevinst) — forventet værdi af en satsning (0.4*2 - 0.6*1 = 0.2) er lavere
// end den sikre gevinst på 1, men loftet er højere.
const CASINOBROK_BET_SAFE_POINTS = 1;
const CASINOBROK_BET_WIN_POINTS = 2;
const CASINOBROK_BET_LOSE_POINTS = 1;
const CASINOBROK_BET_WIN_CHANCE = 0.4;

// Hvor lang tid en fase mindst skal have kørt før en spiller overhovedet kan
// brokke sig over en langsom medspiller — man skal have lidt is i maven,
// ikke bare kunne rushe folk med det samme.
const MIN_COMPLAIN_AGE_MS = 30000;
// Hvis INGEN brokker sig, gør Brokspillet det selv efter denne stilhed —
// den reelle "nødbremse", men stadig kun som et synligt brok, aldrig et
// tavst spring.
const BROKSPILLET_AUTO_MS = 75000;
// Når nogen (menneske eller Brokspillet) har brokket sig, hvor lang tid har
// den langsomme så tilbage før runden tvinges videre uden dem.
const COMPLAINT_COUNTDOWN_MS = 12000;

// Sætter et tidsstempel på den fase der lige er startet, og nulstiller en
// evt. brok fra den forrige fase — så en gammel brok-nedtælling aldrig kan
// nå at ramme en helt ny fase.
function stampPhase(cur) {
  cur.phaseStartedAt = Date.now();
  cur.complaint = null;
  return cur;
}

// Hvem mangler stadig at gøre noget for at den aktuelle fase kan gå videre?
// Bruges både til at afgøre om der er nogen at brokke sig over, og af
// expireGamePhaseIfDue til at vide hvem Brokspillets automatiske brok skal
// pege på.
function getPendingIds(cur, players) {
  if (!cur) return [];
  if (cur.phase === 'results' || cur.phase === 'skipped') {
    return players.filter(id => !(cur.readyIds || []).includes(id));
  }
  if (cur.type === 'quiplash' && cur.phase === 'answer') {
    return players.filter(id => !(cur.answers && cur.answers[id] !== undefined));
  }
  if (cur.type === 'quiplash' && cur.phase === 'vote') {
    return players.filter(id => !(cur.votes && cur.votes[id] !== undefined));
  }
  if (cur.type === 'truefalse' && cur.phase === 'write') {
    return cur.authorId ? [cur.authorId] : [];
  }
  if (cur.type === 'truefalse' && cur.phase === 'guess') {
    const eligible = cur.authorId ? players.filter(id => id !== cur.authorId) : players;
    return eligible.filter(id => !(cur.guesses && cur.guesses[id] !== undefined));
  }
  if (cur.type === 'trivia' && cur.phase === 'answer') {
    return players.filter(id => !(cur.choices && cur.choices[id] !== undefined));
  }
  if (cur.type === 'guessbrok' && cur.phase === 'write') {
    return cur.authorId ? [cur.authorId] : [];
  }
  if (cur.type === 'guessbrok' && cur.phase === 'guess') {
    return players.filter(id => id !== cur.authorId).filter(id => !(cur.guesses && cur.guesses[id] !== undefined));
  }
  if (cur.type === 'casinobrok' && cur.phase === 'write') {
    return players.filter(id => !(cur.words && cur.words[id] !== undefined));
  }
  if (cur.type === 'casinobrok' && cur.phase === 'bet') {
    return players.filter(id => !(cur.bets && cur.bets[id] !== undefined));
  }
  if (cur.type === 'rose' && cur.phase === 'write') {
    return players.filter(id => cur.compliments && cur.compliments[id] === undefined);
  }
  if (cur.type === 'rose' && cur.phase === 'match') {
    return players.filter(id => cur.guesses && cur.guesses[id] === undefined);
  }
  return [];
}

// Opdigtede svar (cur.decoys, se api/game.js) har id'er formet "decoy0",
// "decoy1" osv. — ingen rigtig spiller står bag dem, så de kan tælles med i
// selve afstemningen (og godt vinde!) men skal ALDRIG give rigtige point.
function isDecoyId(id) {
  return typeof id === 'string' && id.indexOf('decoy') === 0;
}

// Ved uafgjort stemning (2+ svar med samme antal stemmer) afgør "Chancen"
// det i stedet for at dele sejren mellem alle tied kandidater — gælder
// uanset antal spillere, ikke kun 2-spiller-tilfældet. cur.chanceCandidates
// holder styr på HVEM der reelt var i spil for den tilfældige udvælgelse,
// så klienten kan vise en reel med præcis de kandidater (fx kun de 2 der
// var lige om det ud af 4 spillere), ikke alle der svarede.
function resolveQuiplashVote(state, cur) {
  const tally = {};
  Object.values(cur.votes).forEach(id => (tally[id] = (tally[id] || 0) + 1));
  const maxVotes = Math.max(0, ...Object.values(tally));
  const tiedIds = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
  cur.phase = 'results';
  stampPhase(cur);
  cur.readyIds = [];
  if (tiedIds.length > 1) {
    const winnerId = tiedIds[Math.floor(Math.random() * tiedIds.length)];
    if (!isDecoyId(winnerId)) state.game.scores[winnerId] = (state.game.scores[winnerId] || 0) + ROUND_POINTS;
    cur.winnerIds = [winnerId];
    cur.randomPick = true;
    cur.chanceCandidates = tiedIds;
    cur.chanceVisual = pickChanceVisual(state);
  } else {
    tiedIds.forEach(id => { if (!isDecoyId(id)) state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
    cur.winnerIds = tiedIds;
  }
}

// Med kun 2 spillere giver afstemning ingen mening — den ENESTE mulige
// stemme er på modpartens svar, så begge stemmer på den anden og det
// bliver en tvungen uafgjort hver eneste gang (og lader man dem stemme på
// sig selv i stedet, stemmer begge rationelt på sig selv, samme uafgjorte
// resultat). Løsningen er at springe afstemningen helt over ved præcis 2
// spillere og i stedet lade "Chancen" kåre en vinder direkte.
function resolveQuiplashRandom(state, cur) {
  const ids = Object.keys(cur.answers || {});
  const winnerId = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
  const winnerIds = winnerId ? [winnerId] : [];
  winnerIds.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
  cur.phase = 'results';
  stampPhase(cur);
  cur.winnerIds = winnerIds;
  cur.readyIds = [];
  cur.votes = {};
  cur.randomPick = true;
  cur.chanceCandidates = ids;
  cur.chanceVisual = pickChanceVisual(state);
}

// Point-fordeling: gæt rigtigt = 1 point. Narrer forfatteren FLERTALLET af
// gætterne = 1 point til forfatteren. Simpelt og loftbelagt, så det ikke kan
// løbe løbsk hvis man narrer alle på én gang.
function resolveTrueFalseGuess(state, cur) {
  const correctGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] === cur.isTrue);
  const fooledGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] !== cur.isTrue);
  const totalGuessers = correctGuessers.length + fooledGuessers.length;
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + 1; });
  const authorWon = totalGuessers > 0 && fooledGuessers.length > totalGuessers / 2;
  if (authorWon && state.game.scores[cur.authorId] !== undefined) {
    state.game.scores[cur.authorId] += 1;
  }
  cur.phase = 'results';
  stampPhase(cur);
  cur.correctGuessers = correctGuessers;
  cur.authorWon = authorWon;
  cur.readyIds = [];
}

// Point-fordeling for "Hvilket brok ville {author} sige?": gæt rigtigt
// (find forfatterens ægte brok blandt de opdigtede) = 1 point. Hvis INGEN
// finder det ægte, får forfatteren en bonus for at have skrevet et
// overbevisende opdigtet-agtigt rigtigt brok.
function resolveGuessBrok(state, cur) {
  const correctGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] === cur.correctIndex);
  const totalGuessers = Object.keys(cur.guesses).length;
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + 1; });
  const authorWon = totalGuessers > 0 && correctGuessers.length === 0;
  if (authorWon && state.game.scores[cur.authorId] !== undefined) {
    state.game.scores[cur.authorId] += 1;
  }
  cur.phase = 'results';
  stampPhase(cur);
  cur.correctGuessers = correctGuessers;
  cur.authorWon = authorWon;
  cur.readyIds = [];
}

function resolveTriviaAnswer(state, cur) {
  const correctGuessers = Object.keys(cur.choices).filter(id => cur.choices[id] === cur.correctIndex);
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
  cur.phase = 'results';
  stampPhase(cur);
  cur.correctGuessers = correctGuessers;
  cur.readyIds = [];
}

// "Casinobrok" — trækker lod (helt tilfældigt, ét lod pr. indsendt ord,
// uanset om flere spillere skrev samme ordtekst) blandt de indsendte ord og
// kårer forfatteren bag det trukne ord som rundens vinder.
function resolveCasinobrok(state, cur) {
  const ids = Object.keys(cur.words || {});
  const winnerId = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
  if (winnerId) state.game.scores[winnerId] = (state.game.scores[winnerId] || 0) + ROUND_POINTS;
  cur.phase = 'results';
  stampPhase(cur);
  cur.winnerId = winnerId;
  cur.readyIds = [];
}

// Spillemaskine-bonusrunden — hver spillers valg afgøres og udbetales med
// det samme (ikke ét fælles træk ligesom resolveCasinobrok ovenfor), fordi
// det er en individuel satsning, ikke et fælles lod. Selve fase-skiftet til
// 'results' sker i api/game.js, når ALLE har valgt — ligesom resten af
// spillets "write"-runder.
function resolveCasinobrokBet(state, cur, actorId, choice) {
  if (choice === 'safe') {
    state.game.scores[actorId] = (state.game.scores[actorId] || 0) + CASINOBROK_BET_SAFE_POINTS;
    cur.bets[actorId] = { choice, won: true, delta: CASINOBROK_BET_SAFE_POINTS };
    return;
  }
  const won = Math.random() < CASINOBROK_BET_WIN_CHANCE;
  const delta = won ? CASINOBROK_BET_WIN_POINTS : -CASINOBROK_BET_LOSE_POINTS;
  state.game.scores[actorId] = (state.game.scores[actorId] || 0) + delta;
  cur.bets[actorId] = { choice: 'gamble', won, delta };
}

// Manglende ros'er (nogen nåede ikke at skrive) fyldes op med en fast
// pladsholder-tekst i stedet for at fjerne spilleren fra opgøret — ellers
// bliver invertering af tildelingerne (se resolveRoseMatch) mere kringlet,
// og alle andre skal stadig kunne gætte på et komplet navnesæt.
function transitionRoseToMatch(state, cur, players) {
  players.forEach(id => { if (cur.compliments[id] === undefined) cur.compliments[id] = 'Nåede ikke at skrive en ros i tide 🌹'; });
  cur.phase = 'match';
  cur.guesses = {};
  stampPhase(cur);
}

// Point-loft på 2 (samme "værdi" som en vundet runde af enhver anden type,
// se ROUND_POINTS) uanset hvor mange man gætter rigtigt — uden loftet ville
// nogen med fx 3 rigtige ud af 3 spillere score langt mere end normalt for
// én runde, hvilket skævvrider det samlede regnskab langt mere end tiltænkt
// for en enkelt bonus-mekanik.
const ROSE_MAX_POINTS = 2;
function resolveRoseMatch(state, cur, players) {
  const authorForRecipient = {};
  Object.keys(cur.targets).forEach(authorId => { authorForRecipient[cur.targets[authorId]] = authorId; });
  const correctCounts = {};
  players.forEach(guesserId => {
    const guesses = (cur.guesses && cur.guesses[guesserId]) || {};
    let correct = 0;
    Object.keys(authorForRecipient).forEach(recipientId => {
      if (guesses[recipientId] && guesses[recipientId] === authorForRecipient[recipientId]) correct++;
    });
    correctCounts[guesserId] = correct;
    state.game.scores[guesserId] = (state.game.scores[guesserId] || 0) + Math.min(correct, ROSE_MAX_POINTS);
  });
  cur.phase = 'results';
  stampPhase(cur);
  cur.readyIds = [];
  cur.correctCounts = correctCounts;
  cur.authorForRecipient = authorForRecipient;
}

function goToNextRoundOrEnd(state, players) {
  if (state.game.round >= state.game.totalRounds) endGame(state);
  else { beginRound(state, state.members.filter(m => players.includes(m.id))); stampPhase(state.game.current); }
}

function endGame(state) {
  const scores = state.game.scores;
  const memberIds = state.game.players;
  const minScore = Math.min(...memberIds.map(id => scores[id] || 0));
  const maxScore = Math.max(...memberIds.map(id => scores[id] || 0));
  const loserIds = memberIds.filter(id => (scores[id] || 0) === minScore);
  const winnerIds = memberIds.filter(id => (scores[id] || 0) === maxScore);
  if (state.game.wager === 'euro') {
    // Kasse-motor-generalisering (Fase 2): poolPolarity afgør hvem der
    // krediteres et event — taberen (straf, uændret nuværende adfærd) eller
    // vinderen (belønning). Se "Ny variabel fundet: poolPolarity" i planen.
    const gameName = getThemeContent(state.themeId).gameName;
    const isReward = state.poolPolarity === 'reward';
    const creditedIds = isReward ? winnerIds : loserIds;
    const message = isReward ? `Vandt ${gameName}` : `Tabte ${gameName}`;
    creditedIds.forEach(id => {
      state.events.push({ id: uid(), memberId: id, message, ts: Date.now(), votes: [], free: false, gameLoss: true });
    });
  }

  // Highscore på tværs af afsluttede spil — kun optalt hvis der reelt var en
  // vinder (dvs. ikke alle sluttede på 0 point, hvilket ville gøre alle til "vindere").
  // Bot-testspillere tælles aldrig med i highscoren.
  if (!state.gameStats) state.gameStats = {};
  const realMemberIds = memberIds.filter(id => !(state.members.find(m => m.id === id) || {}).isBot);
  realMemberIds.forEach(id => {
    if (!state.gameStats[id]) state.gameStats[id] = { played: 0, wins: 0 };
    state.gameStats[id].played += 1;
  });
  if (maxScore > 0) {
    winnerIds.filter(id => realMemberIds.includes(id)).forEach(id => { state.gameStats[id].wins += 1; });
  }

  state.game.current = { type: 'gameover', scores, loserIds, winnerIds };
}

// Tvinger den aktuelle fase videre, fordi en brok-nedtælling (menneske eller
// Brokspillet) løb ud uden at den langsomme nåede det. Samme håndtering pr.
// runde-type som da dette lå i klientens 'advance'-nødbremse — bare nu
// udløst af én ting (en brok-nedtælling), ikke af hver klients eget ur.
function forceResolveCurrentPhase(state, cur, players) {
  if (cur.type === 'quiplash' && cur.phase === 'answer') {
    cur.votes = {};
    if (players.length === 2) {
      resolveQuiplashRandom(state, cur);
    } else if (Object.keys(cur.answers).length < 2) {
      resolveQuiplashVote(state, cur);
    } else {
      cur.phase = 'vote';
      stampPhase(cur);
    }
  } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
    resolveQuiplashVote(state, cur);
  } else if (cur.type === 'truefalse' && cur.phase === 'write') {
    cur.phase = 'skipped';
    cur.readyIds = [];
    stampPhase(cur);
  } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
    resolveTrueFalseGuess(state, cur);
  } else if (cur.type === 'trivia' && cur.phase === 'answer') {
    resolveTriviaAnswer(state, cur);
  } else if (cur.type === 'guessbrok' && cur.phase === 'write') {
    cur.phase = 'skipped';
    cur.readyIds = [];
    stampPhase(cur);
  } else if (cur.type === 'guessbrok' && cur.phase === 'guess') {
    resolveGuessBrok(state, cur);
  } else if (cur.type === 'casinobrok' && cur.phase === 'write') {
    // Uden mindst ét indsendt ord er der intet lod at trække — spring
    // runden over i stedet for at hænge. Ellers trækkes der bare blandt
    // dem der NÅEDE at skrive.
    if (Object.keys(cur.words).length < 1) {
      cur.phase = 'skipped';
      cur.readyIds = [];
      stampPhase(cur);
    } else {
      resolveCasinobrok(state, cur);
    }
  } else if (cur.type === 'casinobrok' && cur.phase === 'bet') {
    // Ingen kan bare "ikke vælge" — en langsom spiller der løber tør for tid
    // får automatisk den sikre gevinst, aldrig en tvungen satsning de ikke
    // selv valgte.
    players.forEach(id => { if (!cur.bets[id]) resolveCasinobrokBet(state, cur, id, 'safe'); });
    cur.phase = 'results';
    cur.readyIds = [];
    stampPhase(cur);
  } else if (cur.type === 'rose' && cur.phase === 'write') {
    // Uden mindst én indsendt ros er der intet at gætte på — spring runden
    // over. Ellers fyldes de manglende op og der gås videre til gætte-fasen
    // med det der nåede at komme ind.
    if (Object.keys(cur.compliments).length < 1) {
      cur.phase = 'skipped';
      cur.readyIds = [];
      stampPhase(cur);
    } else {
      transitionRoseToMatch(state, cur, players);
    }
  } else if (cur.type === 'rose' && cur.phase === 'match') {
    resolveRoseMatch(state, cur, players);
  } else if (cur.phase === 'results' || cur.phase === 'skipped') {
    goToNextRoundOrEnd(state, players);
  }
}

// Den ENESTE ting der har lov til at rykke runden videre pga. tid — kaldes
// opportunistisk fra enhver poll/handling (samme mønster som
// processPendingExpiry for anklager), aldrig af en klients eget ur. Ingen
// stille spring: der skal altid have været et synligt brok (menneske eller
// Brokspillet) og en udløbet nedtælling, før noget som helst tvinges videre.
function expireGamePhaseIfDue(state, players) {
  const cur = state.game && state.game.current;
  if (!state.game || !state.game.active || !cur || !cur.phaseStartedAt) return false;
  const pending = getPendingIds(cur, players);
  if (pending.length === 0) return false;
  const now = Date.now();
  if (!cur.complaint) {
    if (now - cur.phaseStartedAt < BROKSPILLET_AUTO_MS) return false;
    cur.complaint = { by: 'brokspillet', targetId: pending[0], startedAt: now };
    return true;
  }
  if (now - cur.complaint.startedAt < COMPLAINT_COUNTDOWN_MS) return false;
  forceResolveCurrentPhase(state, cur, players);
  return true;
}

module.exports = {
  ROUND_POINTS,
  ROSE_MAX_POINTS,
  MIN_COMPLAIN_AGE_MS,
  BROKSPILLET_AUTO_MS,
  COMPLAINT_COUNTDOWN_MS,
  stampPhase,
  getPendingIds,
  resolveQuiplashVote,
  resolveQuiplashRandom,
  resolveTrueFalseGuess,
  resolveGuessBrok,
  resolveTriviaAnswer,
  resolveCasinobrok,
  resolveCasinobrokBet,
  transitionRoseToMatch,
  resolveRoseMatch,
  goToNextRoundOrEnd,
  endGame,
  expireGamePhaseIfDue,
};
