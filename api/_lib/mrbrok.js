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

// Tredje tema, Sladrekassen — navnepreset på Gruppekasse-motoren (se
// KASSEMOTORPLAN.md). Domæne: sladder/rygter i stedet for brok/regelbrud.
// 10 emner — samme bevidste v1-størrelse som Bødekassens pulje.
const MRBROK_TOPICS_SLADRE = [
  'Sladrende frisør — sladrer om kunder mens de sidder i stolen',
  'Nysgerrig portner — sladrer om beboerne i opgangen',
  'Skarptunget veninde — sladrer om fælles venner bag deres ryg',
  'Storsnudet kollega — sladrer om chefens beslutninger i krogene',
  'Ivrig nabo — sladrer om hvem der kommer og går i kvarteret',
  'Skeptisk svigermor — sladrer om svigerbørnenes valg',
  'Opmærksom buschauffør — sladrer om faste passagerers vaner',
  'Snakkesalig ekspedient — sladrer om kundernes indkøb',
  'Nysgerrig klasselærer — sladrer om forældrenes opførsel til møder',
  'Vagtsom vicevært — sladrer om hvem der laver mest støj',
];

// Samme ni hints som brok/bøde-varianterne, "brokker/undskylder dig"
// erstattet med "sladrer" (relevant for et sladder-domæne).
const MRBROK_CLUE_TIPS_SLADRE = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Sladr om en PERSON i situationen, ikke bare selve tingen',
  'Svar med en antydning, ikke et direkte udsagn',
  'Vend spørgsmålet en anelse — svar med den sladder du helst selv ville dele',
  'Nævn hvor tit du hører "den slags" sladder',
  'Beskriv hvordan du plejer at reagere når du hører godt sladder',
  'Er du MrBrok: lyt til hvad de andre lige har sagt, og genbrug deres ord',
  'Er du MrBrok: svar selvsikkert og vagt i stedet for at prøve at være præcis',
];

// Løgnerkasse-motoren (se KASSEMOTORPLAN.md's klassifikations-tabel: "kun
// Spil 2+3 mulige" — Brokspillets quiplash/rose kræver "roast en navngiven
// person", som ikke passer et løgner-domæne). Domæne: lyve/bedrage i stedet
// for brokke/undskylde. 10 emner — samme bevidste v1-størrelse som de andre.
const MRBROK_TOPICS_LOGN = [
  'Bedragerisk forsikringssælger — lyver om dækning for at lukke handlen',
  'Utro kæreste — lyver om hvor de har været hele aftenen',
  'Fusker til eksamen — lyver om hvor svaret kom fra',
  'Falsk influencer — lyver om hvilke produkter der reelt er sponsoreret',
  'Bedragerisk håndværker — lyver om hvor lang tid arbejdet reelt tager',
  'Skjult spiller ved pokerbordet — lyver om hvilke kort de har på hånden',
  'Falsk alibi-vidne — lyver om hvor en ven befandt sig',
  'Bedragerisk sælger på loppemarked — lyver om hvor gammel varen er',
  'Skjult dobbeltagent — lyver om hvilken side de reelt arbejder for',
  'Falsk anmelder — lyver om at have prøvet produktet overhovedet',
];

const MRBROK_CLUE_TIPS_LOGN = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Lyv om en PERSON i situationen, ikke bare selve tingen',
  'Svar med en følelse ved det, ikke et direkte faktum',
  'Vend spørgsmålet en anelse — svar med den løgn du helst selv ville fortælle',
  'Nævn hvor tit du er kommet afsted med den slags løgne før',
  'Beskriv hvordan du plejer at reagere når du bliver taget i en løgn',
  'Er du MrBrok: lyt til hvad de andre lige har sagt, og genbrug deres ord',
  'Er du MrBrok: svar selvsikkert og vagt i stedet for at prøve at være præcis',
];

// Vennekassen — Gruppekasse-motor, nær-identisk social kontekst som brok
// (se KASSEMOTORPLAN.md's klassifikation), men domænet er specifikt
// VENNEGRUPPENS egne mønstre (planlægning/fester/rejser), ikke ferie
// generelt. "brokker sig over" undgået bevidst (samme grund som
// Bødekassen/Sladrekassen — Dommerens lækage-tjek fanger ordet "brok" i et
// fremmed temas indhold, se commit-historikken for Konkurrencekassens
// første forsøg).
const MRBROK_TOPICS_VENNE = [
  'Glemsom vennegruppe-planlægger — er irriteret over at ingen svarer i gruppechatten',
  'Skeptisk madklub-medlem — er utilfreds med hvem der altid glemmer at handle ind',
  'Utålmodig spilaften-vært — er irriteret over folk der aldrig kan finde ud af reglerne',
  'Træt karpooler — er utilfreds med venner der aldrig er klar til tiden',
  'Irriteret festplanlægger — er irriteret over gæster der melder afbud i sidste øjeblik',
  'Skuffet rejsefælle — er skuffet over venner der aldrig kan blive enige om planer',
  'Frustreret gruppechat-admin — er frustreret over folk der spammer med memes',
  'Utilfreds fitness-makker — er utilfreds med venner der aflyser træning hele tiden',
  'Vred fælleskøkken-bruger — er vred over opvask der aldrig bliver taget',
  'Skeptisk lånefinansier — er skeptisk over venner der "glemmer" at betale tilbage',
];

const MRBROK_CLUE_TIPS_VENNE = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Vær irriteret over en PERSON i situationen, ikke bare selve tingen',
  'Svar på en følelse ved det, ikke selve tingen',
  'Vend spørgsmålet en anelse — svar på det du helst selv ville være irriteret over',
  'Nævn hvor tit "det her" sker for dig',
  'Beskriv hvordan du plejer at reagere i situationen',
  'Er du MrBrok: lyt til hvad de andre lige har sagt, og genbrug deres ord',
  'Er du MrBrok: svar selvsikkert og vagt i stedet for at prøve at være præcis',
];

// Rosekassen — reward-polaritet (ros i stedet for brok, se planens "ren
// polaritetsvending"). Domæne: at GIVE ros/anerkendelse, ikke klage.
const MRBROK_TOPICS_ROSE = [
  'Varm konferencier — roser alle for mindste præstation',
  'Stolt træner — roser holdet efter hver eneste kamp',
  'Entusiastisk mentor — roser den mindste fremgang hos andre',
  'Hjertevarm bedsteforælder — roser børnebørnenes mindste bedrifter',
  'Anerkendende chef — roser medarbejdere for rettidig aflevering',
  'Begejstret fan — roser sit idol for alt de gør',
  'Opmuntrende yogainstruktør — roser deltagerne for at møde op overhovedet',
  'Taknemmelig kunde — roser personalet for den mindste ekstra service',
  'Stolt forælder — roser børnenes mindste fremskridt højlydt',
  'Inspireret elev — roser læreren for enhver god forklaring',
];

const MRBROK_CLUE_TIPS_ROSE = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Ros en PERSON i situationen, ikke bare selve tingen',
  'Svar med en følelse ved det, ikke selve tingen',
  'Vend spørgsmålet en anelse — svar med den ros du helst selv ville give',
  'Nævn hvor tit du plejer at rose den slags',
  'Beskriv hvordan du plejer at reagere når du selv bliver rost',
  'Er du MrBrok: lyt til hvad de andre lige har sagt, og genbrug deres ord',
  'Er du MrBrok: svar selvsikkert og vagt i stedet for at prøve at være præcis',
];

// Drikkekassen — session-baseret (dailyRhythm:false, se planens note om at
// den kræver en session- i stedet for dags-cyklus). Domæne: fest/drikkeleg.
const MRBROK_TOPICS_DRIK = [
  'Doven bartender — er træt af gæster der aldrig kan bestemme sig',
  'Skeptisk quizvært — er utilfreds med hold der snyder med mobilen',
  'Utålmodig taxa-bestiller — er irriteret over gæster der ikke kan finde app\'en',
  'Træt DJ — er træt af gæster der altid beder om samme sang',
  'Irriteret rundefordeler — er irriteret over folk der "glemmer" deres runde',
  'Skuffet spilleder — er skuffet over folk der ikke kan reglerne i drukspil',
  'Frustreret vært — er frustreret over gæster der drikker af andres glas',
  'Utilfreds baransvarlig — er utilfreds med gæster der prøver at snyde med alder',
  'Vred nabo til festen — er vred over støjniveauet efter midnat',
  'Skeptisk eftervagt — er skeptisk over undskyldninger dagen derpå',
];

const MRBROK_CLUE_TIPS_DRIK = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Vær irriteret over en PERSON i situationen, ikke bare selve tingen',
  'Svar på en følelse ved det, ikke selve tingen',
  'Vend spørgsmålet en anelse — svar på det du helst selv ville være irriteret over',
  'Nævn hvor tit "det her" sker til fester',
  'Beskriv hvordan du plejer at reagere dagen derpå',
  'Er du MrBrok: lyt til hvad de andre lige har sagt, og genbrug deres ord',
  'Er du MrBrok: svar selvsikkert og vagt i stedet for at prøve at være præcis',
];

// Konkurrencekassen — EGET indhold, IKKE en regex-omskrivning af brok-
// puljens klage-emner (se commit-historikken/quizmaster-audit-fund:
// CONTENT_BY_THEME's tidligere konkurrence-gren erstattede kun "brokker
// dig over" med "praler af" i brok's egne SUR/VRED/TRÆT-personaer — gav
// meningsløse emner som "Sur stewardesse — praler af besværlige
// passagerer". Reward-polaritet kræver STOLTE/SELVSIKRE personaer, ikke
// bare et andet verbum på en vred rolle).
const MRBROK_TOPICS_KONKURRENCE = [
  'Stolt sejrherre — praler af hvor overlegent du vandt sidste kamp',
  'Selvsikker skakspiller — praler af hvor hurtigt du gennemskuede modstanderens træk',
  'Kæphøj bowler — praler af den perfekte serie du lige har spillet',
  'Sejrsikker quizdeltager — praler af hvor mange spørgsmål du kunne svare på uden at tænke',
  'Triumferende løber — praler af den nye personlige rekord du satte',
  'Selvglad kortspiller — praler af det geniale træk der vandt hele spillet',
  'Storsnudet dartspiller — praler af den perfekte serie af bullseyes',
  'Skrydende poolspiller — praler af hvor mange bolde du sank i træk',
  'Overlegen skiløber — praler af hvor meget hurtigere du var end alle andre',
  'Kompetitiv brætspilsspiller — praler af den strategi ingen så komme',
  'Ivrig turneringsvinder — praler af pokalen du lige har vundet',
  'Highfivende holdkaptajn — praler af det afgørende mål du selv scorede',
  'Selvsikker forhandler — praler af den aftale du fik hjem billigere end alle andre',
  'Sejrsvant tipskuponspiller — praler af den rigtige række du gættede',
  'Stolt madlavningskonkurrent — praler af dommernes lovord om din ret',
  'Kæphøj gamer — praler af den umulige boss du besejrede først',
  'Overbevist auktionsvinder — praler af hvor billigt du fik det eftertragtede stykke',
  'Triumferende cykelrytter — praler af hvor mange du overhalede på bakken',
  'Selvglad quizvært — praler af hvor svært du kunne gøre spørgsmålene',
  'Sejrsikker sportsforælder — praler af barnets sidste sejr, som var din egen fortjeneste',
];

const MRBROK_CLUE_TIPS_KONKURRENCE = [
  'Nævn én konkret (men ikke afslørende) detalje i stedet for at svare generelt',
  'Hold svaret kort — giv ikke det hele væk på én gang',
  'Pral om en PERSON du slog, ikke bare selve sejren',
  'Svar med en følelse ved det, ikke selve tingen',
  'Vend spørgsmålet en anelse — svar med den sejr du helst selv ville prale af',
  'Nævn hvor tit du plejer at vinde den slags',
  'Beskriv hvordan du plejer at fejre en sejr',
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
  // Omdøbt fra "Bødedetektiven" til "Mr. Bøde" (Martins beslutning, live
  // UX-gennemgang): "detektiven" beskriver reelt de ANDRE spillere (dem der
  // efterforsker), ikke den skjulte selv — "Mr. Bøde" er i stedet en
  // direkte parallel til selve "MrBrok" (Mr. + temaets substantiv), samme
  // opbygning, øjeblikkeligt genkendeligt som bøde-udgaven af samme spil.
  bode: { mrbrokTopics: MRBROK_TOPICS_BODE, mrbrokClueTips: MRBROK_CLUE_TIPS_BODE, gameName: 'Mr. Bøde' },
  // Konkurrencekassen: eget indhold (se MRBROK_TOPICS_KONKURRENCE's
  // kommentar ovenfor for hvorfor — en tidligere regex-omskrivning af
  // brok's egne vrede personaer gav meningsløse emner).
  konkurrence: {
    mrbrokTopics: MRBROK_TOPICS_KONKURRENCE,
    mrbrokClueTips: MRBROK_CLUE_TIPS_KONKURRENCE,
    gameName: 'Konkurrencedetektiven',
  },
  sladre: { mrbrokTopics: MRBROK_TOPICS_SLADRE, mrbrokClueTips: MRBROK_CLUE_TIPS_SLADRE, gameName: 'Sladrehanen' },
  logn: { mrbrokTopics: MRBROK_TOPICS_LOGN, mrbrokClueTips: MRBROK_CLUE_TIPS_LOGN, gameName: 'Løgnedetektiven' },
  venne: { mrbrokTopics: MRBROK_TOPICS_VENNE, mrbrokClueTips: MRBROK_CLUE_TIPS_VENNE, gameName: 'Vennedetektiven' },
  rose: { mrbrokTopics: MRBROK_TOPICS_ROSE, mrbrokClueTips: MRBROK_CLUE_TIPS_ROSE, gameName: 'Rosedetektiven' },
  drik: { mrbrokTopics: MRBROK_TOPICS_DRIK, mrbrokClueTips: MRBROK_CLUE_TIPS_DRIK, gameName: 'Rundedetektiven' },
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
