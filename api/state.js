const { getState, setState, mutateState, processPendingExpiry, checkSilenceNudge, healPendingVotes, redactStateFor } = require('./_lib/store');
const { expireGamePhaseIfDue, BROKSPILLET_AUTO_MS, COMPLAINT_COUNTDOWN_MS } = require('./_lib/gameFlow');
const { expireMrbrokPhaseIfDue } = require('./_lib/mrbrokFlow');
const { expireComplainerPhaseIfDue } = require('./_lib/complainerFlow');
const { pushToMembers } = require('./_lib/push');

// Billig, ikke-muterende forhåndstjek: er der overhovedet en chance for at
// spilfasen skal tvinges videre pga. tid? Bruges til at undgå en CAS-runde
// (mutateState) på HVER eneste poll fra HVER klient hvert 3. sekund — kun
// når dette siger "måske" betaler vi for den rigtige, atomare mutation.
function gameExpiryMightBeDue(state) {
  const g = state.game;
  if (!g || !g.active || !g.current || !g.current.phaseStartedAt) return false;
  const cur = g.current;
  const now = Date.now();
  if (cur.complaint) return (now - cur.complaint.startedAt) >= COMPLAINT_COUNTDOWN_MS;
  return (now - cur.phaseStartedAt) >= BROKSPILLET_AUTO_MS;
}

// Samme billige forhåndstjek som gameExpiryMightBeDue, men for MrBrok.
function mrbrokExpiryMightBeDue(state) {
  const m = state.mrbrok;
  if (!m || !m.active || !m.current || !m.current.phaseStartedAt) return false;
  const cur = m.current;
  const now = Date.now();
  if (cur.complaint) return (now - cur.complaint.startedAt) >= COMPLAINT_COUNTDOWN_MS;
  return (now - cur.phaseStartedAt) >= BROKSPILLET_AUTO_MS;
}

// Samme billige forhåndstjek som gameExpiryMightBeDue/mrbrokExpiryMightBeDue,
// men for Det Store Brokkeri. VIGTIGT: uden dette (og det manglede — se
// commit-historikken) er expireComplainerPhaseIfDue kun nogensinde blevet
// kaldt fra api/complainer.js's egen handler, som kun kører når NOGEN rent
// faktisk POST'er en handling — men netop DÉT er hvad der ikke sker når en
// fase hænger fast (fx en test-bot der aldrig kan gætte fordi den ikke ved
// den er skyldig, se index.html's driveBotsForComplainer-kommentar). Uden
// dette opkald her — samme sted klienterne ALLIGEVEL poller hvert par
// sekunder — havde nødbremsen ingenting at trække i, og en hængt fase
// hang for evigt i stedet for at blive tvunget videre efter tid.
function complainerExpiryMightBeDue(state) {
  const c = state.complainer;
  if (!c || !c.active || !c.current || !c.current.phaseStartedAt) return false;
  const cur = c.current;
  const now = Date.now();
  if (cur.complaint) return (now - cur.complaint.startedAt) >= COMPLAINT_COUNTDOWN_MS;
  return (now - cur.phaseStartedAt) >= BROKSPILLET_AUTO_MS;
}

const SILENCE_LINES = [
  'Er alt for perfekt i dag? 🤔 Ingen har brokket sig i 24 timer... det virker mistænkeligt.',
  '24 timers stilhed i Brokkekassen. Enten er alt fantastisk, eller også holder nogen igen. 👀',
  'Boksen keder sig. Der må da være ét eneste lille brok i jer? 🫙',
  'Officiel påmindelse: at undertrykke sit brok er skadeligt for folkesundheden. Registrér det — for menneskehedens skyld. 🧑‍⚕️',
  'Videnskaben er enig: udiagnosticeret irritation vokser sig større i mørket. Bring det frem i lyset. 🔬',
  'Denne besked er en tjeneste fra Brokkekassen: husk at registrere jeres brok, som samfundsansvarlige borgere. 🫡',
];

module.exports = async (req, res) => {
  const roomId = (req.query.room || '').toString().trim();
  const memberId = (req.query.member || '').toString().trim();
  if (!roomId) return res.status(400).json({ error: 'mangler room' });
  try {
    let state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    // Klienterne poller herind hvert par sekunder mens appen er åben, så det
    // er her (i stedet for en rigtig cron-service) vi opportunistisk tjekker
    // hængende anklager for reminder/udløb.
    const dueReminders = processPendingExpiry(state);
    const nudgeSilence = checkSilenceNudge(state);
    // Selv samme selv-helbredning som brok.js — fanger en anklage der blev
    // hængende (fx pga. bots i "need") uden at kræve at nogen rører selve
    // afstemningen igen, siden klienterne poller herind konstant.
    const healedIds = healPendingVotes(state);
    if (dueReminders.length || nudgeSilence || healedIds.length) await setState(roomId, state);

    // Samme opportunistiske mønster for Brokspillets fase-timing — men denne
    // mutation involverer Math.random() (Chancen, indhold osv.), så den skal
    // gå gennem den CAS-beskyttede mutateState for ikke at risikere et
    // lost-update hvis to spilleres polls rammer samtidigt.
    if (gameExpiryMightBeDue(state)) {
      const mutated = await mutateState(roomId, async (fresh) => {
        const players = (fresh.game && fresh.game.players) || fresh.members.map(m => m.id);
        expireGamePhaseIfDue(fresh, players);
      });
      if (mutated) state = mutated.state;
    }

    // Samme opportunistiske mønster for MrBrok's tur/afstemnings-timing.
    if (mrbrokExpiryMightBeDue(state)) {
      const mutated = await mutateState(roomId, async (fresh) => {
        expireMrbrokPhaseIfDue(fresh);
      });
      if (mutated) state = mutated.state;
    }

    // Samme opportunistiske mønster for Det Store Brokkeris fase-timing.
    if (complainerExpiryMightBeDue(state)) {
      const mutated = await mutateState(roomId, async (fresh) => {
        expireComplainerPhaseIfDue(fresh);
      });
      if (mutated) state = mutated.state;
    }

    for (const { pending, memberIds } of dueReminders) {
      const accused = state.members.find(m => m.id === pending.memberId);
      try {
        await pushToMembers(state, state.members.map(m => m.id).filter(id => !memberIds.includes(id)), {
          title: '🙄 Husk at stemme!',
          body: `${accused ? accused.name : 'Nogen'} er stadig anklaget${pending.message ? ` — "${pending.message}"` : ''}. Sagen udløber om 12 timer.`,
          url: '/?r=' + roomId,
        });
      } catch (e) { /* push-fejl må ikke vælte state-kaldet */ }
    }

    if (nudgeSilence) {
      try {
        await pushToMembers(state, [], {
          title: '🏖️ Brokkekassen',
          body: SILENCE_LINES[Math.floor(Math.random() * SILENCE_LINES.length)],
          url: '/?r=' + roomId,
        });
      } catch (e) { /* push-fejl må ikke vælte state-kaldet */ }
    }

    res.status(200).json({ state: redactStateFor(state, memberId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
