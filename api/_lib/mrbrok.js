// Rent INDHOLD til MrBrok — emner, hvem der bliver MrBrok, hint-forslag.
// Selve spil-FLOWET (tur-rækkefølge, afstemning, elimination) ligger i
// _lib/mrbrokFlow.js, ligesom Brokspillets indhold/flow er delt mellem
// _lib/game.js og _lib/gameFlow.js. Ligger under _lib/ så den IKKE tæller
// med i Vercels 12-serverless-function-loft.

const { pickRandom, pickWeighted } = require('./game');

// Vælger hvem der bliver MrBrok: vægtet tilfældigt efter hvor mange gange
// man har haft rollen før — færre gange giver højere chance, men man kan
// sagtens blive det to gange i træk (ligesom i rigtig Mr. White), det er
// kun over mange spil det skal jævne sig ud. Gemt på RUM-niveau (samme sted
// som resten af indholds-rotationen), så det holder på tværs af flere spil
// i stedet for at nulstille sig selv ved hvert nyt MrBrok-spil.
function pickMrBrok(state, players) {
  if (!state.gameContentBank) state.gameContentBank = {};
  if (!state.gameContentBank.mrBrokPickCounts) state.gameContentBank.mrBrokPickCounts = {};
  const counts = state.gameContentBank.mrBrokPickCounts;
  const chosen = pickWeighted(players, counts);
  counts[chosen.id] = (counts[chosen.id] || 0) + 1;
  return chosen;
}

// Rolle + bredt domæne, ikke bare et neutralt faktum — giver spillerne en
// KARAKTER at spille (stemme, attitude) og et bredt nok "brok-domæne" at
// improvisere indenfor, så: (a) MrBrok kan bluffe plausibelt selv uden at
// kende domænet, ved bare at forpligte sig til en rolle og lytte efter de
// andres tone, og (b) de der reelt kender domænet aldrig løber tør efter
// første tur, fordi der altid er en ny vinkel at brokke sig over. Et enkelt
// smalt faktum (fx "du er sur over mågerne") er bevidst UNDGÅET — det giver
// kun ÉT gyldigt svar, hvilket afslører MrBrok med det samme og gør runden
// kedelig efter første tur. Genbruger samme shuffle-bag-rotation som
// resten af indholdet, så de ikke gentages før hele puljen er brugt.
const MRBROK_TOPICS = [
  'Sur stewardesse — brokker dig over besværlige passagerer',
  'Vred mekaniker — brokker dig over kunder der ikke lytter til dine råd',
  'Træt tjener — brokker dig over gæster der aldrig er tilfredse',
  'Stresset håndværker — brokker dig over kunder der ændrer planen hele tiden',
  'Irriteret nabo — brokker dig over støj og rod fra dem ved siden af',
  'Utålmodig taxachauffør — brokker dig over passagerer der ikke kan finde adressen',
  'Skuffet chef — brokker dig over medarbejdere der ikke tager ansvar',
  'Træt forælder — brokker dig over børn der aldrig rydder op',
  'Frustreret sælger — brokker dig over kunder der aldrig ender med at købe noget',
  'Ærgerlig hotelreceptionist — brokker dig over gæster der klager over alt',
  'Vred kok — brokker dig over gæster der sender maden tilbage',
  'Utilfreds kunde — brokker dig over elendig service',
  'Sur pilot — brokker dig over forsinkelser der slet ikke er din skyld',
  'Træt lærer — brokker dig over elever der aldrig laver lektier',
  'Irriteret cyklist — brokker dig over bilister der ikke viser hensyn',
  'Skeptisk håndværker — brokker dig over kunder der vil have alt for billigt',
  'Vred fitnessinstruktør — brokker dig over medlemmer der aldrig møder op',
  'Utålmodig buschauffør — brokker dig over passagerer uden byttepenge',
  'Sur postbud — brokker dig over løse hunde og glatte fortove',
  'Frustreret it-supporter — brokker dig over brugere der aldrig har prøvet at genstarte',
];

// Emnet skal have "hvile" i mindst 60% af puljen (afrundet op) før det kan
// gå igen — dvs. mindst 12 ud af 20 ANDRE emner skal være brugt først, ikke
// bare "ikke det allersidste". Bevidst valgt fremfor en klassisk pop-bag
// (se pickFromBag i game.js): en pop-bag er skrøbelig over for en tabt
// samtidig skrivning (to hurtige "start"-kald der begge læser samme
// state-version, se mutateState's CAS) — mister man ét pop fra posen,
// smitter det usynligt af på ALLE fremtidige træk. En rullende historik
// derimod hviler kun på selve historikken, så et enkelt tabt træk højst
// koster én "hvileperiode" for det ene emne, ikke hele rotationen.
const MIN_TOPIC_GAP = Math.ceil(MRBROK_TOPICS.length * 0.6);

function pickTopic(state) {
  if (!state.gameContentBank) state.gameContentBank = {};
  if (!state.gameContentBank.mrbrokTopicHistory) state.gameContentBank.mrbrokTopicHistory = [];
  const history = state.gameContentBank.mrbrokTopicHistory;
  const recentlyUsed = new Set(history.slice(-MIN_TOPIC_GAP));
  const candidates = MRBROK_TOPICS.map((_, i) => i).filter(i => !recentlyUsed.has(i));
  const idx = pickRandom(candidates);
  history.push(idx);
  if (history.length > MIN_TOPIC_GAP) history.splice(0, history.length - MIN_TOPIC_GAP);
  return MRBROK_TOPICS[idx];
}

// Forslag til hvordan man svarer VAGT NOK til ikke at hjælpe MrBrok, men
// KLART NOK til at overbevise de andre (aldrig et konkret svar/ord) —
// vises kun til den der har turen lige nu, via "Brug for et hint?"-
// knappen, ren client-side hjælp (se index.html). Ingen "spil en karakter
// med stemmen"-tips her — det er et andet spil (se diskussionen i
// commit-historikken); MrBrok er en afsløringsleg, ikke en improv-øvelse.
// Holdes her sammen med resten af MrBroks indhold, selvom de reelt kunne
// have ligget rent client-side — samlet ét sted er lettere at redigere/udvide.
const MRBROK_CLUE_TIPS = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Klag over en PERSON i situationen, ikke bare selve tingen',
  'Svar på en følelse ved det, ikke selve tingen',
  'Vend spørgsmålet en anelse — svar på det du helst vil brokke dig over',
  'Nævn hvor tit "det her" sker for dig',
  'Beskriv hvordan du plejer at reagere i situationen',
  'Er du MrBrok: lyt til hvad de andre lige har sagt, og genbrug deres ord',
  'Er du MrBrok: svar selvsikkert og vagt i stedet for at prøve at være præcis',
];

module.exports = { MRBROK_TOPICS, MRBROK_CLUE_TIPS, pickTopic, pickMrBrok };
