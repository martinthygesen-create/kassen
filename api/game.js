const { mutateState, redactStateFor, ApiError } = require('./_lib/store');
const { beginRound, buildOptions, pickDecoyBroks, pickQuiplashDecoys } = require('./_lib/game');
const { pushToMembers } = require('./_lib/push');
const {
  MIN_COMPLAIN_AGE_MS,
  stampPhase,
  getPendingIds,
  resolveQuiplashVote,
  resolveQuiplashRandom,
  resolveTrueFalseGuess,
  resolveGuessBrok,
  resolveTriviaAnswer,
  resolveCasinobrok,
  resolveCasinobrokBet,
  transitionRoseToMatch,
  resolveRoseMatch,
  goToNextRoundOrEnd,
  expireGamePhaseIfDue,
} = require('./_lib/gameFlow');

const DEFAULT_ROUNDS = 8;
const ALLOWED_ROUNDS = [5, 8, 12];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId, actorId } = req.body || {};
    if (!roomId || !actorId) return res.status(400).json({ error: 'mangler data' });

    // Al læsning+mutation+skrivning sker inde i mutateState, som automatisk
    // prøver igen mod frisk data hvis en anden spiller nåede at skrive
    // først (fx alle der stemmer i samme sekund) — ellers ville den sidste
    // skrivning stille overskrive den forrige, og en spillers svar kunne gå
    // helt tabt uden nogen fejl at se.
    let pushInfo = null;
    const mutated = await mutateState(roomId, async (state) => {
      if (!state.members.find(m => m.id === actorId)) throw new ApiError(400, 'ukendt medlem');
      if (!state.game) state.game = { active: false };

      if (action === 'start') {
        if (state.game.active) throw new ApiError(409, 'spillet er allerede i gang');
        if (state.mrbrok && state.mrbrok.active) throw new ApiError(409, 'MrBrok er i gang — afslut det først');
        if (state.complainer && state.complainer.active) throw new ApiError(409, 'Det Store Brokkeri er i gang — afslut det først');
        const requested = Array.isArray(req.body.playerIds) ? req.body.playerIds : state.members.map(m => m.id);
        const players = state.members.map(m => m.id).filter(id => requested.includes(id));
        if (players.length < 2) throw new ApiError(400, 'vælg mindst 2 spillere');
        const wager = req.body.wager === 'euro' ? 'euro' : 'fun';
        const totalRounds = ALLOWED_ROUNDS.includes(req.body.totalRounds) ? req.body.totalRounds : DEFAULT_ROUNDS;
        const scores = {};
        players.forEach(id => (scores[id] = 0));
        state.game = { active: true, wager, players, round: 0, totalRounds, scores, current: null, startedAt: Date.now() };
        beginRound(state, state.members.filter(m => players.includes(m.id)));
        stampPhase(state.game.current);
        const starter = state.members.find(m => m.id === actorId);
        // Kun de FAKTISK VALGTE spillere skal have en "kom med!"-push — ellers
        // inviteres rummets øvrige medlemmer ind i en runde de slet ikke er
        // en del af (de ville bare lande på "du kigger med"-skærmen).
        const notInGame = state.members.map(m => m.id).filter(id => !players.includes(id));
        pushInfo = { excludeIds: [actorId, ...notInGame], title: '🎲 Brokspillet er i gang!', body: `${starter ? starter.name : 'Nogen'} startede et spil — kom med!`, url: '/?r=' + roomId };
        return;
      }

      if (!state.game.active) throw new ApiError(409, 'der er ikke noget spil i gang');

      // Enhver handling i et aktivt spil tjekker først opportunistisk om den
      // aktuelle fase skal tvinges videre pga. en udløbet brok-nedtælling —
      // samme mønster som anklage-udløb i api/state.js. Betyder at selv en
      // spiller der bare prøver at indsende noget helt andet kan udløse
      // oprydningen, ikke kun den 3-sekunders poll — men ALDRIG et klient-ur.
      const playersForExpiry = state.game.players || state.members.map(m => m.id);
      expireGamePhaseIfDue(state, playersForExpiry);

      const cur = state.game.current;
      const players = state.game.players || state.members.map(m => m.id);

      if (action === 'submit') {
        const { payload } = req.body || {};
        if (!cur || !payload) throw new ApiError(400, 'mangler data');
        if (!players.includes(actorId)) throw new ApiError(403, 'du er ikke med i denne runde af Brokspillet');

        if (cur.type === 'quiplash' && cur.phase === 'answer') {
          const text = (payload.text || '').toString().trim().slice(0, 120);
          if (text) cur.answers[actorId] = text;
          if (Object.keys(cur.answers).length >= players.length) {
            if (players.length === 2) resolveQuiplashRandom(state, cur);
            else {
              cur.phase = 'vote';
              cur.votes = {};
              // Et par opdigtede svar blandet ind gør det sværere at
              // gennemskue hvem der skrev hvad — flere decoys når der er
              // få rigtige svar at vælge imellem (så det ikke er for nemt),
              // færre når der allerede er nok rigtige at sortere i.
              const decoyTexts = pickQuiplashDecoys(state, players.length <= 3 ? 2 : 1);
              cur.decoys = decoyTexts.map((text, i) => ({ id: 'decoy' + i, text }));
              stampPhase(cur);
            }
          }
        } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
          if (payload.votedFor && payload.votedFor !== actorId) cur.votes[actorId] = payload.votedFor;
          if (Object.keys(cur.votes).length >= players.length) resolveQuiplashVote(state, cur);
        } else if (cur.type === 'truefalse' && cur.phase === 'write') {
          if (actorId !== cur.authorId) throw new ApiError(403, 'kun den der skriver rundens udsagn kan gøre dette');
          const targetId = payload.targetId && players.includes(payload.targetId) ? payload.targetId : cur.authorId;
          const statement = (payload.statement || '').toString().trim().slice(0, 120);
          if (!statement) throw new ApiError(400, 'skriv et udsagn');
          cur.targetId = targetId;
          cur.statement = statement;
          cur.isTrue = !!payload.isTrue;
          cur.phase = 'guess';
          stampPhase(cur);
          // Gemmes til senere spil — content skal ikke gå til spilde.
          if (!state.gameContentBank) state.gameContentBank = { truefalse: [] };
          if (!state.gameContentBank.truefalse) state.gameContentBank.truefalse = [];
          state.gameContentBank.truefalse.push({ authorId: cur.authorId, targetId, statement, isTrue: cur.isTrue, ts: Date.now() });
          if (state.gameContentBank.truefalse.length > 60) state.gameContentBank.truefalse.shift();
        } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
          if (cur.authorId && actorId === cur.authorId) throw new ApiError(403, 'du kan ikke gætte på dit eget udsagn');
          cur.guesses[actorId] = !!payload.guess;
          // Ved et "verdens-brok"-udsagn (isWorld) er der ingen forfatter der
          // sidder over — ALLE spillere gætter, så tærsklen er players.length
          // i stedet for players.length - 1.
          const eligible = cur.authorId ? players.length - 1 : players.length;
          if (Object.keys(cur.guesses).length >= eligible) resolveTrueFalseGuess(state, cur);
        } else if (cur.type === 'trivia' && cur.phase === 'answer') {
          if (Number.isInteger(payload.choiceIndex)) cur.choices[actorId] = payload.choiceIndex;
          if (Object.keys(cur.choices).length >= players.length) resolveTriviaAnswer(state, cur);
        } else if (cur.type === 'guessbrok' && cur.phase === 'write') {
          if (actorId !== cur.authorId) throw new ApiError(403, 'kun den der skriver rundens brok kan gøre dette');
          const statement = (payload.statement || '').toString().trim().slice(0, 120);
          if (!statement) throw new ApiError(400, 'skriv et brok');
          const decoys = pickDecoyBroks(state, 3, statement);
          const { options, correctIndex } = buildOptions(statement, decoys);
          cur.statement = statement;
          cur.options = options;
          cur.correctIndex = correctIndex;
          cur.phase = 'guess';
          cur.guesses = {};
          stampPhase(cur);
        } else if (cur.type === 'guessbrok' && cur.phase === 'guess') {
          if (actorId === cur.authorId) throw new ApiError(403, 'du kan ikke gætte på dit eget brok');
          if (Number.isInteger(payload.choiceIndex)) cur.guesses[actorId] = payload.choiceIndex;
          if (Object.keys(cur.guesses).length >= players.length - 1) resolveGuessBrok(state, cur);
        } else if (cur.type === 'casinobrok' && cur.phase === 'write') {
          const word = (payload.word || '').toString().trim().slice(0, 24);
          if (!word) throw new ApiError(400, 'skriv et brok-ord');
          cur.words[actorId] = word;
          if (Object.keys(cur.words).length >= players.length) resolveCasinobrok(state, cur);
        } else if (cur.type === 'casinobrok' && cur.phase === 'bet') {
          if (cur.bets[actorId] !== undefined) throw new ApiError(409, 'du har allerede valgt');
          const choice = payload.choice === 'gamble' ? 'gamble' : 'safe';
          resolveCasinobrokBet(state, cur, actorId, choice);
          if (Object.keys(cur.bets).length >= players.length) {
            cur.phase = 'results';
            cur.readyIds = [];
            stampPhase(cur);
          }
        } else if (cur.type === 'rose' && cur.phase === 'write') {
          const compliment = (payload.compliment || '').toString().trim().slice(0, 140);
          if (!compliment) throw new ApiError(400, 'skriv en ros');
          cur.compliments[actorId] = compliment;
          if (Object.keys(cur.compliments).length >= players.length) transitionRoseToMatch(state, cur, players);
        } else if (cur.type === 'rose' && cur.phase === 'match') {
          const raw = payload.guesses && typeof payload.guesses === 'object' ? payload.guesses : {};
          const sanitized = {};
          Object.keys(raw).forEach(recipientId => {
            if (players.includes(recipientId) && players.includes(raw[recipientId])) sanitized[recipientId] = raw[recipientId];
          });
          cur.guesses[actorId] = sanitized;
          if (Object.keys(cur.guesses).length >= players.length) resolveRoseMatch(state, cur, players);
        } else {
          throw new ApiError(400, 'ugyldig handling lige nu');
        }
        return;
      }

      // "ready" er spillerens EGET valg om at gå videre — bruges i resultat-
      // pausen mellem runder, hvor der ikke er noget at indsende. Runden går
      // først videre når alle er klar, eller når en brok-nedtælling løber ud
      // (se expireGamePhaseIfDue).
      if (action === 'ready') {
        if (!cur || (cur.phase !== 'results' && cur.phase !== 'skipped')) throw new ApiError(400, 'kan ikke gøres klar lige nu');
        if (!players.includes(actorId)) throw new ApiError(403, 'du er ikke med i denne runde af Brokspillet');
        if (!cur.readyIds) cur.readyIds = [];
        if (!cur.readyIds.includes(actorId)) cur.readyIds.push(actorId);
        if (cur.readyIds.length >= players.length) goToNextRoundOrEnd(state, players);
        return;
      }

      // "complain" — en spiller der SELV allerede er færdig med sin del af
      // fasen kan brokke sig over en navngiven langsom medspiller. Det er
      // det ENESTE der kan starte den korte tvangs-nedtælling (udover
      // Brokspillets egen automatiske variant i expireGamePhaseIfDue) — der
      // findes ingen anden vej til at tvinge en fase videre pga. tid.
      if (action === 'complain') {
        if (!cur) throw new ApiError(400, 'ingen aktiv runde');
        if (!players.includes(actorId)) throw new ApiError(403, 'du er ikke med i denne runde af Brokspillet');
        const pending = getPendingIds(cur, players);
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
        state.game = { active: false };
        return;
      }

      throw new ApiError(400, 'ukendt handling');
    });
    if (!mutated) return res.status(404).json({ error: 'ukendt brokkekasse' });
    const { state } = mutated;

    if (pushInfo) {
      try { await pushToMembers(state, pushInfo.excludeIds, { title: pushInfo.title, body: pushInfo.body, url: pushInfo.url }); }
      catch (e) { /* push-fejl må ikke vælte selve handlingen */ }
    }

    return res.status(200).json({ state: redactStateFor(state, actorId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
