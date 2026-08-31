const { mutateState, redactStateFor, ApiError } = require('./_lib/store');
const { assignArchetypesAndSituations } = require('./_lib/complainer');
const {
  MIN_COMPLAIN_AGE_MS,
  beginComplainRound,
  advanceComplain,
  advanceInterrogation,
  resolveSuspicionRound,
  resolveBet,
  applyComplainerChallenge, // EXPERIMENTAL — se complainerFlow.js's kommentar ved funktionen
  submitGuess,
  resolveJudge,
  getPendingComplainerIds,
  expireComplainerPhaseIfDue,
} = require('./_lib/complainerFlow');
const { pushToMembers } = require('./_lib/push');

const MIN_PLAYERS = 3;
const DEFAULT_ROUNDS = 4;
// 3-6 opbygningsrunder, jf. opgavebeskrivelsen — under 3 er ikke nok
// materiale til hverken mistankeafstemningen eller gættefinalen til at have
// noget at arbejde med; over 6 blev vurderet for langtrukkent for et spil
// der (ligesom MrBrok) skal kunne rummes i en almindelig aften.
const ALLOWED_ROUNDS = [3, 4, 5, 6];

// Det Store Brokkeri (activeApp: complainer) er et TREDJE, HELT selvstændigt spil (se CLAUDE.md) — denne
// fil ligner strukturelt api/mrbrok.js (samme mutateState-CAS-mønster, samme
// push-mønster), men rører aldrig state.mrbrok/state.game eller deres
// flow-filer. Den deler kun rummets medlemmer/lobby og de generiske
// helper-funktioner i _lib/store.js og _lib/push.js.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId, actorId } = req.body || {};
    if (!roomId || !actorId) return res.status(400).json({ error: 'mangler data' });

    let pushInfo = null;
    const mutated = await mutateState(roomId, async (state) => {
      if (!state.members.find(mm => mm.id === actorId)) throw new ApiError(400, 'ukendt medlem');
      if (!state.complainer) state.complainer = { active: false };

      if (action === 'start') {
        if (state.complainer.active) throw new ApiError(409, 'Det Store Brokkeri er allerede i gang');
        // Samme gensidige udelukkelse som Brokspillet/MrBrok allerede
        // håndhæver mellem hinanden — Det Store Brokkeri deltager i SAMME regel,
        // omgår den ikke (se CLAUDE.md).
        if (state.game && state.game.active) throw new ApiError(409, 'Brokspillet er i gang — afslut det først');
        if (state.mrbrok && state.mrbrok.active) throw new ApiError(409, 'MrBrok er i gang — afslut det først');
        const requested = Array.isArray(req.body.playerIds) ? req.body.playerIds : state.members.map(mm => mm.id);
        const playerObjs = state.members.filter(mm => requested.includes(mm.id));
        if (playerObjs.length < MIN_PLAYERS) throw new ApiError(400, `vælg mindst ${MIN_PLAYERS} spillere`);
        const wager = req.body.wager === 'euro' ? 'euro' : 'fun';
        const totalRounds = ALLOWED_ROUNDS.includes(req.body.totalRounds) ? req.body.totalRounds : DEFAULT_ROUNDS;
        const players = playerObjs.map(mm => mm.id);
        const { archetypes, situations } = assignArchetypesAndSituations(playerObjs);
        const guiltyId = players[Math.floor(Math.random() * players.length)];
        const scores = {};
        const brokScores = {};
        players.forEach(id => { scores[id] = 0; brokScores[id] = 0; });

        state.complainer = {
          active: true, wager, players, archetypes, situations, totalRounds,
          guiltyId, revealed: false, revealedAt: null,
          round: 0, scores, pendingGamble: null, lastGambleResult: null,
          // brokScores/brokApprovals: separat "godt brok"-performance-regnskab
          // (se 'approveBrok'-handleren nedenfor) — ALDRIG blandet med scores
          // (mistankepoint), kun vist ved siden af ved gameover.
          brokScores, brokApprovals: {},
          // challengeEnabled/challengeUsedBy: EXPERIMENTAL "Udfordring", se
          // applyComplainerChallenge i complainerFlow.js — ét flag, ét sted.
          challengeEnabled: true, challengeUsedBy: {},
          topSuspectHistory: [], history: [], usedPromptIds: {},
          current: null, startedAt: Date.now(),
        };
        beginComplainRound(state, 1);

        const starter = state.members.find(mm => mm.id === actorId);
        const notInGame = state.members.map(mm => mm.id).filter(id => !players.includes(id));
        pushInfo = [{ excludeIds: [actorId, ...notInGame], title: '🪤 Det Store Brokkeri er i gang!', body: `${starter ? starter.name : 'Nogen'} startede et spil — kom med!`, url: '/?r=' + roomId }];
        return;
      }

      if (!state.complainer.active) throw new ApiError(409, 'der er ikke noget Det Store Brokkeri-spil i gang');
      const c = state.complainer;
      expireComplainerPhaseIfDue(state);
      const cur = c.current;

      if (action === 'submit') {
        const { payload } = req.body || {};
        if (!cur || !payload) throw new ApiError(400, 'mangler data');

        if (cur.type === 'complain') {
          // Broksene siges HØJT ved bordet — intet tekstfelt, kun en
          // bekræftelse fra den der har turen, nøjagtig samme mønster som
          // MrBrok's clue-fase (se api/mrbrok.js's 'submit'-håndtering af
          // cur.type === 'clue').
          if (actorId !== cur.speakerId) throw new ApiError(403, 'det er ikke din tur lige nu');
          advanceComplain(state);
        } else if (cur.type === 'interrogation') {
          // Sidste spørgerunde efter den private afsløring — samme
          // "sagt/svaret højt, intet tekstfelt, kun en bekræftelse"-mønster
          // som brok-fasen ovenfor (se advanceInterrogation i
          // complainerFlow.js).
          if (actorId !== cur.speakerId) throw new ApiError(403, 'det er ikke din tur lige nu');
          advanceInterrogation(state);
        } else if (cur.type === 'vote') {
          if (!c.players.includes(actorId)) throw new ApiError(403, 'du er ikke med i dette spil af Det Store Brokkeri');
          const votedForId = payload.votedForId;
          if (votedForId === actorId) throw new ApiError(400, 'du kan ikke stemme på dig selv');
          if (!c.players.includes(votedForId)) throw new ApiError(400, 'ukendt spiller');
          if (cur.votes[actorId] !== undefined) throw new ApiError(409, 'du har allerede stemt denne runde');
          cur.votes[actorId] = votedForId;
          if (Object.keys(cur.votes).length >= c.players.length) resolveSuspicionRound(state);
        } else if (cur.type === 'bet') {
          if (actorId !== cur.topId) throw new ApiError(403, 'det er ikke dig der er rundens topmest mistænkte');
          if (cur.choice) throw new ApiError(409, 'du har allerede valgt');
          // Den EKSTRA, sidste afstemningsrunde (cur.round > c.totalRounds,
          // se beginFinalVoteRound i complainerFlow.js) har INGEN runde
          // efter sig til at afgøre "topmest mistænkt IGEN" imod — en
          // gamble her ville derfor selv blive et nyt orphaned pendingGamble,
          // præcis den fejl denne ekstra runde ellers fjerner. Tvinges
          // derfor stille til 'safe' (samme forsvar findes i UI'en, som ikke
          // viser gamble-knappen for denne runde — dette er defense-in-depth
          // mod en klient der alligevel skulle sende 'gamble').
          const isFinalRound = cur.round > c.totalRounds;
          const choice = (!isFinalRound && payload.choice === 'gamble') ? 'gamble' : 'safe';
          cur.choice = choice;
          resolveBet(state);
        } else if (cur.type === 'guess') {
          if (actorId !== c.guiltyId) throw new ApiError(403, 'kun Den Store Brokker kan gætte');
          if (cur.targetId) throw new ApiError(409, 'der er allerede afgivet et gæt');
          const targetId = payload.targetId;
          if (!c.players.includes(targetId) || targetId === c.guiltyId) throw new ApiError(400, 'ukendt medspiller');
          const detail = (payload.detail || '').toString().trim().slice(0, 240);
          if (!detail) throw new ApiError(400, 'skriv dit gæt');
          submitGuess(state, targetId, detail);
        } else if (cur.type === 'judge') {
          if (actorId === c.guiltyId) throw new ApiError(403, 'du kan ikke stemme om dit eget gæt');
          if (!c.players.includes(actorId)) throw new ApiError(403, 'du er ikke med i dette spil af Det Store Brokkeri');
          if (cur.votes[actorId] !== undefined) throw new ApiError(409, 'du har allerede stemt');
          cur.votes[actorId] = !!payload.closeEnough;
          if (Object.keys(cur.votes).length >= c.players.length - 1) resolveJudge(state);
        } else {
          throw new ApiError(400, 'ugyldig handling lige nu');
        }

        // Den private afsløring: INDHOLDET skal aldrig broadcastes (kun Den
        // Store Brokker selv får at vide hvem de er), men PUSHEN skal — hvis
        // kun ét medlems telefon lyser op ved bordet i akkurat dette
        // øjeblik, ER det i sig selv et afsløringstegn, uanset hvad der reelt
        // står i notifikationen (produktejer-rettelse — samme fejltype som
        // MrBrok-sessionen i CLAUDE.md, bare flyttet fra runde 1 til dette
        // øjeblik). Derfor sender vi til ALLE spillere samtidig når faserne
        // netop skiftede til 'interrogation' (den nye spørgerunde der nu
        // ligger LIGE efter afsløringen, se beginReveal i complainerFlow.js
        // — ikke længere 'guess', som nu først kommer efter spørgerunden) —
        // kun ordlyden er forskellig pr. modtager (pushToMembers har ikke
        // pr.-modtager-indhold, se _lib/push.js, så vi kalder den to gange i
        // parallel: én batch til kun den skyldige med det rigtige indhold,
        // én batch til alle andre med en neutral, "der sker noget"-besked).
        // turnIndex === 0-tjekket sikrer pushen kun sendes ÉN gang (ved
        // selve overgangen ind i spørgerunden), ikke ved hvert efterfølgende
        // 'submit' der bare rykker turen videre INDE i spørgerunden. Selve
        // skærmbilledet de ser når de tjekker er stadig korrekt kildet fra
        // den eksisterende per-viewer-redaktion (youAreGuilty/current.type),
        // denne push ændrer kun TIMINGEN af hvornår folk kigger, ikke hvad
        // de ser.
        if (state.complainer.current && state.complainer.current.type === 'interrogation'
            && state.complainer.current.turnIndex === 0
            && state.complainer.revealed
            && cur.type === 'bet') {
          const guiltyId = state.complainer.guiltyId;
          const others = state.members.map(mm => mm.id).filter(id => id !== guiltyId);
          pushInfo = [
            { excludeIds: others, title: '🪤 Du er Den Store Brokker!', body: 'Bliv i karakter gennem sidste spørgerunde — så skal du gætte en detalje om en af de andre.', url: '/?r=' + roomId },
            { excludeIds: [guiltyId], title: '🪤 Det Store Brokkeri', body: 'Der sker noget lige nu — tjek appen.', url: '/?r=' + roomId },
          ];
        }
        return;
      }

      // ============================================================
      // EXPERIMENTAL — "Udfordring". Se CLAUDE.md/commit-besked og
      // complainerFlow.js's applyComplainerChallenge for kontekst/begrundelse.
      // Ét flag (state.complainer.challengeEnabled), ét kaldested — fjern
      // denne blok + dens ene kaldested i complainerFlow.js + UI-knappen i
      // index.html's complainerBetHtml for at rippe hele featuren ud igen,
      // hvis den ikke tester godt ved bordet.
      if (action === 'challenge') {
        if (c.challengeEnabled === false) throw new ApiError(400, 'Udfordring er slået fra i dette spil');
        if (!cur || cur.type !== 'bet') throw new ApiError(400, 'kan kun udfordres under en bank/gamble-beslutning');
        if (cur.choice) throw new ApiError(409, 'for sent — valget er allerede taget');
        if (!c.players.includes(actorId)) throw new ApiError(403, 'du er ikke med i dette spil af Det Store Brokkeri');
        if (actorId === cur.topId) throw new ApiError(403, 'du kan ikke udfordre dig selv');
        if (c.challengeUsedBy && c.challengeUsedBy[actorId]) throw new ApiError(409, 'du har allerede brugt din udfordring i dette spil');
        if (cur.challenged) throw new ApiError(409, 'der er allerede udfordret denne runde');
        applyComplainerChallenge(state, actorId);
        return;
      }
      // ============================================================

      // "approveBrok" — "🔥 Godt brok!": de andre spillere kan give ÉN
      // simpel tak/anerkendelse til en medspiller der lige har haft sin tur,
      // for hvor godt de ramte deres arketypes instruerede stil. Helt
      // separat point-kanal fra c.scores (mistankepoint) — se
      // c.brokScores/c.brokApprovals ovenfor i 'start'.
      if (action === 'approveBrok') {
        if (!cur || cur.type !== 'complain') throw new ApiError(400, 'kan kun gives under en brok-runde');
        if (!c.players.includes(actorId)) throw new ApiError(403, 'du er ikke med i dette spil af Det Store Brokkeri');
        const targetId = req.body && req.body.payload && req.body.payload.targetId;
        if (!c.players.includes(targetId)) throw new ApiError(400, 'ukendt spiller');
        if (targetId === actorId) throw new ApiError(403, 'du kan ikke give dig selv ros');
        const idx = cur.order.indexOf(targetId);
        if (idx === -1 || idx >= cur.turnIndex) throw new ApiError(400, 'den spiller har ikke haft sin tur endnu i denne runde');
        const key = cur.round + ':' + targetId;
        if (!c.brokApprovals) c.brokApprovals = {};
        if (!c.brokApprovals[key]) c.brokApprovals[key] = {};
        if (c.brokApprovals[key][actorId]) throw new ApiError(409, 'du har allerede givet ros for det brok');
        c.brokApprovals[key][actorId] = true;
        if (!c.brokScores) c.brokScores = {};
        c.brokScores[targetId] = (c.brokScores[targetId] || 0) + 1;
        return;
      }

      // "complain" — samme filosofi som Brokspillet/MrBrok: en spiller der
      // selv allerede er færdig kan brokke sig over en langsom medspiller
      // efter lidt tid, hvilket starter en kort tvangs-nedtælling.
      if (action === 'complain') {
        if (!cur) throw new ApiError(400, 'ingen aktiv runde');
        if (!c.players.includes(actorId)) throw new ApiError(403, 'du er ikke med i dette spil af Det Store Brokkeri');
        const pending = getPendingComplainerIds(c);
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
        state.complainer = { active: false };
        return;
      }

      throw new ApiError(400, 'ukendt handling');
    });
    if (!mutated) return res.status(404).json({ error: 'ukendt brokkekasse' });
    const { state } = mutated;

    if (pushInfo) {
      // Sendes i PARALLEL (Promise.all), ikke i serie — hele pointen ved
      // afsløringens to-batch-push (se kommentaren ved reveal-tjekket
      // ovenfor) er at ALLES telefoner lyser op på samme tidspunkt, ikke at
      // den skyldiges telefon konsekvent lyser op nogle millisekunder før
      // de andres.
      await Promise.all(pushInfo.map(info =>
        pushToMembers(state, info.excludeIds, { title: info.title, body: info.body, url: info.url })
          .catch(e => { /* push-fejl må ikke vælte selve handlingen */ })
      ));
    }

    return res.status(200).json({ state: redactStateFor(state, actorId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
