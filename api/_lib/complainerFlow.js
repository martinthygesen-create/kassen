// Runde-flow til Det Store Brokkeri ("The Big Complainer") — samme opdeling som
// MrBrok's mrbrok.js/mrbrokFlow.js og Brokspillets game.js/gameFlow.js:
// _lib/complainer.js holder rent INDHOLD (arketyper, situationer, prompts),
// denne fil holder selve SPIL-FLOWET (opbygningsrunder, mistankeafstemning,
// bank/gamble-mekanikken, den private afsløring, gættefinalen) og
// tids-nødbremsen. Ligger under _lib/ så den IKKE tæller med i Vercels
// 12-serverless-function-loft.
//
// Egen, uafhængig state-gren (state.complainer) og eget flow — rører ALDRIG
// state.mrbrok/state.game eller deres flow-filer. Se CLAUDE.md.

const { uid } = require('./store');
const { pickRandom, shuffle } = require('./game');
const { assignArchetypesAndSituations, pickPromptFor, composePromptText } = require('./complainer');
// Genbruger de delte tids-konstanter og "phase stamp"-hjælperen fra
// Brokspillets gameFlow.js (samme mønster MrBrok allerede gør) — importerer
// kun herfra, rører ALDRIG selve filen eller dens spil-specifikke logik.
const { stampPhase, MIN_COMPLAIN_AGE_MS, BROKSPILLET_AUTO_MS, COMPLAINT_COUNTDOWN_MS } = require('./gameFlow');

// Point for at være DENNE rundes topmest mistænkte — sikkert at give, fordi
// ingen (heller ikke Den Store Brokker selv) endnu ved hvem der reelt er
// skyldig på dette tidspunkt i spillet; det er ren performance/cheap-talk.
// "safe" banker med det samme; "gamble" sætter beløbet i spil på om samme
// spiller OGSÅ topper mistanken NÆSTE runde (dobbelt op / helt tabt). Tabet
// er et tabt IKKE-bankede point, aldrig en negativ saldo — man kan derfor
// aldrig komme i minus af denne mekanik (se pendingGamble-håndteringen
// nedenfor), men gevinsten/tabet er stort nok (dobbelt op) til at det rent
// faktisk stikker, ikke bare er ligegyldigt baggrundsstøj.
const SUSPECT_POINTS = 2;

function stampPhaseComplainer(cur) {
  cur.phaseStartedAt = Date.now();
  cur.complaint = null;
  return cur;
}

// Starter en helt ny opbygningsrunde: nye, eskalerende prompts til alle
// stadig deltagende spillere (matchet til deres situation), OG en ny
// tur-rækkefølge — broksene siges HØJT ved bordet, én spiller ad gangen,
// nøjagtig samme mønster som MrBrok's clue-fase (se beginClueRound i
// mrbrokFlow.js) og bevidst IKKE samtidig indtastning. Der er intet
// tekstfelt og intet der gemmes af selve broksens ORDLYD — kun HVEM der har
// sagt sit brok (turnIndex), aldrig HVAD de sagde. Det er en bevidst
// designbeslutning (produktejer-rettelse): gættefinalen skal hvile på
// spillernes egen hukommelse om hvad der blev sagt ved bordet, ikke på en
// app-gemt facitliste — se submitGuess længere nede.
function beginComplainRound(state, roundNumber) {
  const c = state.complainer;
  c.round = roundNumber;
  const prompts = {};
  c.players.forEach(id => {
    const prompt = pickPromptFor(id, c.situations[id], roundNumber, c.totalRounds, c.usedPromptIds[id] || []);
    // Prompten der reelt VISES kombinerer arketypens promptHook med den
    // valgte situationelle prompt (se composePromptText i _lib/complainer.js)
    // — så en "passiv-aggressiv pilot" og en "udadvendt lærer" ikke længere
    // får byte-for-byte identisk tekst for samme situation/tier. id/category/
    // tier gemmes stadig ud fra den RÅ situationelle prompt (til
    // udvælgelses-/gentagelses-logikken i pickPromptFor), kun `text` er
    // sammensat.
    const composedText = composePromptText(c.archetypes[id], prompt.text);
    prompts[id] = { id: prompt.id, text: composedText, category: prompt.category, tier: prompt.tier };
    if (!c.usedPromptIds[id]) c.usedPromptIds[id] = [];
    c.usedPromptIds[id].push(prompt.id);
  });
  const order = shuffle(c.players);
  c.current = { type: 'complain', round: roundNumber, order, turnIndex: 0, speakerId: order[0], prompts };
  stampPhaseComplainer(c.current);
}

// Den aktuelle taler har markeret deres tur som ovre (sagt deres brok højt —
// intet tekstfelt, kun en bekræftelse). Går videre til næste taler i
// rækkefølgen, eller (når hele runden er igennem) den hemmelige
// mistankeafstemning. Samme struktur som MrBrok's advanceClue.
function advanceComplain(state) {
  const c = state.complainer;
  const cur = c.current;
  const next = cur.turnIndex + 1;
  if (next < cur.order.length) {
    c.current = { type: 'complain', round: cur.round, order: cur.order, turnIndex: next, speakerId: cur.order[next], prompts: cur.prompts };
    stampPhaseComplainer(c.current);
  } else {
    beginVoteRound(state);
  }
}

// Alle har sagt deres brok højt — arkivér kun HVILKEN prompt hver spiller
// fik (til reference/genkaldelse), ALDRIG selve broksens ordlyd (den findes
// kun i den fysiske samtale ved bordet, se beginComplainRound), og gå
// videre til hemmelig mistankeafstemning.
function beginVoteRound(state) {
  const c = state.complainer;
  const cur = c.current;
  if (!c.history) c.history = [];
  c.history.push({ round: cur.round, prompts: cur.prompts });
  c.current = { type: 'vote', round: cur.round, votes: {} };
  stampPhaseComplainer(c.current);
}

// Alle har stemt hemmeligt — tæl op, kår rundens topmest mistænkte, afregn
// en evt. ventende satsning fra forrige runde, og tilbyd den nye topmest
// mistænkte valget mellem bank/gamble.
function resolveSuspicionRound(state) {
  const c = state.complainer;
  const cur = c.current; // type: vote
  const tally = {};
  Object.values(cur.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const maxVotes = Math.max(0, ...Object.values(tally));
  const leaders = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : c.players.slice();
  const topId = leaders[Math.floor(Math.random() * leaders.length)];
  const tie = leaders.length > 1;
  // BEVIDST ingen tally her — c.topSuspectHistory er ALDRIG redigeret væk
  // (se redactComplainerFor), så en fuld stemmefordeling gemt her ville
  // lække til alle med det samme og gøre "Udfordring"s hele pointe
  // (at tallyen NORMALT er skjult, og kun afsløres hvis nogen udfordrer)
  // meningsløs. Selve tallyen lever kun transient på cur.tally nedenfor,
  // som ER redigeret betinget af cur.challenged.
  c.topSuspectHistory.push({ round: cur.round, topId, tie });

  // Afregn en evt. ventende satsning FRA FORRIGE runde: vandt kun hvis
  // SAMME spiller også topper mistanken denne runde.
  let lastGambleResult = null;
  if (c.pendingGamble) {
    const g = c.pendingGamble;
    if (g.playerId === topId) {
      const win = g.amount * 2;
      c.scores[g.playerId] = (c.scores[g.playerId] || 0) + win;
      lastGambleResult = { playerId: g.playerId, won: true, amount: win };
    } else {
      // Tabt satsning = et tabt point der ALDRIG blev banket — ingen
      // negativ saldo, blot ingen gevinst. Se kommentar ved SUSPECT_POINTS.
      lastGambleResult = { playerId: g.playerId, won: false, amount: g.amount };
    }
    c.pendingGamble = null;
  }
  c.lastGambleResult = lastGambleResult;

  // tally gemmes altid på selve bet-fasen (ikke kun i topSuspectHistory
  // bagefter) så en "Udfordring" (se applyComplainerChallenge nedenfor,
  // EXPERIMENTEL) kan afsløre den for alle MENS runden stadig er aktiv —
  // men den er redigeret væk for almindelige klienter indtil den evt.
  // udfordres, se redactComplainerFor i _lib/complainer.js.
  c.current = { type: 'bet', round: cur.round, topId, tie, choice: null, tally, stakeMultiplier: 1, challenged: false, challengedBy: null };
  stampPhaseComplainer(c.current);
}

// ============================================================
// EXPERIMENTAL — "Udfordring" (Coup/Blood on the Clocktower-inspireret
// engangs-mekanik). Se CLAUDE.md/commit-besked for produktejer-kontekst.
// Bevidst holdt i sit eget lille, letgenkendelige blok med ét
// call-site-flag (state.complainer.challengeEnabled) — hvis dette IKKE
// tester godt ved bordet, kan hele blokken (denne funktion + dens ene
// kaldested i api/complainer.js's 'challenge'-handler + UI-knappen i
// index.html's complainerBetHtml) fjernes i ét hug uden at røre resten af
// runde-flowet. Rører BEVIDST ALDRIG beginReveal/afsløringstidspunktet,
// rundeantallet, eller noget andet uden for selve DENNE bet-runde.
function applyComplainerChallenge(state, actorId) {
  const c = state.complainer;
  const cur = c.current; // type: bet
  cur.challenged = true;
  cur.challengedBy = actorId;
  cur.stakeMultiplier = 2;
  if (!c.challengeUsedBy) c.challengeUsedBy = {};
  c.challengeUsedBy[actorId] = true;
}
// ============================================================

// Den topmest mistænkte har valgt hvordan de vil "banke" rundens point —
// eller nødbremsen har valgt 'safe' for dem. Går videre til enten næste
// opbygningsrunde, ÉN ekstra sidste afstemningsrunde (se
// beginFinalVoteRound nedenfor), eller (efter DEN sidste afstemning) den
// private afsløring + gættefinalen.
//
// DOMMEBESLUTNING (revideret — produktejer-rettelse efter en rigtig
// spilaften, se commit-historikken): den organiske afsløring udløstes
// tidligere DIREKTE efter den sidste konfigurerede opbygningsrundes
// bank/gamble-valg — men det gav to reelle problemer i praksis. (1) Ingen
// tid til at reagere: mistanken var lige nået at flytte sig i den sidste
// runde, og så var det slut med det samme — "der mangler
// afstemningsrunder" (Martins egne ord). (2) En gamble placeret på selve
// den sidste opbygningsrunde blev ALDRIG afregnet — pendingGamble afregnes
// kun inde i resolveSuspicionRound, som kun kører når der ER en NÆSTE
// afstemning, og der var ingen. Spilleren fandt aldrig ud af om de vandt.
//
// Løsningen er IKKE et særtilfælde/plaster på (2) — det er én ekstra,
// rigtig afstemningsrunde EFTER den sidste opbygningsrunde, før
// afsløringen: ingen ny brok-/prompt-fase (spillerne har allerede alt det
// materiale de nogensinde får), kun endnu en hemmelig mistankeafstemning +
// bank/gamble-beslutning, kørt igennem PRÆCIS samme mekanik som alle de
// andre runder. Det giver ét ekstra, reelt strategisk øjeblik (kan mistanken
// nå at flytte sig igen, lige før det er for sent?), OG det løser (2) helt
// naturligt, fordi der nu ALTID er en efterfølgende afstemning at afregne
// en ventende satsning imod — ingen særlig kode for "sidste runde" nogen
// steder. round-tælleren for denne ekstra runde er c.totalRounds + 1 — der
// er ingen ny beginComplainRound for den, kun beginFinalVoteRound.
function resolveBet(state) {
  const c = state.complainer;
  const cur = c.current; // type: bet
  // stakeMultiplier er normalt 1 — kun EXPERIMENTAL "Udfordring" sætter den
  // til 2 (se applyComplainerChallenge ovenfor). Rører intet andet ved
  // point-mekanikken.
  const stake = SUSPECT_POINTS * (cur.stakeMultiplier || 1);
  if (cur.choice === 'gamble') {
    c.pendingGamble = { playerId: cur.topId, amount: stake, round: cur.round };
  } else {
    c.scores[cur.topId] = (c.scores[cur.topId] || 0) + stake;
  }
  if (cur.round < c.totalRounds) {
    beginComplainRound(state, cur.round + 1);
  } else if (cur.round === c.totalRounds) {
    beginFinalVoteRound(state);
  } else {
    beginReveal(state);
  }
}

// Den ENE ekstra afstemningsrunde efter den sidste konfigurerede
// opbygningsrunde (se dommebeslutningen ved resolveBet ovenfor) — ren
// mistankeafstemning, INGEN ny brok-/prompt-fase, ingen ny c.history-post
// (der er ingen prompts at arkivere for en runde uden en brok-fase).
// Nummereret c.totalRounds + 1, så resolveBet's egen round-sammenligning
// entydigt kan se at DENNE afstemnings bet-fase er den allersidste, og gå
// til beginReveal bagefter i stedet for endnu en runde.
function beginFinalVoteRound(state) {
  const c = state.complainer;
  const finalRound = c.totalRounds + 1;
  c.round = finalRound;
  c.current = { type: 'vote', round: finalRound, votes: {}, final: true };
  stampPhaseComplainer(c.current);
}

// Den private afsløring: Den Store Brokker får FØRST HER at vide hvem de er
// — ikke ved spilstart. Selve "hemmeligheden" (c.guiltyId) er sat allerede
// ved spilstart, men holdes ude af klienten (se redactComplainerFor i
// api/complainer.js) indtil netop dette øjeblik. api/complainer.js sender en
// PRIVAT push til kun c.guiltyId når denne fase starter — ingen broadcast.
//
// DOMMEBESLUTNING (produktejer-rettelse efter en rigtig spilaften): med
// gættefinalen lige efter afsløringen gav afsløringen ingen mening ("med
// finale lige efter giver spillet afsløring ingen mening", Martins egne
// ord) — hele pointen ved en PRIVAT afsløring er at Den Store Brokker nu
// skal performe under ægte pres (de VED det nu, så enhver adfærdsændring er
// et reelt signal, ikke bare cheap talk som resten af spillet), men der var
// ingen runde hvor den spænding fik lov at udspille sig. Løsningen er ÉN
// (ikke konfigurerbar, ikke gentagende — bevidst holdt stram, se
// beginInterrogationRound) spørgerunde mellem afsløringen og gættefinalen,
// før vi går til den nu udskilte beginGuessPhase.
function beginReveal(state) {
  const c = state.complainer;
  c.revealed = true;
  c.revealedAt = Date.now();
  beginInterrogationRound(state);
}

// Den ENE spørgerunde mellem afsløring og gættefinale (se dommebeslutningen
// ved beginReveal ovenfor) — nøjagtig samme tur-baserede verbale mekanik som
// opbygningsrundernes brok-fase (beginComplainRound/advanceComplain): en
// delt, shufflet rækkefølge over c.players, kun HVEM der har turen
// (speakerId/turnIndex), aldrig noget om HVAD der bliver spurgt/svaret —
// spørgsmålet stilles og besvares HØJT ved bordet, appen genererer og gemmer
// intet af selve indholdet, samme "sagt højt, ikke skrevet"-filosofi som
// resten af spillet. Gælder ALLE spillere, ikke kun den skyldige — de skal
// stadig alle svare i karakter, ellers ville den skyldige stikke ud af ren
// process-of-elimination selvom ingen sagde noget direkte. c.revealed er
// allerede true her, men INTET i selve denne runde-state afslører hvem der
// er skyldig (ingen guiltyId, ingen speciel markering af DEN spiller) — kun
// c.youAreGuilty (sat i redactComplainerFor) fortæller den enkelte klient om
// det er dem, akkurat som resten af spillet efter afsløringstidspunktet.
function beginInterrogationRound(state) {
  const c = state.complainer;
  const order = shuffle(c.players);
  c.current = { type: 'interrogation', order, turnIndex: 0, speakerId: order[0] };
  stampPhaseComplainer(c.current);
}

// Den aktuelle spiller har svaret færdig på deres spørgsmål — gå til næste i
// rækkefølgen, eller (når alle har svaret) videre til gættefinalen. Samme
// struktur som advanceComplain, men uden nogen efterfølgende
// stemme-/bank-fase — der er kun denne ENE runde, ikke en ny pr. spiller.
function advanceInterrogation(state) {
  const c = state.complainer;
  const cur = c.current;
  const next = cur.turnIndex + 1;
  if (next < cur.order.length) {
    c.current = { type: 'interrogation', order: cur.order, turnIndex: next, speakerId: cur.order[next] };
    stampPhaseComplainer(c.current);
  } else {
    beginGuessPhase(state);
  }
}

// Udskilt fra det tidligere beginReveal, så både beginReveal (vejen ind i
// spørgerunden) og advanceInterrogation (vejen ud af den) kan dele PRÆCIS
// samme opsætning af selve gættefasen.
function beginGuessPhase(state) {
  const c = state.complainer;
  c.current = { type: 'guess', targetId: null, detail: null };
  stampPhaseComplainer(c.current);
}

// Den Store Brokker gætter — STADIG I KARAKTER — en konkret detalje om en
// navngiven medspiller ud fra hvad de har sagt i opbygningsrunderne. Dette
// hviler UDELUKKENDE på spillernes egen hukommelse fra bordet (broksene blev
// sagt højt, aldrig gemt som tekst, se beginComplainRound) — akkurat som
// MrBrok's eget tyveri-gæt (resolveSteal i mrbrokFlow.js) allerede virker
// fra hukommelse uden nogen app-facitliste. Ikke et hul der mangler at blive
// lukket, men en bevidst del af konceptet.
function submitGuess(state, targetId, detail) {
  const c = state.complainer;
  c.current.targetId = targetId;
  c.current.detail = detail;
  c.current.type = 'judge';
  c.current.votes = {};
  stampPhaseComplainer(c.current);
}

// De andre stemmer hemmeligt "tæt nok" — simpelt flertal afgør, ingen
// algoritmisk facit-tjek (menneskeligt skøn, jf. opgavebeskrivelsen).
function resolveJudge(state) {
  const c = state.complainer;
  const cur = c.current; // type: judge
  const yes = Object.values(cur.votes).filter(v => v === true).length;
  const no = Object.values(cur.votes).filter(v => v === false).length;
  endComplainerGame(state, yes > no);
}

function endComplainerGame(state, guiltyWon) {
  const c = state.complainer;
  if (c.wager === 'euro') {
    const payerIds = guiltyWon ? c.players.filter(id => id !== c.guiltyId) : [c.guiltyId];
    payerIds.forEach(id => {
      state.events.push({ id: uid(), memberId: id, message: 'Tabte Det Store Brokkeri', ts: Date.now(), votes: [], free: false, gameLoss: true });
    });
  }
  if (!state.complainerStats) state.complainerStats = {};
  const realPlayerIds = c.players.filter(id => !(state.members.find(x => x.id === id) || {}).isBot);
  realPlayerIds.forEach(id => {
    if (!state.complainerStats[id]) state.complainerStats[id] = { played: 0, wins: 0 };
    state.complainerStats[id].played += 1;
  });
  const winnerIds = guiltyWon ? [c.guiltyId] : c.players.filter(id => id !== c.guiltyId);
  winnerIds.filter(id => realPlayerIds.includes(id)).forEach(id => { state.complainerStats[id].wins += 1; });

  c.current = {
    type: 'gameover',
    guiltyId: c.guiltyId,
    guiltyWon,
    targetId: c.current.targetId,
    detail: c.current.detail,
    votes: c.current.votes,
    scores: c.scores,
    brokScores: c.brokScores, // separat "bedste brok"-regnskab, se Godt-brok!-mekanikken i api/complainer.js — ALDRIG sammenblandet med c.scores
    topSuspectHistory: c.topSuspectHistory,
  };
}

// Hvem mangler stadig at gøre noget for at den aktuelle fase kan gå videre?
// Samme rolle som Brokspillets/MrBrok's getPendingIds.
function getPendingComplainerIds(c) {
  const cur = c.current;
  if (!cur) return [];
  if (cur.type === 'complain') return [cur.speakerId];
  if (cur.type === 'interrogation') return [cur.speakerId];
  if (cur.type === 'vote') return c.players.filter(id => cur.votes[id] === undefined);
  if (cur.type === 'bet') return cur.choice ? [] : [cur.topId];
  if (cur.type === 'guess') return cur.targetId ? [] : [c.guiltyId];
  if (cur.type === 'judge') return c.players.filter(id => id !== c.guiltyId && cur.votes[id] === undefined);
  return [];
}

// Tvinger den aktuelle fase videre fordi en brok-nedtælling løb ud uden at
// den langsomme nåede det — samme filosofi som Brokspillet/MrBrok: intet
// stille spring, kun et synligt brok (menneske eller "Det Store Brokkeri selv")
// efterfulgt af en udløbet nedtælling må rykke fasen videre.
function forceResolveComplainerPhase(state) {
  const c = state.complainer;
  const cur = c.current;
  const pending = getPendingComplainerIds(c);
  if (cur.type === 'complain') {
    advanceComplain(state);
  } else if (cur.type === 'interrogation') {
    advanceInterrogation(state);
  } else if (cur.type === 'vote') {
    pending.forEach(id => {
      const others = c.players.filter(p => p !== id);
      cur.votes[id] = others.length ? pickRandom(others) : id;
    });
    resolveSuspicionRound(state);
  } else if (cur.type === 'bet') {
    cur.choice = 'safe';
    resolveBet(state);
  } else if (cur.type === 'guess') {
    const others = c.players.filter(p => p !== c.guiltyId);
    submitGuess(state, others.length ? pickRandom(others) : c.guiltyId, '(nåede ikke at gætte)');
  } else if (cur.type === 'judge') {
    pending.forEach(id => { cur.votes[id] = false; });
    resolveJudge(state);
  }
}

// Den ENESTE ting der har lov til at rykke Det Store Brokkeri videre pga. tid —
// kaldes opportunistisk fra enhver poll/handling, aldrig af klientens eget ur.
function expireComplainerPhaseIfDue(state) {
  const c = state.complainer;
  const cur = c && c.current;
  if (!c || !c.active || !cur || !cur.phaseStartedAt) return false;
  const pending = getPendingComplainerIds(c);
  if (pending.length === 0) return false;
  const now = Date.now();
  if (!cur.complaint) {
    if (now - cur.phaseStartedAt < BROKSPILLET_AUTO_MS) return false;
    cur.complaint = { by: 'brokkefaelden', targetId: pending[0], startedAt: now };
    return true;
  }
  if (now - cur.complaint.startedAt < COMPLAINT_COUNTDOWN_MS) return false;
  forceResolveComplainerPhase(state);
  return true;
}

module.exports = {
  SUSPECT_POINTS,
  MIN_COMPLAIN_AGE_MS,
  BROKSPILLET_AUTO_MS,
  COMPLAINT_COUNTDOWN_MS,
  assignArchetypesAndSituations,
  beginComplainRound,
  advanceComplain,
  beginVoteRound,
  resolveSuspicionRound,
  resolveBet,
  applyComplainerChallenge, // EXPERIMENTAL — se kommentaren ved funktionen
  beginReveal,
  beginInterrogationRound,
  advanceInterrogation,
  beginGuessPhase,
  submitGuess,
  resolveJudge,
  endComplainerGame,
  getPendingComplainerIds,
  expireComplainerPhaseIfDue,
  forceResolveComplainerPhase,
};
