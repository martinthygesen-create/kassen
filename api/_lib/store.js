const { redis } = require('./redis');
// Det Store Brokkeri ("The Big Complainer") — helt selvstændigt tredje spil (se
// CLAUDE.md), egen state-gren (state.complainer), eget flow
// (_lib/complainerFlow.js). Kun redaktions-hjælperen bruges herfra, og kun
// fra _lib/complainer.js (INDHOLD, ingen afhængighed af store.js), for at
// undgå en cirkulær require med _lib/complainerFlow.js (som selv bruger
// store.js's uid()).
const { redactComplainerFor, CONTENT_BY_THEME: COMPLAINER_CONTENT_BY_THEME } = require('./complainer');
// Kasse-motor-generalisering, Fase 4 (se god-finding-men-du-lovely-zephyr.md):
// kun for at læse hver spils tema-afhængige gameName ind i redactStateFor
// nedenfor — INGEN cirkulær require-risiko, da mrbrok.js/game.js ikke
// selv kræver store.js (kun complainerFlow.js/mrbrokFlow.js gør, og de er
// separate filer fra selve indholds-filerne).
const { CONTENT_BY_THEME: MRBROK_CONTENT_BY_THEME } = require('./mrbrok');
const { CONTENT_BY_THEME: GAME_CONTENT_BY_THEME } = require('./game');

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

// Kasse-motor-generalisering (Fase 3, se god-finding-men-du-lovely-zephyr.md):
// sekundær rolle ud over isAdmin(), for indholds-tunge skabeloner (fx en
// quiz-tung skin) hvor for meget opsætning ellers ligger på én person.
// isAdmin ALENE afgør fortsat de mest destruktive handlinger (slet rum,
// nulstil alt) — cohost får adgang til den daglige drift, ikke til at
// fjerne/udpege andre cohosts eller ødelægge rummet.
function isCohost(state, memberId) {
  return !!(state && Array.isArray(state.cohostIds) && memberId && state.cohostIds.includes(memberId));
}
function hasAdminAccess(state, memberId) {
  return isAdmin(state, memberId) || isCohost(state, memberId);
}

const RESET_HOUR = 3; // ny runde starter kl 03 lokal tid (jf. rum-dynamik-protokollen)
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

    // --- Kasse-motor-generalisering (se god-finding-men-du-lovely-zephyr.md) ---
    // Alle defaults herunder reproducerer nuværende Brokkekassen-adfærd 1:1 —
    // dette er Fase 0, ingen synlig ændring, kun nye felter klar til at blive brugt.
    themeId: 'brok',           // nøgle ind i CONTENT_BY_THEME/QUESTION_TEMPLATES_BY_THEME
    themeName: 'Brokkekassen', // fri tekst, brugervendt, erstatter hardcoded "Brokkekassen" i UI
    ruleTagline: 'Brokker du dig, koster det 1€.', // kort regel-forklaring, erstatter hardcoded "Ferie-reglen"
    unit: '€',
    poolPolarity: 'punishment', // 'punishment' | 'reward' — styrer wager-retning (taber betaler vs. vinder optjener)
    confirmationModel: 'quorum', // 'quorum' | 'host-approval' — styrer KUN krukke-hændelser, aldrig selve spillet
    dailyRhythm: true,          // slukker/tænder streaks+lodtrækning+SILENCE_LINES samlet, når false
    cohostIds: [],               // sekundær rolle ud over isAdmin() — se api/admin.js
    accessModel: 'open',         // 'open' | 'approval' — join-godkendelse
    pendingMembers: [],          // {id, name, email, requestedAt} — kun brugt når accessModel==='approval'
    // Kasse-motor-generalisering ("Tilgængelighedsvindue"-variabel, se
    // KASSEMOTORPLAN.md's "Motor-variabler"-afsnit): manuel værts-toggle der
    // blokerer NYE anklager mens den er slået til — dækker "ikke under
    // undervisning"/"ikke under møder"/"ikke under programpunkter" med
    // samme ene knap, ikke poker-specifik. Rører aldrig eksisterende
    // ventende afstemninger, kun oprettelse af NYE.
    pausedByHost: false,
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
  // Kasse-motor-generalisering (Fase 2): dailyRhythm:false slukker
  // stilhed-påmindelsen helt — den antager en daglig cyklus (24t stilhed),
  // meningsløs for en session-baseret skabelon. Se planens "Simulering:
  // bevarer skabelon-modellen 'det sjove'"-afsnit.
  if (state.dailyRhythm === false) return false;
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

// Billigt, ikke-muterende forhåndstjek — samme princip som
// gameExpiryMightBeDue/mrbrokExpiryMightBeDue/complainerExpiryMightBeDue i
// api/state.js: undgår en CAS-skriverunde (mutateState) på HVER poll fra
// HVER klient hvert 3. sekund, når der reelt intet er at opdatere. Duplikat
// af de rene betingelser fra processPendingExpiry/checkSilenceNudge, UDEN
// selve mutationen — en tilladt let overtrigning (fx pendingList ikke-tom
// men intet reelt udløbet endnu) er billigere end at risikere at MISSE en
// reel due-tilstand.
function opportunisticStateChangeMightBeDue(state) {
  if (state.pendingList && state.pendingList.length) return true;
  if (state.dailyRhythm === false) return false;
  if (state.closed || state.members.length < 2) return false;
  const lastEventTs = state.events.reduce((max, e) => Math.max(max, e.ts), 0);
  const lastActivity = Math.max(lastEventTs, state.dayBoundary, state.createdAt);
  const now = Date.now();
  if (now - lastActivity < SILENCE_NUDGE_AFTER) return false;
  if (state.lastSilenceNudgeAt && state.lastSilenceNudgeAt > lastActivity) return false;
  const hour = copenhagenLocalHour(now);
  if (hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END) return false;
  return true;
}

const MILESTONE_STEP = 10; // fejrer hver 10€ i den aktive pulje

// Har puljen lige rundet et nyt 10€-mærke? Returnerer det nye mærke (eller
// null), og opdaterer state så det samme mærke ikke fejres to gange. Nulstilles
// ved "Gør op" (se settleRound), så en ny runde igen kan fejre fra 10€.
function checkPoolMilestone(state) {
  const total = state.events.reduce((sum, e) => sum + (e.voided ? 0 : e.free ? 0 : e.double ? 2 : 1), 0);
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
  // Kasse-motor-generalisering (Fase 2): dailyRhythm:false slukker den
  // automatiske dags-cyklus (streaks/lodtrækning) helt — kun meningsfuldt
  // hvis noget rent faktisk sker næsten hver dag i denne skabelon.
  if (state.dailyRhythm === false) return false;
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

  // Samme vægtning som index.html's eventWeight() (tech-fix #2): en
  // "double"-hændelse (reward-lykketrækning) tæller 2, "free" tæller 0.
  const weight = e => e.voided ? 0 : e.free ? 0 : e.double ? 2 : 1;
  const totals = {};
  // Bots må aldrig blive stående i den arkiverede historik — de er kun til
  // test-spil, se isBot i room.js.
  state.members.filter(m => !m.isBot).forEach(m => (totals[m.id] = 0));
  state.events.forEach(e => { const w = weight(e); if (w && totals[e.memberId] !== undefined) totals[e.memberId] += w; });

  state.history.push({
    startedAt: state.createdAt,
    closedAt: Date.now(),
    total: state.events.reduce((sum, e) => sum + weight(e), 0),
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
  // Kasse-motor-generalisering (Fase 0) — defaults reproducerer nuværende
  // Brokkekassen-adfærd 1:1 for alle rum oprettet før disse felter fandtes.
  if (!state.themeId) state.themeId = 'brok';
  if (!state.themeName) state.themeName = 'Brokkekassen';
  if (state.ruleTagline === undefined) state.ruleTagline = 'Brokker du dig, koster det 1€.';
  if (!state.unit) state.unit = '€';
  if (!state.poolPolarity) state.poolPolarity = 'punishment';
  if (!state.confirmationModel) state.confirmationModel = 'quorum';
  if (state.dailyRhythm === undefined) state.dailyRhythm = true;
  if (!state.cohostIds) state.cohostIds = [];
  if (!state.accessModel) state.accessModel = 'open';
  if (!state.pendingMembers) state.pendingMembers = [];
  if (state.pausedByHost === undefined) state.pausedByHost = false;
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
  // Kasse-motor-generalisering (Fase 0) — alle valgfrie, udelades betyder
  // Brokkekassens egne defaults fra emptyState() (uændret adfærd).
  if (opts && opts.themeId) state.themeId = opts.themeId;
  if (opts && opts.themeName) state.themeName = opts.themeName;
  if (opts && opts.ruleTagline !== undefined) state.ruleTagline = opts.ruleTagline;
  if (opts && opts.unit) state.unit = opts.unit;
  if (opts && opts.poolPolarity) state.poolPolarity = opts.poolPolarity;
  if (opts && opts.confirmationModel) state.confirmationModel = opts.confirmationModel;
  if (opts && opts.dailyRhythm === false) state.dailyRhythm = false;
  if (opts && opts.accessModel === 'approval') state.accessModel = 'approval';
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
  // Fundet ved logik-verifikation (E2E-gennemspilning på tværs af skins):
  // state.confirmationModel er sat og valgt i opret-flowet ("Alle bekræfter
  // sammen" vs. "Én bestemmer"), men blev ALDRIG rent faktisk læst her —
  // kvorum-tærsklen (neededVotes) gjaldt uændret for host-approval-rum, så
  // fx Hjælperkassen ("bedømt af holdlederen" ifølge sin egen beskrivelse)
  // krævede i praksis stadig kvorum-stemmer fra ALLE medlemmer, præcis som
  // Brokkekassen. host-approval betyder nu reelt at kun én stemme fra en
  // admin/cohost tæller, uanset hvor mange medlemmer der ellers er.
  const isHostApproval = state.confirmationModel === 'host-approval';
  const realMemberCount = state.members.filter(m => !m.isBot).length;
  const correctNeed = isHostApproval ? 1 : neededVotes(realMemberCount);
  state.pendingList.forEach(p => { if (p.need > correctNeed) p.need = correctNeed; });

  const confirmedIds = [];
  state.pendingList = state.pendingList.filter(p => {
    if (isHostApproval) {
      const hasAdminVote = p.votes.some(id => hasAdminAccess(state, id));
      if (!hasAdminVote) return true;
    } else if (p.votes.length < p.need) {
      return true;
    }
    // Rum-dynamik-protokollen, tech-fix #2: lykketrækningens "vinder" gav
    // FØR altid en "gratis omgang" (tæller 0, se index.html's
    // totalPool/balances) — for punishment-polaritet (Brokkekassen m.fl.)
    // giver det mening som en fribillet. For REWARD-polaritet
    // (Rosekassen/Konkurrencekassen) betyder "tæller 0" derimod at en god
    // gerning/sejr bliver ANNULLERET, hvilket er bagvendt — en "gevinst" på
    // en gevinst-baseret kasse skal give en BONUS (dobbelt værdi), ikke en
    // udslettelse. Samme lodtræknings-mekanik (freeBrokMemberId), forskellig
    // konsekvens afhængig af state.poolPolarity.
    const isLucky = !!(state.freeBrokMemberId && state.freeBrokMemberId === p.memberId);
    const isReward = state.poolPolarity === 'reward';
    const free = isLucky && !isReward;
    const double = isLucky && isReward;
    state.events.push({ id: p.id, memberId: p.memberId, message: p.message, ts: Date.now(), votes: p.votes, free, double });
    if (isLucky) state.freeBrokMemberId = null;
    confirmedIds.push(p.id);
    return false;
  });
  return confirmedIds;
}

// Kasse-motor-generalisering, Fase 4: spilnavne er tema-afhængige (fx
// "Bødedetektiven" i stedet for "MrBrok"), se planens punkt om at
// spilnavne er brok-brandede og skal reskinnes pr. tema — klienten skal
// aldrig selv duplikere denne opslags-logik (index.html:1688-fundet fra
// UI-audit-bilaget). Ukendt/manglende tema falder tilbage til 'brok's
// navne, samme fallback-princip som resten af CONTENT_BY_THEME.
function getGameNames(themeId) {
  return {
    spil: (GAME_CONTENT_BY_THEME[themeId] || GAME_CONTENT_BY_THEME.brok).gameName,
    mrbrok: (MRBROK_CONTENT_BY_THEME[themeId] || MRBROK_CONTENT_BY_THEME.brok).gameName,
    complainer: (COMPLAINER_CONTENT_BY_THEME[themeId] || COMPLAINER_CONTENT_BY_THEME.brok).gameName,
  };
}

// MrBrok gemmer en hemmelighed i state.mrbrok (hvem der er MrBrok, og selve
// emnet) — men hele state sendes som én samlet JSON-blob til klienten ved
// hver poll/handling, så vi er nødt til at maskere de hemmelige felter ud
// fra HVEM der kigger, hver gang state skal serialiseres til et svar. Brugt
// af alle api/-filer der returnerer `state` i deres svar.
//
// Kasse-motor-generalisering, Fase 4: ydre funktion tilføjet KUN for at
// hægte `gameNames` på uanset hvilken af de to interne exit-veje
// (mrbrok-inaktiv-tidligt-retur vs. den fulde sti) der rammes — selve
// redaktions-logikken herunder (nu `redactStateForInner`) er UÆNDRET.
function redactStateFor(state, viewerId) {
  const redacted = redactStateForInner(state, viewerId);
  return { ...redacted, gameNames: getGameNames(state.themeId) };
}

function redactStateForInner(state, viewerId) {
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

module.exports = { getState, setState, mutateState, ApiError, deleteRoom, createRoom, genRoomId, uid, emptyState, neededVotes, healPendingVotes, isAdmin, isCohost, hasAdminAccess, settleRound, updateStreaksAndDrawLottery, redrawFreeBrok, processPendingExpiry, checkSilenceNudge, opportunisticStateChangeMightBeDue, checkPoolMilestone, redactStateFor, getGameNames, PENDING_REMINDER_AFTER, PENDING_EXPIRE_AFTER };
