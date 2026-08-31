const { createRoom, genRoomId, getState, setState, uid, redactStateFor } = require('./_lib/store');

// Samler "opret rum" og "join rum" i én serverless function i stedet for to —
// Vercels Hobby-plan tillader kun 12 functions i alt.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action } = req.body || {};

    if (action === 'join') {
      const { roomId, name, email, isBot } = req.body || {};
      if (!roomId || !name || !name.trim()) return res.status(400).json({ error: 'mangler navn' });
      const state = await getState(roomId);
      if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

      const cleanName = name.trim().slice(0, 24);
      let member = state.members.find(m => m.name.toLowerCase() === cleanName.toLowerCase());
      if (member) return res.status(200).json({ memberId: member.id, state: redactStateFor(state, member.id) });

      // Kasse-motor-generalisering, operationelt valg "adgang" (se
      // KASSEMOTORPLAN.md's "To lag"-afsnit): accessModel:'approval' betyder
      // NYE medlemmer venter på værtens/medværtens godkendelse i stedet for
      // at komme direkte ind — allerede kendte navne (fundet ovenfor) er
      // altid velkomne tilbage uden ny godkendelse. Bots (test-spil) er
      // undtaget — de bruges kun internt af en allerede-godkendt admin.
      if (state.accessModel === 'approval' && !isBot) {
        if (!Array.isArray(state.pendingMembers)) state.pendingMembers = [];
        let pending = state.pendingMembers.find(p => p.name.toLowerCase() === cleanName.toLowerCase());
        if (!pending) {
          pending = { id: uid(), name: cleanName, email: email ? email.trim().slice(0, 80) : null, requestedAt: Date.now() };
          state.pendingMembers.push(pending);
          await setState(roomId, state);
        }
        return res.status(200).json({ pending: true, pendingId: pending.id, state: redactStateFor(state, null) });
      }

      // isBot markerer et rent test-medlem (se admin-menuernes "Test-spil
      // med bots") — spilles automatisk af klienten der satte det i gang,
      // aldrig af en rigtig person. Ingen andre server-side forskelle.
      member = { id: uid(), name: cleanName, email: email ? email.trim().slice(0, 80) : null, isBot: !!isBot };
      state.members.push(member);
      await setState(roomId, state);
      return res.status(200).json({ memberId: member.id, state: redactStateFor(state, member.id) });
    }

    // default: opret et nyt rum
    let roomId = genRoomId();
    const kasseEnabled = !(req.body && req.body.kasseEnabled === false);
    const gameEnabled = !(req.body && req.body.gameEnabled === false);
    const mrbrokEnabled = !(req.body && req.body.mrbrokEnabled === false);
    const complainerEnabled = !(req.body && req.body.complainerEnabled === false);
    if (!kasseEnabled && !gameEnabled && !mrbrokEnabled && !complainerEnabled) return res.status(400).json({ error: 'vælg mindst én' });
    // Kasse-motor-generalisering, Fase 4: skabelon-felter fra oprettelses-UI
    // videresendes til createRoom (som allerede accepterer dem, Fase 0) —
    // alle valgfrie, udeladt betyder Brokkekassens egne defaults fra
    // emptyState() (uændret adfærd for eksisterende/ældre klienter).
    const { themeId, themeName, ruleTagline, unit, poolPolarity, confirmationModel, dailyRhythm, accessModel } = req.body || {};
    const state = await createRoom(roomId, {
      kasseEnabled, gameEnabled, mrbrokEnabled, complainerEnabled,
      themeId, themeName, ruleTagline, unit, poolPolarity, confirmationModel, dailyRhythm, accessModel,
    });
    res.status(200).json({ roomId, state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
