// Runde-flow til MrBrok — samme opdeling som Brokspillets game.js/gameFlow.js:
// _lib/mrbrok.js holder rent INDHOLD (emner, hvem der bliver MrBrok),
// denne fil holder selve SPIL-FLOWET (tur-rækkefølge, afstemning,
// elimination, tyveri-fasen) og tids-nødbremsen. Ligger under _lib/ så den
// IKKE tæller med i Vercels 12-serverless-function-loft.

const { uid } = require('./store');
const { shuffle } = require('./game');
const { getThemeContent } = require('./mrbrok');
const { stampPhase, MIN_COMPLAIN_AGE_MS, BROKSPILLET_AUTO_MS, COMPLAINT_COUNTDOWN_MS } = require('./gameFlow');

// MrBrok er mere snak-tungt end Brokspillet (folk siger deres clue højt og
// skal nå at tænke sig om) — Brokspillets 12-sekunders nødbremse-nedtælling
// virkede for hastigt/pressende her, så MrBrok får sin egen, længere.
const MRBROK_COMPLAINT_COUNTDOWN_MS = 30000;

// Point-fordeling for det personlige gætte-regnskab (ikke selve sejren, se
// endMrbrokGame): korrekt stemme (på den RIGTIGE MrBrok) fordobles pr.
// afstemningsrunde (1,2,4,8...), forkert stemme koster -1. MrBrok selv
// stemmer aldrig (kender jo sig selv, er heller ikke med i activeIds mere
// når rollen først er afsløret).
function resolveVote(state) {
  const m = state.mrbrok;
  const cur = m.current;
  const tally = {};
  Object.values(cur.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const maxVotes = Math.max(0, ...Object.values(tally));
  const leaders = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
  // Ingen (eller uafgjort mellem flere) — "Chancen" afgør i stedet for at
  // spillet hænger fast uden facit. Blandt de uafgjorte hvis der ER nogen,
  // ellers helt tilfældigt blandt de aktive (fx hvis ingen nåede at stemme
  // før nedtællingen løb ud).
  const candidates = leaders.length ? leaders : m.activeIds.slice();
  const eliminatedId = candidates[Math.floor(Math.random() * candidates.length)];

  // MrBrok stemmer også med (for at blande sig ind blandt de andre og ikke
  // stikke ud) — men deres EGEN stemme tæller ikke ind i gætte-regnskabet,
  // det er jo ikke en interessant stat at måle hvor godt MrBrok "gætter sig
  // selv". Kun de RIGTIGE gættere optjener/mister point her.
  const correctPoints = Math.pow(2, m.voteHistory.length);
  Object.entries(cur.votes).forEach(([voterId, votedForId]) => {
    if (voterId === m.mrBrokId) return;
    if (m.scores[voterId] === undefined) m.scores[voterId] = 0;
    m.scores[voterId] += (votedForId === m.mrBrokId) ? correctPoints : -1;
  });

  m.voteHistory.push({ round: cur.round, votes: { ...cur.votes }, eliminatedId, tie: leaders.length > 1 });
  m.activeIds = m.activeIds.filter(id => id !== eliminatedId);
  m.eliminatedIds.push({ id: eliminatedId, round: cur.round });

  if (eliminatedId === m.mrBrokId) {
    m.caught = true;
    m.current = { type: 'steal', guess: null, votes: {} };
    stampPhase(m.current);
  } else if (m.activeIds.length <= 2) {
    // Kun MrBrok + én tilbage — der er ikke noget reelt flertal at afsløre
    // med længere, MrBrok har overlevet til finalen og vinder automatisk.
    endMrbrokGame(state, true);
  } else {
    beginClueRound(state, cur.round + 1);
  }
}

// Flertal (blandt de stadig aktive spillere) afgør om MrBrok's gæt på
// emnet var tæt nok til at stjæle sejren. Uafgjort tæller som nej.
function resolveSteal(state) {
  const cur = state.mrbrok.current;
  const yes = Object.values(cur.votes).filter(v => v === true).length;
  const no = Object.values(cur.votes).filter(v => v === false).length;
  endMrbrokGame(state, yes > no);
}

function endMrbrokGame(state, mrBrokWon) {
  const m = state.mrbrok;
  if (m.wager === 'euro') {
    // Kasse-motor-generalisering (Fase 2): poolPolarity afgør hvem der
    // krediteres et event — taberen (straf) eller vinderen (belønning).
    const gameName = getThemeContent(state.themeId).gameName;
    const isReward = state.poolPolarity === 'reward';
    const loserIds = mrBrokWon ? m.players.filter(id => id !== m.mrBrokId) : [m.mrBrokId];
    const winnerIds = mrBrokWon ? [m.mrBrokId] : m.players.filter(id => id !== m.mrBrokId);
    const creditedIds = isReward ? winnerIds : loserIds;
    const message = isReward ? `Vandt ${gameName}` : `Tabte ${gameName}`;
    creditedIds.forEach(id => {
      state.events.push({ id: uid(), memberId: id, message, ts: Date.now(), votes: [], free: false, gameLoss: true });
    });
  }
  // Bot-testspillere tælles aldrig med i highscoren.
  if (!state.mrbrokStats) state.mrbrokStats = {};
  const realPlayerIds = m.players.filter(id => !(state.members.find(x => x.id === id) || {}).isBot);
  realPlayerIds.forEach(id => {
    if (!state.mrbrokStats[id]) state.mrbrokStats[id] = { played: 0, wins: 0 };
    state.mrbrokStats[id].played += 1;
  });
  const winnerIds = mrBrokWon ? [m.mrBrokId] : m.players.filter(id => id !== m.mrBrokId);
  winnerIds.filter(id => realPlayerIds.includes(id)).forEach(id => { state.mrbrokStats[id].wins += 1; });

  m.current = {
    type: 'gameover',
    mrBrokId: m.mrBrokId,
    topic: m.topic,
    caught: m.caught || false,
    mrBrokWon,
    scores: m.scores,
    voteHistory: m.voteHistory,
    eliminatedIds: m.eliminatedIds,
    stealGuess: m.current && m.current.guess,
  };
}

// Starter en ny runde af verbale clues — tur-rækkefølgen blandes på ny hver
// gang (ikke fast sæde-rækkefølge), så det ikke bliver forudsigeligt hvem
// der starter/slutter. Kun de stadig AKTIVE (ikke-eliminerede) spillere er
// med i rækkefølgen.
function beginClueRound(state, roundNumber) {
  const m = state.mrbrok;
  m.round = roundNumber;
  const order = shuffle(m.activeIds);
  m.current = { type: 'clue', round: roundNumber, order, turnIndex: 0, speakerId: order[0] };
  stampPhase(m.current);
}

// Den aktuelle taler har markeret deres tur som ovre (sagt deres clue højt
// — der er intet tekstfelt at indsende, kun en bekræftelse). Går videre til
// næste taler, eller (når hele rækken er igennem) enten en ny clue-runde
// (stadig i opvarmningen) eller afstemningsfasen.
function advanceClue(state) {
  const m = state.mrbrok;
  const cur = m.current;
  const next = cur.turnIndex + 1;
  if (next < cur.order.length) {
    m.current = { type: 'clue', round: cur.round, order: cur.order, turnIndex: next, speakerId: cur.order[next] };
    stampPhase(m.current);
  // Runde 1 er ALTID imitations-runden (se index.html's isImitationRound) —
  // en bonus-runde OVEN I de konfigurerede nysgerrige runder, ikke en af
  // dem. +1 her sikrer at m.warmupRounds fortsat betyder "så mange RIGTIGE
  // Q&A-runder", uanset værdi — ellers ville fx warmupRounds=1 gøre at
  // spillet gik direkte fra imitations-runden til afstemning, uden at den
  // faktiske deduktions-runde nogensinde blev spillet.
  } else if (cur.round < m.warmupRounds + 1) {
    beginClueRound(state, cur.round + 1);
  } else {
    m.current = { type: 'vote', round: cur.round, votes: {} };
    stampPhase(m.current);
  }
}

// Hvem mangler stadig at gøre noget for at fasen kan gå videre? Samme rolle
// som Brokspillets getPendingIds — bruges både til at afgøre om der er
// nogen at brokke sig over, og af expireMrbrokPhaseIfDue.
function getPendingMrbrokIds(m) {
  const cur = m.current;
  if (!cur) return [];
  if (cur.type === 'clue') return [cur.speakerId];
  if (cur.type === 'vote') return m.activeIds.filter(id => cur.votes[id] === undefined);
  if (cur.type === 'steal' && !cur.guess) return [m.mrBrokId];
  if (cur.type === 'steal' && cur.guess) return m.activeIds.filter(id => cur.votes[id] === undefined);
  return [];
}

// Tvinger den aktuelle fase videre, fordi en brok-nedtælling (menneske
// eller "MrBrok selv") løb ud uden at den langsomme nåede det.
function forceResolveMrbrokPhase(state) {
  const m = state.mrbrok;
  const cur = m.current;
  if (cur.type === 'clue') advanceClue(state);
  else if (cur.type === 'vote') resolveVote(state);
  else if (cur.type === 'steal' && !cur.guess) endMrbrokGame(state, false);
  else if (cur.type === 'steal' && cur.guess) resolveSteal(state);
}

// Den ENESTE ting der har lov til at rykke MrBrok videre pga. tid — kaldes
// opportunistisk fra enhver poll/handling, aldrig af en klients eget ur.
// Samme filosofi som Brokspillets expireGamePhaseIfDue: intet stille spring,
// der skal altid have været et synligt brok (menneske eller "MrBrok selv")
// og en udløbet nedtælling først.
function expireMrbrokPhaseIfDue(state) {
  const m = state.mrbrok;
  const cur = m && m.current;
  if (!m || !m.active || !cur || !cur.phaseStartedAt) return false;
  const pending = getPendingMrbrokIds(m);
  if (pending.length === 0) return false;
  const now = Date.now();
  if (!cur.complaint) {
    if (now - cur.phaseStartedAt < BROKSPILLET_AUTO_MS) return false;
    cur.complaint = { by: 'brokspillet', targetId: pending[0], startedAt: now };
    return true;
  }
  if (now - cur.complaint.startedAt < MRBROK_COMPLAINT_COUNTDOWN_MS) return false;
  forceResolveMrbrokPhase(state);
  return true;
}

module.exports = {
  MIN_COMPLAIN_AGE_MS,
  BROKSPILLET_AUTO_MS,
  COMPLAINT_COUNTDOWN_MS,
  beginClueRound,
  advanceClue,
  resolveVote,
  resolveSteal,
  endMrbrokGame,
  getPendingMrbrokIds,
  expireMrbrokPhaseIfDue,
};
