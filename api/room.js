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
      if (!member) {
        // isBot markerer et rent test-medlem (se admin-menuernes "Test-spil
        // med bots") — spilles automatisk af klienten der satte det i gang,
        // aldrig af en rigtig person. Ingen andre server-side forskelle.
        member = { id: uid(), name: cleanName, email: email ? email.trim().slice(0, 80) : null, isBot: !!isBot };
        state.members.push(member);
        await setState(roomId, state);
      }
      return res.status(200).json({ memberId: member.id, state: redactStateFor(state, member.id) });
    }

    // default: opret et nyt rum
    let roomId = genRoomId();
    const kasseEnabled = !(req.body && req.body.kasseEnabled === false);
    const gameEnabled = !(req.body && req.body.gameEnabled === false);
    const mrbrokEnabled = !(req.body && req.body.mrbrokEnabled === false);
    const complainerEnabled = !(req.body && req.body.complainerEnabled === false);
    if (!kasseEnabled && !gameEnabled && !mrbrokEnabled && !complainerEnabled) return res.status(400).json({ error: 'vælg mindst én' });
    const state = await createRoom(roomId, { kasseEnabled, gameEnabled, mrbrokEnabled, complainerEnabled });
    res.status(200).json({ roomId, state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
