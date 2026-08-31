const { getState, setState, deleteRoom, emptyState, isAdmin, settleRound, redrawFreeBrok, redactStateFor } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

// Samler admin-handlingerne (gør op, luk, nulstil, besked, mål) i én
// serverless function i stedet for fem — Vercels Hobby-plan tillader kun
// 12 functions i alt, og hver fil under /api tæller som én.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId, actorId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    if (action === 'settle') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan gøre op' });
      if (!state.events.length) return res.status(400).json({ error: 'puljen er tom' });
      settleRound(state);
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (action === 'close') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan lukke den' });
      if (state.closed) return res.status(400).json({ error: 'brokkekassen er allerede lukket' });
      if (state.events.length) settleRound(state);
      state.pendingList = [];
      state.closed = true;
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (action === 'undoArchive') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan gøre dette' });
      if (!state.history.length) return res.status(400).json({ error: 'ingen tidligere opgørelse at fortryde' });
      const last = state.history.pop();
      state.events = [...last.events, ...state.events];
      state.createdAt = last.startedAt;
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (action === 'redrawFreeBrok') {
      // Trækker dagens gratis brok om blandt kun de rigtige medlemmer —
      // rører hverken streaks eller dayBoundary (se redrawFreeBrok i
      // store.js). Tænkt som en engangsrettelse hvis en tidligere trækning
      // (fx før bot-filtreringen blev rettet) ramte en test-bot.
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan gøre dette' });
      redrawFreeBrok(state);
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (action === 'backdate') {
      // Midlertidig admin-genvej: rykker krukkens fødselsdag en dag tilbage,
      // så dag-tælleren matcher virkeligheden efter det tidligere auto-reset-bug.
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan gøre dette' });
      state.createdAt -= 86400000;
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (action === 'flagEvent') {
      // Admin markerer et allerede godkendt brok som mistænkt snyd (fx
      // sammenrotning om en uretfærdig anklage), eller fortryder markeringen.
      // Det bliver stående i feedet så det regulerer sig selv via social
      // skam, men tæller ikke med i puljen/regnskabet mens det er markeret.
      const { eventId, voided } = req.body || {};
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan gøre dette' });
      if (!eventId) return res.status(400).json({ error: 'mangler data' });
      const ev = state.events.find(e => e.id === eventId);
      if (!ev) return res.status(404).json({ error: 'brok findes ikke længere' });
      ev.voided = !!voided;
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (action === 'deleteRoom') {
      // Sletter rummet helt — fx en brokkekasse der blev oprettet ved en
      // fejl. Anderledes end "Luk for altid": her forsvinder ALT, ingen
      // historik bevares, og koden holder op med at virke for altid.
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan slette den' });
      await deleteRoom(roomId);
      return res.status(200).json({ deleted: true });
    }

    if (action === 'reset') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan nulstille' });
      const fresh = emptyState();
      fresh.members = state.members;
      await setState(roomId, fresh);
      return res.status(200).json({ state: fresh });
    }

    if (action === 'resetGameStats') {
      // Nulstiller kun Brokspillets highscore (sejre/spillede runder på
      // tværs af afsluttede spil) — rører hverken selve puljen, et
      // eventuelt spil i gang, eller MrBroks egen highscore.
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan nulstille highscore' });
      state.gameStats = {};
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'resetComplainerStats') {
      // Nulstiller kun Det Store Brokkeris highscore — rører hverken puljen,
      // et eventuelt spil i gang, eller Brokspillets/MrBroks egen highscore.
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan nulstille highscore' });
      state.complainerStats = {};
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'broadcast') {
      const { message } = req.body || {};
      if (!message || !message.trim()) return res.status(400).json({ error: 'mangler besked' });
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan sende beskeder' });
      const cleanMessage = message.toString().trim().slice(0, 200);
      await pushToMembers(state, [], {
        title: '🏖️ Brokkekassen',
        body: cleanMessage,
        url: '/?r=' + roomId,
      });
      const sentTo = Object.keys(state.pushSubs || {}).length;
      await setState(roomId, state); // gemmer evt. oprydning af udløbne subscriptions
      return res.status(200).json({ ok: true, sentTo });
    }

    if (action === 'goal') {
      const { goal } = req.body || {};
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan sætte mål' });
      state.goal = (goal || '').toString().trim().slice(0, 100);
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    return res.status(400).json({ error: 'ukendt handling' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
