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

// Kasse-motor-generalisering, Fase 5 (BEVIS-TEMA, se
// god-finding-men-du-lovely-zephyr.md): Bødekassens emner. Samme
// håndværks-spec som brok-puljen ovenfor (bredt domæne+rolle, aldrig ét
// snævert faktum) — anvendt på "bryder en regel/kommer for sent"-domænet
// i stedet for "brokker sig"-domænet. 15 emner (mod originalens 20) —
// BEVIDST en mindre v1-pulje til bevis-formål, IKKE den endelige
// tilstræbte størrelse. Dommerens minimum-pulje-gate (Fase 6) skal have
// en konkret tærskel at måle op imod — udvid denne pulje FØR levering til
// rigtige brugere, dokumenteret her så det er let at finde igen ved test.
const MRBROK_TOPICS_BODE = [
  'Sløv målmand — kommer altid for sent til opvarmning',
  'Glemsom holdkaptajn — glemmer bolde og veste i klubhuset',
  'Doven bestyrelsesmedlem — møder aldrig forberedt til møderne',
  'Sur kollega — parkerer altid på andres reserverede plads',
  'Rodet praktikant — efterlader rod på det fælles skrivebord',
  'Distræt lærer — glemmer konsekvent at aflevere karakterer til tiden',
  'Skødesløs nabo — sætter skraldespanden forkert ud hver uge',
  'Ligeglad chauffør — kommer for sent til hver eneste afhentning',
  'Fraværende teammedlem — melder afbud i sidste øjeblik hver gang',
  'Uorganiseret arrangør — glemmer altid at booke lokalet i tide',
  'Sløset revisor — afleverer regnskabet en uge for sent hver gang',
  'Distræt vagtchef — glemmer at aflåse hver anden vagt',
  'Ukoncentreret dommer — fløjter forkerte afgørelser konsekvent',
  'Glemsom kasserer — glemmer at opkræve kontingent i tide',
  'Sløv vikar — møder uforberedt til hver eneste vagt',
];

// Samme ni hints som brok-varianten, men "brokke dig over" (kun relevant
// for et klage-domæne) erstattet med "undskyld dig med" (relevant for et
// regelbrud/bøde-domæne). Resten er allerede domæne-neutrale.
const MRBROK_CLUE_TIPS_BODE = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Undskyld dig med en PERSON eller omstændighed, ikke bare selve reglen',
  'Svar på en følelse ved det, ikke selve reglen',
  'Vend spørgsmålet en anelse — svar på den undskyldning du helst ville bruge',
  'Nævn hvor tit "det her" sker for dig',
  'Beskriv hvordan du plejer at reagere når du bliver taget i det',
  'Er du MrBrok: lyt til hvad de andre lige har sagt, og genbrug deres ord',
  'Er du MrBrok: svar selvsikkert og vagt i stedet for at prøve at være præcis',
];

// Kasse-motor-generalisering (Fase 1, se god-finding-men-du-lovely-zephyr.md):
// tema-keyet indholds-opslag. 'brok' refererer UÆNDRET til MRBROK_TOPICS/
// MRBROK_CLUE_TIPS ovenfor (ingen indholds-omskrivning, kun et lookup-lag
// tilføjet) — nye temaer tilføjes som nye nøgler her, ikke ved at ændre
// pickTopic()'s logik. Ukendt themeId falder tilbage til 'brok', crasher
// aldrig et rum uden kurateret indhold endnu.
const CONTENT_BY_THEME = {
  brok: { mrbrokTopics: MRBROK_TOPICS, mrbrokClueTips: MRBROK_CLUE_TIPS, gameName: 'MrBrok' },
  // Fase 5 bevis-tema. gameName "Bødedetektiven" — spilnavne er
  // tema-afhængige, ikke "MrBrok" bogstaveligt, se planens punkt om at
  // spilnavne er brok-brandede og skal reskinnes pr. tema.
  bode: { mrbrokTopics: MRBROK_TOPICS_BODE, mrbrokClueTips: MRBROK_CLUE_TIPS_BODE, gameName: 'Bødedetektiven' },
};
function getThemeContent(themeId) {
  return CONTENT_BY_THEME[themeId] || CONTENT_BY_THEME.brok;
}

function pickTopic(state) {
  const topics = getThemeContent(state.themeId).mrbrokTopics;
  if (!state.gameContentBank) state.gameContentBank = {};
  if (!state.gameContentBank.mrbrokTopicHistory) state.gameContentBank.mrbrokTopicHistory = [];
  const history = state.gameContentBank.mrbrokTopicHistory;
  const minGap = Math.ceil(topics.length * 0.6);
  const recentlyUsed = new Set(history.slice(-minGap));
  const candidates = topics.map((_, i) => i).filter(i => !recentlyUsed.has(i));
  const idx = pickRandom(candidates);
  history.push(idx);
  if (history.length > minGap) history.splice(0, history.length - minGap);
  return topics[idx];
}

module.exports = { MRBROK_TOPICS, MRBROK_CLUE_TIPS, CONTENT_BY_THEME, getThemeContent, pickTopic, pickMrBrok };
