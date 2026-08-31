const { mutateState, redactStateFor, ApiError } = require('./_lib/store');
const { pickTopic, pickMrBrok } = require('./_lib/mrbrok');
const {
  MIN_COMPLAIN_AGE_MS,
  beginClueRound,
  advanceClue,
  resolveVote,
  resolveSteal,
  getPendingMrbrokIds,
  expireMrbrokPhaseIfDue,
} = require('./_lib/mrbrokFlow');
const { pushToMembers } = require('./_lib/push');

const MIN_PLAYERS = 3;
const DEFAULT_WARMUP = 3;
// 1 er bevidst fjernet som mulighed — 2 rolige runder (1 imitation + 1 Q&A)
// var for kort til reelt at nå at danne sig en mening, oven i at det også
// gjorde et 3-spiller-spils allerede hårde eliminations-matematik (se
// mrbrokFlow.js) endnu hårdere. 4+ er fjernet igen efter feedback om at det
// var for mange runder i praksis — 2-3 er nok. Standarden (3) er kalibreret
// til et typisk 4-personers spil på ca. 12-16 minutter i alt — se
// minWarmupForPlayers.
const ALLOWED_WARMUP = [2, 3];

// Worst case (MrBrok never fanget ved et forkert gæt) tager
// (players.length - 2) afstemningsrunder før spillet tvinges til en
// afgørelse (se resolveVote's activeIds<=2-check). Rolige runder (1
// imitations-runde + warmupRounds) skal udgøre MINDST halvdelen af det
// samlede antal runder, ellers bruger man mere tid på at se folk blive
// stemt ud end på rent faktisk at lære rollen at kende — især mærkbart
// i store grupper. +1 for imitations-runden, som ikke er en af de
// konfigurerede warmupRounds (se mrbrokFlow.js's advanceClue).
function minWarmupForPlayers(n) {
  return Math.max(2, n - 3);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId, actorId } = req.body || {};
    if (!roomId || !actorId) return res.status(400).json({ error: 'mangler data' });

    // Se api/game.js for hvorfor mutateState (CAS + retry) bruges her i
    // stedet for almindelig getState+setState: uden det kan to samtidige
    // spillere (fx alle der stemmer i samme sekund) stille overskrive
    // hinandens svar.
    let pushInfo = null;
    const mutated = await mutateState(roomId, async (state) => {
      if (!state.members.find(mm => mm.id === actorId)) throw new ApiError(400, 'ukendt medlem');
      if (!state.mrbrok) state.mrbrok = { active: false };

      if (action === 'start') {
        if (state.mrbrok.active) throw new ApiError(409, 'MrBrok er allerede i gang');
        if (state.game && state.game.active) throw new ApiError(409, 'Brokspillet er i gang — afslut det først');
        if (state.complainer && state.complainer.active) throw new ApiError(409, 'Det Store Brokkeri er i gang — afslut det først');
        const requested = Array.isArray(req.body.playerIds) ? req.body.playerIds : state.members.map(mm => mm.id);
        const playerObjs = state.members.filter(mm => requested.includes(mm.id));
        if (playerObjs.length < MIN_PLAYERS) throw new ApiError(400, `vælg mindst ${MIN_PLAYERS} spillere`);
        const wager = req.body.wager === 'euro' ? 'euro' : 'fun';
        const requestedWarmup = ALLOWED_WARMUP.includes(req.body.warmupRounds) ? req.body.warmupRounds : DEFAULT_WARMUP;
        const warmupRounds = Math.max(requestedWarmup, minWarmupForPlayers(playerObjs.length));
        const players = playerObjs.map(mm => mm.id);
        const mrBrokId = pickMrBrok(state, playerObjs).id;
        const scores = {};
        players.forEach(id => { if (id !== mrBrokId) scores[id] = 0; });

        state.mrbrok = {
          active: true, wager, players, activeIds: players.slice(), eliminatedIds: [],
          mrBrokId, topic: pickTopic(state), warmupRounds,
          round: 0, scores, caught: false, voteHistory: [], current: null, startedAt: Date.now(),
        };
        beginClueRound(state, 1);

        const starter = state.members.find(mm => mm.id === actorId);
        // Kun de FAKTISK VALGTE spillere skal have en "kom med!"-push — ellers
        // inviteres rummets øvrige medlemmer ind i en runde de slet ikke er
        // en del af.
        const notInGame = state.members.map(mm => mm.id).filter(id => !players.includes(id));
        pushInfo = { excludeIds: [actorId, ...notInGame], title: '🕵️ MrBrok er i gang!', body: `${starter ? starter.name : 'Nogen'} startede et spil — kom med!`, url: '/?r=' + roomId };
        return;
      }

      if (!state.mrbrok.active) throw new ApiError(409, 'der er ikke noget MrBrok-spil i gang');
      const m = state.mrbrok;

      // Enhver handling i et aktivt spil tjekker først opportunistisk om
      // den aktuelle fase skal tvinges videre pga. en udløbet brok-
      // nedtælling — samme mønster som Brokspillet (se expireGamePhaseIfDue).
      expireMrbrokPhaseIfDue(state);
      const cur = m.current;

      if (action === 'submit') {
        const { payload } = req.body || {};
        if (!cur || !payload) throw new ApiError(400, 'mangler data');

        if (cur.type === 'clue') {
          if (actorId !== cur.speakerId) throw new ApiError(403, 'det er ikke din tur lige nu');
          advanceClue(state);
        } else if (cur.type === 'vote') {
          if (!m.activeIds.includes(actorId)) throw new ApiError(403, 'du er ikke aktiv i denne omgang af MrBrok');
          const votedForId = payload.votedForId;
          if (votedForId === actorId) throw new ApiError(400, 'du kan ikke stemme på dig selv');
          if (!m.activeIds.includes(votedForId)) throw new ApiError(400, 'ukendt spiller');
          cur.votes[actorId] = votedForId;
          if (Object.keys(cur.votes).length >= m.activeIds.length) resolveVote(state);
        } else if (cur.type === 'steal' && !cur.guess) {
          if (actorId !== m.mrBrokId) throw new ApiError(403, 'kun MrBrok kan gætte emnet');
          const text = (payload.guess || '').toString().trim().slice(0, 140);
          if (!text) throw new ApiError(400, 'skriv dit gæt');
          cur.guess = text;
        } else if (cur.type === 'steal' && cur.guess) {
          if (actorId === m.mrBrokId) throw new ApiError(403, 'du kan ikke stemme om dit eget gæt');
          if (!m.activeIds.includes(actorId)) throw new ApiError(403, 'du er ikke aktiv i denne omgang af MrBrok');
          cur.votes[actorId] = !!payload.closeEnough;
          if (Object.keys(cur.votes).length >= m.activeIds.length) resolveSteal(state);
        } else {
          throw new ApiError(400, 'ugyldig handling lige nu');
        }
        return;
      }

      // "complain" — samme filosofi som Brokspillet: en spiller der selv
      // allerede er færdig kan brokke sig over en navngiven langsom
      // medspiller efter lidt tid, hvilket starter en kort tvangs-
      // nedtælling. Kun relevante spillere (stadig aktive, eller MrBrok
      // selv under tyveri-fasen) kan brokke sig — allerede eliminerede
      // tilskuere har ikke noget at skulle have sagt.
      if (action === 'complain') {
        if (!cur) throw new ApiError(400, 'ingen aktiv runde');
        const relevant = m.activeIds.includes(actorId) || actorId === m.mrBrokId;
        if (!relevant) throw new ApiError(403, 'du er ikke aktiv i dette spil af MrBrok');
        const pending = getPendingMrbrokIds(m);
        if (pending.length === 0) throw new ApiError(400, 'der er ingen at brokke sig over lige nu');
        if (pending.includes(actorId)) throw new ApiError(403, 'du skal selv være færdig før du kan brokke dig over andre');
        if (cur.complaint) throw new ApiError(409, 'der er allerede brokket over nogen i denne runde');
        if (!cur.phaseStartedAt || (Date.now() - cur.phaseStartedAt) < MIN_COMPLAIN_AGE_MS) {
          throw new ApiError(400, 'giv dem lidt mere tid endnu');
        }
        const requestedTarget = req.body && req.body.payload && req.body.payload.targetId;
        const targetId = pending.includes(requestedTarget) ? requestedTarget : pending[0];
        cur.complaint = { by: actorId, targetId, startedAt: Date.now() };
        return;
      }

      if (action === 'end') {
        state.mrbrok = { active: false };
        return;
      }

      throw new ApiError(400, 'ukendt handling');
    });
    if (!mutated) return res.status(404).json({ error: 'ukendt brokkekasse' });
    const { state } = mutated;

    if (pushInfo) {
      try { await pushToMembers(state, pushInfo.excludeIds, { title: pushInfo.title, body: pushInfo.body, url: pushInfo.url }); }
      catch (e) { /* push-fejl må ikke vælte selve spilstarten */ }
    }

    return res.status(200).json({ state: redactStateFor(state, actorId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
