const { getState, setState } = require('./_lib/store');

// Samler "hent vapid public key" (GET) og "gem push-subscription" (POST) i
// én serverless function i stedet for to — Vercels Hobby-plan tillader kun
// 12 functions i alt. De to handlinger var altid adskilt på HTTP-metode, så
// det er en gratis sammenlægning.
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, memberId, subscription } = req.body || {};
    if (!roomId || !memberId || !subscription) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.members.find(m => m.id === memberId)) return res.status(400).json({ error: 'ukendt medlem' });

    if (!state.pushSubs) state.pushSubs = {};
    state.pushSubs[memberId] = subscription;
    await setState(roomId, state);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
