const { createRoom, genRoomId, mutateState, uid, redactStateFor } = require('./_lib/store');

// Rum-dynamik-protokol, Del 1.2: de anbefalede lofter (fundet ved faktisk
// belastningstest, se load_test_capacity.js) håndhæves nu fysisk, ikke kun
// vist som vejledende tal i invite-modulet (recommendedMemberCap() i
// index.html — SKAL holdes i sync med disse to tal, samme grænse begge
// steder). Kvorum-rum rammer upraktisk mange påkrævede stemmer per sag før
// dette; host-approval-rum har ingen tilsvarende mekanisk begrænsning og
// kan derfor bære markant flere.
const MAX_MEMBERS_QUORUM = 15;
const MAX_MEMBERS_HOST_APPROVAL = 50;

// Samler "opret rum" og "join rum" i én serverless function i stedet for to —
// Vercels Hobby-plan tillader kun 12 functions i alt.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action } = req.body || {};

    if (action === 'join') {
      const { roomId, name, email, isBot } = req.body || {};
      if (!roomId || !name || !name.trim()) return res.status(400).json({ error: 'mangler navn' });
      const cleanName = name.trim().slice(0, 24);

      // Kasse-motor-generalisering, teknisk hærdning (fangede en reel race
      // condition under et rette-loop, ikke bare gættet på forhånd): denne
      // handler brugte tidligere almindelig getState+setState, IKKE den
      // CAS-beskyttede mutateState alle andre steder der muterer state
      // bruger — to samtidige join-kald med samme navn (fx et
      // dobbeltklik, eller to browserfaner) kunne begge nå at læse "navn
      // findes ikke" FØR nogen af dem skrev, og skabe to duplikerede
      // medlemmer med samme navn men forskellige id'er. mutateState's
      // CAS-retry lukker dette hul på samme måde som brok.js/admin.js.
      let outcome = null;
      let capReached = false;
      const mutated = await mutateState(roomId, async (state) => {
        let member = state.members.find(m => m.name.toLowerCase() === cleanName.toLowerCase());
        if (member) { outcome = { type: 'member', memberId: member.id }; return; }

        // Deltager-loft (Del 1.2) — kendte medlemmer (fundet ovenfor) og
        // bots (test-spil) rammes aldrig af dette, kun rigtige NYE tilmeldinger.
        if (!isBot) {
          const realCount = state.members.filter(m => !m.isBot).length;
          const cap = state.confirmationModel === 'host-approval' ? MAX_MEMBERS_HOST_APPROVAL : MAX_MEMBERS_QUORUM;
          if (realCount >= cap) { capReached = true; return; }
        }

        // Kasse-motor-generalisering, operationelt valg "adgang" (se
        // KASSEMOTORPLAN.md's "To lag"-afsnit): accessModel:'approval'
        // betyder NYE medlemmer venter på værtens/medværtens godkendelse i
        // stedet for at komme direkte ind — allerede kendte navne (fundet
        // ovenfor) er altid velkomne tilbage uden ny godkendelse. Bots
        // (test-spil) er undtaget. KRITISK undtagelse (fanget af en ægte
        // browser-gennemkørsel): rummets FØRSTE medlem (opretteren) skal
        // ALDRIG selv gates bag godkendelse — der findes per definition
        // ingen til at godkende dem endnu, hvilket ellers ville låse
        // rummet fast i en dødlås.
        if (state.accessModel === 'approval' && !isBot && state.members.length > 0) {
          if (!Array.isArray(state.pendingMembers)) state.pendingMembers = [];
          let pending = state.pendingMembers.find(p => p.name.toLowerCase() === cleanName.toLowerCase());
          if (!pending) {
            pending = { id: uid(), name: cleanName, email: email ? email.trim().slice(0, 80) : null, requestedAt: Date.now() };
            state.pendingMembers.push(pending);
          }
          outcome = { type: 'pending', pendingId: pending.id };
          return;
        }

        // isBot markerer et rent test-medlem (se admin-menuernes "Test-spil
        // med bots") — spilles automatisk af klienten der satte det i
        // gang, aldrig af en rigtig person. Ingen andre server-side
        // forskelle.
        member = { id: uid(), name: cleanName, email: email ? email.trim().slice(0, 80) : null, isBot: !!isBot };
        state.members.push(member);
        outcome = { type: 'member', memberId: member.id };
      });
      if (!mutated) return res.status(404).json({ error: 'ukendt brokkekasse' });
      const { state } = mutated;
      if (capReached) {
        const cap = state.confirmationModel === 'host-approval' ? MAX_MEMBERS_HOST_APPROVAL : MAX_MEMBERS_QUORUM;
        const kasseName = (state.themeName || 'Kassen').toLowerCase();
        return res.status(409).json({ error: `Kassen er fuld — maksimalt ${cap} deltagere i denne ${kasseName}.` });
      }
      if (outcome.type === 'pending') return res.status(200).json({ pending: true, pendingId: outcome.pendingId, state: redactStateFor(state, null) });
      return res.status(200).json({ memberId: outcome.memberId, state: redactStateFor(state, outcome.memberId) });
    }

    // default: opret et nyt rum
    let roomId = genRoomId();
    const kasseEnabled = !(req.body && req.body.kasseEnabled === false);
    const gameEnabled = !(req.body && req.body.gameEnabled === false);
    const { themeId, themeName, ruleTagline, unit, poolPolarity, confirmationModel, dailyRhythm, accessModel } = req.body || {};
    // Dommer-reglen "host-approval udelukker MrBrok" (se
    // KASSEMOTORPLAN.md/_lib/themeRegistry.js's checkRegistry): håndhæves
    // også her server-side, ikke kun i klientens UI — en klient der
    // (fejlagtigt eller bevidst) alligevel sender mrbrokEnabled:true sammen
    // med confirmationModel:'host-approval' skal ikke kunne omgå reglen.
    const mrbrokEnabled = confirmationModel === 'host-approval' ? false : !(req.body && req.body.mrbrokEnabled === false);
    const complainerEnabled = !(req.body && req.body.complainerEnabled === false);
    if (!kasseEnabled && !gameEnabled && !mrbrokEnabled && !complainerEnabled) return res.status(400).json({ error: 'vælg mindst én' });
    // Kasse-motor-generalisering, Fase 4: skabelon-felter fra oprettelses-UI
    // videresendes til createRoom (som allerede accepterer dem, Fase 0) —
    // alle valgfrie, udeladt betyder Brokkekassens egne defaults fra
    // emptyState() (uændret adfærd for eksisterende/ældre klienter).
    const state = await createRoom(roomId, {
      kasseEnabled, gameEnabled, mrbrokEnabled, complainerEnabled,
      themeId, themeName, ruleTagline, unit, poolPolarity, confirmationModel, dailyRhythm, accessModel,
    });
    res.status(200).json({ roomId, state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
