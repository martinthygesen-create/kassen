const { getState, setState, uid, neededVotes, healPendingVotes, isAdmin, checkPoolMilestone, redactStateFor } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

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
    // "Tilgængelighedsvindue" (se planen): værten har sat rummet på pause —
    // blokerer kun NYE anklager, rører aldrig allerede ventende afstemninger.
    if (state.pausedByHost) return res.status(400).json({ error: 'sat på pause af værten lige nu — prøv igen senere' });
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
