const { redis } = require('./redis');
// Det Store Brokkeri ("The Big Complainer") — helt selvstændigt tredje spil (se
// CLAUDE.md), egen state-gren (state.complainer), eget flow
// (_lib/complainerFlow.js). Kun redaktions-hjælperen bruges herfra, og kun
// fra _lib/complainer.js (INDHOLD, ingen afhængighed af store.js), for at
// undgå en cirkulær require med _lib/complainerFlow.js (som selv bruger
// store.js's uid()).
const { redactComplainerFor } = require('./complainer');

// Fejl med en HTTP-statuskode knyttet til sig — kastes inde fra en
// mutateState-mutator for at afbryde MED DET SAMME (ingen retry, en
// valideringsfejl retter sig ikke af at prøve igen) og give det rigtige
// statuskode/besked tilbage til klienten.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Normaliseret til små bogstaver, så det ikke betyder noget om telefonens
// tastatur autokapitaliserede første bogstav i koden (fx "Skygge-ophy").
const KEY = (roomId) => `brokkekassen:room:${(roomId || '').toString().trim().toLowerCase()}`;

// Den der opretter en brokkekasse er dens admin: den første, der nogensinde
// joiner rummet, bliver stående som members[0] og er dermed admin for altid.
function isAdmin(state, memberId) {
  return !!(state && state.members[0] && state.members[0].id === memberId);
}

const RESET_HOUR = 4; // ny runde starter kl 04 lokal tid
const RESET_TZ = 'Europe/Copenhagen';

function emptyState() {
  return {
    createdAt: Date.now(), // brokkekassens fødselsdag — rykkes ALDRIG efter oprettelse
    dayBoundary: Date.now(), // starten af "i dag", til streaks/lodtrækning og "Dagens BigSpender"
    members: [],   // {id, name}
    events: [],    // {id, memberId, message, ts, votes:[voterIds], free} — vokser bare, tømmes kun ved manuel "Gør op"
    pendingList: [], // [{id, memberId, message, votes:[voterIds], openedAt, need}] — flere kan være i gang samtidig
    history: [],   // {startedAt, closedAt, total, totals:{memberId:amt}, events:[...]} — kun fra manuel "Gør op"/lukning
    freeBrokMemberId: null, // dagens heldige vinder af gratis brok, trukket tilfældigt
    freeBrokDrawnAt: null,  // tidsstempel for seneste lodtrækning, til at vise animationen præcis én gang pr. trækning
    streaks: {},   // memberId -> antal sammenhængende dage uden brok
    closed: false, // hele brokkekassen er lukket permanent (ingen flere brok)
    pushSubs: {},  // memberId -> PushSubscription, til rigtige push-notifikationer
    goal: '',      // fri tekst sat af admin: hvad potten går til, fx "Fælles middag"
    acquittals: [], // {id, memberId, message, openedAt, expiredAt} — anklager der udløb uden nok stemmer
    lastSilenceNudgeAt: null, // sidste gang alle fik en "her er stille" push, til at undgå at spamme
    lastMilestoneAt: 0, // højeste rundetal (10, 20, 30...) puljen allerede er fejret ved
    game: { active: false }, // Brokspillet — se api/game.js + api/_lib/game.js
    gameStats: {}, // memberId -> {played, wins} — highscore på tværs af afsluttede Brokspil-runder
    mrbrok: { active: false }, // MrBrok — se api/mrbrok.js + api/_lib/mrbrok.js
    mrbrokStats: {}, // memberId -> {played, wins} — highscore på tværs af afsluttede MrBrok-runder
    complainer: { active: false }, // Det Store Brokkeri — se api/complainer.js + api/_lib/complainerFlow.js. Tredje, HELT selvstændige spil — ikke en gren af MrBrok, se CLAUDE.md.
    complainerStats: {}, // memberId -> {played, wins} — highscore på tværs af afsluttede Det Store Brokkeri-runder
    // Sat én gang ved oprettelse — Brokkekassen, Brokspillet, MrBrok og
    // Det Store Brokkeri er ligestillede valg, man kan vælge en, flere eller alle.
    // Styrer kun hvad der vises.
    kasseEnabled: true,
    gameEnabled: true,
    mrbrokEnabled: true,
    complainerEnabled: true,
    gameContentBank: { truefalse: [] }, // sandt/falsk-udsagn folk har skrevet — genbruges nogle gange i senere spil
  };
}

const PENDING_REMINDER_AFTER = 12 * 3600000; // push-reminder til dem der mangler at stemme
const PENDING_EXPIRE_AFTER = 24 * 3600000;   // herefter frikendes anklagen automatisk

// Tjekker ventende anklager for påmindelse/udløb. Kaldes fra state.js (som
// alle klienter poller hvert 3. sek, mens appen er åben) — ingen rigtig cron
// nødvendig. Returnerer hvem der skal have en reminder-push nu; selve
// push-afsendelsen sker udenfor store.js, som ikke kender til push.js.
function processPendingExpiry(state) {
  const now = Date.now();
  const dueReminders = [];
  if (!state.acquittals) state.acquittals = [];
  state.pendingList = state.pendingList.filter(p => {
    const age = now - p.openedAt;
    if (age >= PENDING_EXPIRE_AFTER) {
      state.acquittals.push({ id: p.id, memberId: p.memberId, message: p.message, openedAt: p.openedAt, expiredAt: now });
      return false;
    }
    if (age >= PENDING_REMINDER_AFTER && !p.reminded) {
      p.reminded = true;
      const memberIds = state.members.map(m => m.id).filter(id => id !== p.memberId && !p.votes.includes(id));
      if (memberIds.length) dueReminders.push({ pending: p, memberIds });
    }
    return true;
  });
  return dueReminders;
}

const SILENCE_NUDGE_AFTER = 24 * 3600000; // så længe stilhed før vi drilsk minder om at boksen findes
const QUIET_HOURS_START = 21; // ingen push efter kl. 21...
const QUIET_HOURS_END = 8;    // ...før kl. 08 lokal tid

// Aktuel lokal time i Copenhagen (0-23), til at holde push ude af nattetimer.
function copenhagenLocalHour(ts) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: RESET_TZ, hourCycle: 'h23', hour: '2-digit' });
  return parseInt(dtf.format(new Date(ts)), 10);
}

// Har der været fuldstændig stille (ingen brok) i over 24 timer? Returnerer
// true højst én gang per stille-periode — sender selv ikke push, ligesom
// processPendingExpiry, det gør api/state.js. Sendes aldrig i nattetimerne;
// falder bare tilbage og prøver igen ved næste poll efter kl. 08.
function checkSilenceNudge(state) {
  if (state.closed || state.members.length < 2) return false;
  const lastEventTs = state.events.reduce((max, e) => Math.max(max, e.ts), 0);
  const lastActivity = Math.max(lastEventTs, state.dayBoundary, state.createdAt);
  const now = Date.now();
  if (now - lastActivity < SILENCE_NUDGE_AFTER) return false;
  if (state.lastSilenceNudgeAt && state.lastSilenceNudgeAt > lastActivity) return false;
  const hour = copenhagenLocalHour(now);
  if (hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END) return false;
  state.lastSilenceNudgeAt = now;
  return true;
}

const MILESTONE_STEP = 10; // fejrer hver 10€ i den aktive pulje

// Har puljen lige rundet et nyt 10€-mærke? Returnerer det nye mærke (eller
// null), og opdaterer state så det samme mærke ikke fejres to gange. Nulstilles
// ved "Gør op" (se settleRound), så en ny runde igen kan fejre fra 10€.
function checkPoolMilestone(state) {
  const total = state.events.filter(e => !e.free && !e.voided).length;
  const milestone = Math.floor(total / MILESTONE_STEP) * MILESTONE_STEP;
  if (milestone > 0 && milestone > (state.lastMilestoneAt || 0)) {
    state.lastMilestoneAt = milestone;
    return milestone;
  }
  return null;
}

// Finder Copenhagen-tidszonens offset (minutter) for et givent tidspunkt.
function copenhagenOffsetMinutes(ts) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: RESET_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const map = {};
  dtf.formatToParts(new Date(ts)).forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
  const asIfUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute);
  return Math.round((asIfUTC - ts) / 60000);
}

// Tidspunktet for næste kl. 04 lokal tid, strengt efter `ts`.
function nextDailyReset(ts) {
  const offsetMin = copenhagenOffsetMinutes(ts);
  const local = new Date(ts + offsetMin * 60000);
  local.setUTCHours(RESET_HOUR, 0, 0, 0);
  let resetLocal = local.getTime();
  if (resetLocal <= ts + offsetMin * 60000) resetLocal += 86400000;
  return resetLocal - offsetMin * 60000;
}

// Opdaterer alles "dage uden brok"-streak (kun ud fra brok siden dayBoundary)
// og trækker tilfældigt lod om dagens gratis brok blandt alle medlemmer.
// Bruges både af den automatiske daglige afregning og af manuel "Gør op" —
// men rører ALDRIG selve puljen (events). Krukken tømmer ikke sig selv.
function updateStreaksAndDrawLottery(state) {
  const anyCount = {};
  state.members.forEach(m => (anyCount[m.id] = 0));
  state.events.forEach(e => {
    if (e.ts >= state.dayBoundary && anyCount[e.memberId] !== undefined) anyCount[e.memberId]++;
  });

  if (!state.streaks) state.streaks = {};
  state.members.forEach(m => {
    state.streaks[m.id] = (anyCount[m.id] || 0) === 0 ? (state.streaks[m.id] || 0) + 1 : 0;
  });

  // gratis brok trækkes ved rent lod blandt alle RIGTIGE medlemmer — ikke
  // som en belønning for god opførsel, det ville modarbejde hele pointen i
  // at brokke sig mindst. Bots er kun til test-spil (se isBot i room.js) og
  // må aldrig kunne vinde noget i en rigtig brokkekasse.
  const realMembers = state.members.filter(m => !m.isBot);
  let nextFree = null;
  if (realMembers.length > 1) {
    nextFree = realMembers[Math.floor(Math.random() * realMembers.length)].id;
  }
  state.freeBrokMemberId = nextFree;
  state.freeBrokDrawnAt = Date.now();
  state.dayBoundary = Date.now();
}

// Admin-genvej til at trække dagens gratis brok om, UDEN at røre streaks
// eller dayBoundary (i modsætning til updateStreaksAndDrawLottery ovenfor,
// som kun skal køre ved en reel dags-skift/opgørelse). Bruges til at rette
// en allerede-trukket vinder (fx en bot der blev trukket før bot-filtreret
// blev rettet) uden at det tæller som en ny dag.
function redrawFreeBrok(state) {
  const realMembers = state.members.filter(m => !m.isBot);
  let nextFree = null;
  if (realMembers.length > 1) {
    nextFree = realMembers[Math.floor(Math.random() * realMembers.length)].id;
  }
  state.freeBrokMemberId = nextFree;
  state.freeBrokDrawnAt = Date.now();
}

// Ny dag starter automatisk kl. 04 lokal tid: streaks og lodtrækning
// opdateres, men puljen (events) er urørt — den tømmes kun ved en bevidst
// "Gør op". Så det ikke kræver at nogen husker noget manuelt hver dag.
function autoSettleIfDue(state) {
  if (state.closed) return false;
  if (Date.now() < nextDailyReset(state.dayBoundary)) return false;
  updateStreaksAndDrawLottery(state);
  return true;
}

// Manuel "Gør op"/endelig lukning: arkiverer HELE den akkumulerede pulje i
// historikken og tømmer den — den eneste måde krukken reelt tømmes på.
// Opdaterer også streaks/lodtrækning for det stykke tid der lige er gået.
function settleRound(state) {
  updateStreaksAndDrawLottery(state);

  const totals = {};
  // Bots må aldrig blive stående i den arkiverede historik — de er kun til
  // test-spil, se isBot i room.js.
  state.members.filter(m => !m.isBot).forEach(m => (totals[m.id] = 0));
  state.events.forEach(e => { if (!e.free && !e.voided && totals[e.memberId] !== undefined) totals[e.memberId]++; });

  state.history.push({
    startedAt: state.createdAt,
    closedAt: Date.now(),
    total: state.events.filter(e => !e.free && !e.voided).length,
    totals,
    events: state.events,
  });

  state.events = [];
  state.pendingList = [];
  state.lastMilestoneAt = 0; // ny runde, ny chance for at fejre 10€ igen
  return state;
}

// Bringer en rå indlæst state op til den nyeste form (nye felter med
// standardværdier, selvhelbredelse af ældre/ufuldstændige spil-objekter).
// Delt mellem den almindelige læsevej (getState) og den CAS-baserede
// skrivevej (mutateState), så begge altid ser samme migrerede facon.
function applyMigrations(state) {
  if (state.closed === undefined) state.closed = false;
  if (!state.pushSubs) state.pushSubs = {};
  if (!state.streaks) state.streaks = {};
  if (state.goal === undefined) state.goal = '';
  if (!state.dayBoundary) state.dayBoundary = Date.now();
  if (state.freeBrokDrawnAt === undefined) state.freeBrokDrawnAt = null;
  if (!state.acquittals) state.acquittals = [];
  if (state.lastSilenceNudgeAt === undefined) state.lastSilenceNudgeAt = null;
  if (state.lastMilestoneAt === undefined) state.lastMilestoneAt = 0;
  if (!state.game) state.game = { active: false };
  // Selvhelbred spil der blev startet under en ældre version uden players-
  // feltet — de kan ikke renderes korrekt, så behandl dem som opgivet i
  // stedet for at lade klienten crashe stille når den forsøger at åbne dem.
  if (state.game.active && !state.game.players) state.game = { active: false };
  if (!state.gameStats) state.gameStats = {};
  if (state.gameEnabled === undefined) state.gameEnabled = true;
  if (state.kasseEnabled === undefined) state.kasseEnabled = true;
  if (state.mrbrokEnabled === undefined) state.mrbrokEnabled = true;
  if (!state.mrbrok) state.mrbrok = { active: false };
  if (state.mrbrok.active && !state.mrbrok.players) state.mrbrok = { active: false };
  if (!state.mrbrokStats) state.mrbrokStats = {};
  if (state.complainerEnabled === undefined) state.complainerEnabled = true;
  if (!state.complainer) state.complainer = { active: false };
  // Selvhelbred et spil startet under en ældre version uden players-feltet —
  // samme filosofi som Brokspillet/MrBrok ovenfor.
  if (state.complainer.active && !state.complainer.players) state.complainer = { active: false };
  if (!state.complainerStats) state.complainerStats = {};
  if (!state.gameContentBank) state.gameContentBank = { truefalse: [] };
  if (!state.pendingList) {
    // migrering fra det gamle enkelt-pending-felt til en liste
    state.pendingList = state.pending ? [state.pending] : [];
  }
  delete state.pending;
  return state;
}

async function getState(roomId) {
  const raw = await redis().get(KEY(roomId));
  if (!raw) return null;
  // upstash client auto-parses JSON if it was set as an object; handle both cases
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  applyMigrations(state);
  if (autoSettleIfDue(state)) await setState(roomId, state);
  return state;
}

// Atomisk "check-and-set": skriver kun hvis værdien i Redis stadig er
// PRÆCIS den samme som da vi læste den (oldRaw). Kører som ét Lua-script
// direkte på Redis-serveren, så der ikke er noget tidsrum mellem tjek og
// skriv hvor en anden samtidig forespørgsel kan nå at skrive ind imellem.
const CAS_SCRIPT = `
  local current = redis.call('GET', KEYS[1])
  if current == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
  else
    return 0
  end
`;
async function casSetState(roomId, oldRaw, newState) {
  const ok = await redis().eval(CAS_SCRIPT, [KEY(roomId)], [oldRaw, JSON.stringify(newState)]);
  return !!ok;
}

// Læs-mutér-skriv der er sikker mod samtidige skriv fra flere spillere der
// trykker på samme tid (fx alle stemmer i samme sekund i Brokspillet/
// MrBrok). Uden dette kan to samtidige forespørgsler begge læse den samme
// "gamle" state, og den sidste der skriver overskriver stille den førstes
// ændring — et klassisk lost-update-problem, bekræftet i praksis ved at
// simulere realistisk netværks-latenstid mod Redis. `fn` kan mutere
// `state` frit og må gerne kaste en fejl (fx en valideringsfejl) — det
// stopper med det samme uden at forsøge igen, da et nyt forsøg alligevel
// ikke ville rette en valideringsfejl.
async function mutateState(roomId, fn) {
  const MAX_ATTEMPTS = 8;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await redis().get(KEY(roomId));
    if (raw === null || raw === undefined) return null;
    const oldRaw = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const state = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw));
    applyMigrations(state);
    const result = await fn(state);
    const ok = await casSetState(roomId, oldRaw, state);
    if (ok) return { state, result };
    // Nogen andre nåede at skrive imellem vores læsning og skrivning —
    // vent kort (med lidt tilfældighed så flere samtidige forsøg ikke bare
    // rammer hinanden igen og igen) og prøv hele mutationen forfra mod
    // frisk data.
    await new Promise(r => setTimeout(r, 15 + Math.random() * 35 * (attempt + 1)));
  }
  const err = new Error('Kunne ikke gemme — for mange forsøgte samtidig, prøv igen om lidt');
  err.isConflict = true;
  throw err;
}

async function setState(roomId, state) {
  await redis().set(KEY(roomId), JSON.stringify(state));
  return state;
}

// Sletter rummet fuldstændigt — til fx en brokkekasse oprettet ved en fejl.
// Anderledes end "Luk for altid", som bevarer rummet og dets historik.
async function deleteRoom(roomId) {
  await redis().del(KEY(roomId));
}

async function createRoom(roomId, opts) {
  const existing = await getState(roomId);
  if (existing) return existing;
  const state = emptyState();
  if (opts && opts.kasseEnabled === false) state.kasseEnabled = false;
  if (opts && opts.gameEnabled === false) state.gameEnabled = false;
  if (opts && opts.mrbrokEnabled === false) state.mrbrokEnabled = false;
  if (opts && opts.complainerEnabled === false) state.complainerEnabled = false;
  await setState(roomId, state);
  return state;
}

function genRoomId() {
  const words = ['sol', 'strand', 'palme', 'bolge', 'sand', 'is', 'brise', 'skygge'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.random().toString(36).slice(2, 6);
  return `${w}-${n}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function neededVotes(totalMembers) {
  const others = Math.max(totalMembers - 1, 1);
  return Math.min(others, Math.max(2, Math.ceil((others * 2) / 3)));
}

// Bots (test-spillere, se room.js's join-handler) kan aldrig stemme — de er
// bevidst skjult fra afstemnings-UI'en (se index.html) — så en anklage der
// beregnede sit "need" ud fra state.members.length (bots iberegnet) kunne
// blive hængende under det nødvendige antal for evigt. Genberegner "need" ud
// fra kun de RIGTIGE medlemmer, og flytter enhver afstemning der allerede
// har nok stemmer over i feedet med det samme. Kaldes både fra hver
// brok-handling og fra state.js's poll, så en gammel hængende anklage
// selv-helbreder uden at nogen behøver stemme igen.
function healPendingVotes(state) {
  if (!state.pendingList || !state.pendingList.length) return [];
  const realMemberCount = state.members.filter(m => !m.isBot).length;
  const correctNeed = neededVotes(realMemberCount);
  state.pendingList.forEach(p => { if (p.need > correctNeed) p.need = correctNeed; });

  const confirmedIds = [];
  state.pendingList = state.pendingList.filter(p => {
    if (p.votes.length < p.need) return true;
    const free = !!(state.freeBrokMemberId && state.freeBrokMemberId === p.memberId);
    state.events.push({ id: p.id, memberId: p.memberId, message: p.message, ts: Date.now(), votes: p.votes, free });
    if (free) state.freeBrokMemberId = null;
    confirmedIds.push(p.id);
    return false;
  });
  return confirmedIds;
}

// MrBrok gemmer en hemmelighed i state.mrbrok (hvem der er MrBrok, og selve
// emnet) — men hele state sendes som én samlet JSON-blob til klienten ved
// hver poll/handling, så vi er nødt til at maskere de hemmelige felter ud
// fra HVEM der kigger, hver gang state skal serialiseres til et svar. Brugt
// af alle api/-filer der returnerer `state` i deres svar.
function redactStateFor(state, viewerId) {
  const m = state.mrbrok;
  // VIGTIGT: dette tidlige return dækker KUN mrbrok-redaktionen — det må
  // ALDRIG kortslutte hele funktionen, for så springes Det Store Brokkeris
  // egen redaktion (redactComplainerFor) over hver gang MrBrok ikke er
  // aktivt, hvilket ville lække guiltyId til alle klienter i praksis (fanget
  // af dette spils egen smoke-test, se scripts_test_complainer.js).
  if (!m || !m.active || (m.current && m.current.type === 'gameover')) return redactComplainerFor(state, viewerId);
  const isMrBrok = !!(viewerId && viewerId === m.mrBrokId);
  // voteHistory (tidligere runders afstemninger) holdes skjult MENS spillet
  // er i gang — samme filosofi som Brokspillets round-history — og
  // afsløres først i den fulde, uredigerede state når type bliver
  // 'gameover' (se det tidlige return ovenfor).
  const safe = { ...m, mrBrokId: undefined, youAreMrBrok: isMrBrok, voteHistory: undefined };
  if (isMrBrok) safe.topic = undefined;
  if (safe.current && (safe.current.type === 'vote' || safe.current.type === 'steal') && safe.current.votes) {
    const mine = viewerId && Object.prototype.hasOwnProperty.call(safe.current.votes, viewerId);
    // Antallet af indsendte stemmer er ikke hemmeligt (kun HVEM der stemte
    // hvad er) — sendes med så klienten kan vise en fremdrifts-bar uden at
    // lække andres stemmer.
    safe.current = { ...safe.current, voteCount: Object.keys(safe.current.votes).length, votes: mine ? { [viewerId]: safe.current.votes[viewerId] } : {} };
  }
  const withMrbrok = { ...state, mrbrok: safe };
  // Det Store Brokkeri har sin egen hemmelighed (hvem der er "skyldig") og sin
  // egen redaktion — se _lib/complainer.js's redactComplainerFor. Kædet
  // herfra så ALLE svar (inkl. api/state.js's poll) maskerer den, ikke kun
  // api/complainer.js selv.
  return redactComplainerFor(withMrbrok, viewerId);
}

module.exports = { getState, setState, mutateState, ApiError, deleteRoom, createRoom, genRoomId, uid, emptyState, neededVotes, healPendingVotes, isAdmin, settleRound, updateStreaksAndDrawLottery, redrawFreeBrok, processPendingExpiry, checkSilenceNudge, checkPoolMilestone, redactStateFor };
