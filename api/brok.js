const { getState, setState, mutateState, uid, neededVotes, healPendingVotes, isAdmin, checkPoolMilestone, redactStateFor, ApiError } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');
const { MIN_ABOUT_PER_PLAYER, mergeAboutEntries } = require('./_lib/game');

const MILESTONE_LINES = [
  m => `🎉 Puljen har rundet ${m}€! Det bliver et godt indkøb.`,
  m => `🥳 ${m}€ i Brokkekassen. I er godt i gang!`,
  m => `💰 Ding ding — ${m}€ nået. Fortsæt endelig sådan (eller lad være).`,
];

// Samler anklage/stem/annullér i én serverless function i stedet for tre —
// Vercels Hobby-plan tillader kun 12 functions i alt.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    // Selv-helbreder ÅBNE afstemninger der sidder fast pga. bots iberegnet i
    // "need" (se healPendingVotes i store.js) — kaldes på ENHVER brok-
    // handling, ikke kun 'vote', så en hængende anklage rettes med det
    // samme uden at nogen behøver stemme igen.
    const healedConfirmedIds = healPendingVotes(state);
    if (healedConfirmedIds.length) {
      checkPoolMilestone(state); // ryddet op i tælleren, selve push-linjen er ikke vigtig nok til at vente på her
      await setState(roomId, state);
    }

    if (action === 'vote') {
      const { voterId, pendingId } = req.body || {};
      if (!voterId || !pendingId) return res.status(400).json({ error: 'mangler data' });
      if (healedConfirmedIds.includes(pendingId)) {
        return res.status(200).json({ state: redactStateFor(state, voterId), confirmed: true, free: false });
      }
      const pending = state.pendingList.find(p => p.id === pendingId);
      if (!pending) return res.status(409).json({ error: 'afstemningen er ikke længere aktiv — genindlæs og prøv igen' });

      const idx = pending.votes.indexOf(voterId);
      if (idx === -1) pending.votes.push(voterId);
      else pending.votes.splice(idx, 1);

      const confirmedIds = healPendingVotes(state);
      const confirmed = confirmedIds.includes(pendingId);
      const confirmedEvent = confirmed ? (state.events.find(e => e.id === pendingId) || {}) : {};
      const free = !!confirmedEvent.free;
      const double = !!confirmedEvent.double;
      const milestone = confirmed ? checkPoolMilestone(state) : null;
      await setState(roomId, state);

      if (milestone) {
        try {
          const line = MILESTONE_LINES[Math.floor(Math.random() * MILESTONE_LINES.length)](milestone);
          await pushToMembers(state, [], { title: `🏖️ ${state.themeName || 'Brokkekassen'}`, body: line, url: '/?r=' + roomId });
        } catch (e) { /* push-fejl må ikke vælte selve stemmen */ }
      }

      return res.status(200).json({ state: redactStateFor(state, voterId), confirmed, free, double });
    }

    // Vennekassens personlige lag: hver deltager skriver FRIT VALGTE udsagn
    // om andre — MINDST MIN_ABOUT_PER_PLAYER (se _lib/game.js), intet loft
    // udover antal medspillere (Martins fund/ønske: "måske skal alle lave
    // et minimum antal... og kan så tilføje flere" — erstatter den
    // tidligere deterministiske round-robin-tildeling af præcis 2, hvor
    // spilleren ikke selv valgte target). Fødes ind i "kendskab"/
    // "hvemskrev"-rundetyperne, se MIN_ABOUT_FOR_KENDSKAB/
    // collectAboutCandidates i _lib/game.js. Et tidligere obligatorisk
    // "skriv om dig selv"-felt er fjernet helt (Martins fund: ingen
    // rundetype nogensinde læste det, ren friktion uden formål). mutateState
    // (CAS), IKKE den simple getState/setState resten af filen bruger —
    // flere medlemmer udfylder typisk laget samtidig lige efter de joiner,
    // hvilket er netop det scenarie CAS beskytter imod (se api/admin.js's
    // tilsvarende begrundelse for approveMember/rejectMember).
    if (action === 'personal') {
      const { actorId, aboutTexts } = req.body || {};
      if (!actorId) return res.status(400).json({ error: 'mangler data' });
      const mutated = await mutateState(roomId, async (fresh) => {
        if (!fresh.members.find(m => m.id === actorId)) throw new ApiError(400, 'ukendt medlem');
        if (!fresh.personalLayer) fresh.personalLayer = { entries: {} };
        const validTargetIds = new Set(fresh.members.map(m => m.id).filter(id => id !== actorId));
        const rawAbout = Array.isArray(aboutTexts) ? aboutTexts : [];
        const seenTargets = new Set();
        const about = [];
        // Loft på 40 rå indsendelser er et sanity-loft mod et opblæst
        // payload, IKKE en reel UX-grænse — antallet af GYLDIGE, unikke
        // targets er allerede naturligt begrænset af antal medspillere.
        rawAbout.slice(0, 40).forEach(item => {
          const targetId = item && item.targetId;
          const text = ((item && item.text) || '').toString().trim().slice(0, 120);
          if (!text || !targetId || !validTargetIds.has(targetId) || seenTargets.has(targetId)) return;
          seenTargets.add(targetId);
          about.push({ targetId, text });
        });
        // Fletter ind i en evt. eksisterende entry PR TARGETID (Opus-
        // simulering bekræftede: uden dette ville "runde 0"s tildelte
        // udsagn (se action:'start' i api/game.js) forsvinde i det øjeblik
        // nogen bagefter tilføjer ét mere via denne sheet — hverken tildelt
        // eller frit indhold må kunne overskrive det andet).
        const prevEntry = fresh.personalLayer.entries[actorId];
        const mergedAbout = mergeAboutEntries(prevEntry && prevEntry.about, about);
        // Kan aldrig kræve flere end der reelt findes andre medlemmer at
        // skrive om (fx et rum med kun 1 anden person). Tjekkes mod den
        // FLETTEDE liste, ikke kun denne indsendelse — allerede tildelte
        // udsagn fra runde 0 tæller med.
        const required = Math.min(MIN_ABOUT_PER_PLAYER, validTargetIds.size);
        if (mergedAbout.length < required) throw new ApiError(400, `skriv om mindst ${required} andre`);
        fresh.personalLayer.entries[actorId] = { submittedAt: Date.now(), about: mergedAbout };
      });
      if (!mutated) return res.status(404).json({ error: 'ukendt brokkekasse' });
      return res.status(200).json({ state: redactStateFor(mutated.state, actorId) });
    }

    if (action === 'cancel') {
      const { actorId, pendingId } = req.body || {};
      if (!pendingId) return res.status(400).json({ error: 'mangler data' });
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan afblæse' });
      state.pendingList = state.pendingList.filter(p => p.id !== pendingId);
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    // default: opret en ny anklage
    const { memberId, message, actorId } = req.body || {};
    if (!memberId) return res.status(400).json({ error: 'mangler data' });
    const cleanMessage = (message || '').toString().trim().slice(0, 80);
    if (!cleanMessage) return res.status(400).json({ error: 'skriv hvad de brokkede sig over — ellers ved ingen hvad de stemmer om' });
    if (!state.members.find(m => m.id === memberId)) return res.status(400).json({ error: 'ukendt medlem' });
    if (state.closed) return res.status(400).json({ error: 'brokkekassen er lukket' });
    if (state.pendingList.filter(p => p.memberId === memberId).length >= 2) {
      return res.status(409).json({ error: 'der er allerede 2 afstemninger i gang om denne person — vent til en af dem er afgjort' });
    }

    // Den der opretter anklagen er allerede vidne til at det skete, så deres
    // egen stemme tæller med med det samme — resten skal stadig bekræfte
    // uafhængigt (hvis man anklager sig selv, tæller det ikke som en stemme).
    // UNDTAGELSE (Del 1.3, "første-til-mølle"): her skal netop den FØRSTE
    // stemme UDOVER anklageren afgøre sagen — anklagerens egen vidne-stemme
    // må derfor ikke selv kunne udløse den øjeblikkelige afgørelse.
    const isFirstToVote = state.confirmationModel === 'first-to-vote';
    const initialVotes = (!isFirstToVote && actorId && actorId !== memberId && state.members.find(m => m.id === actorId)) ? [actorId] : [];
    const isHostApproval = state.confirmationModel === 'host-approval';
    state.pendingList.push({
      id: uid(),
      memberId,
      actorId: actorId || null,
      message: cleanMessage,
      votes: initialVotes,
      openedAt: Date.now(),
      need: (isFirstToVote || isHostApproval) ? 1 : neededVotes(state.members.filter(m => !m.isBot).length),
    });
    await setState(roomId, state);

    const accused = state.members.find(m => m.id === memberId);
    try {
      await pushToMembers(state, [memberId, actorId].filter(Boolean), {
        title: `🙄 Ny sag i ${state.themeName || 'Brokkekassen'}!`,
        body: `${accused ? accused.name : 'Nogen'} er anklaget${cleanMessage ? ` — "${cleanMessage}"` : ''}. Kom og stem!`,
        url: '/?r=' + roomId,
      });
      await setState(roomId, state); // gemmer evt. oprydning af udløbne subscriptions
    } catch (e) { /* push-fejl må ikke vælte selve anklagelsen */ }

    res.status(200).json({ state: redactStateFor(state, actorId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
