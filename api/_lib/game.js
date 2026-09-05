// Ren spillogik til Brokspillet — ingen state-adgang her, kun funktioner der
// tager data ind og returnerer data ud. Ligger under _lib/ så den IKKE tæller
// med i Vercels 12-serverless-function-loft (kun filer direkte i /api gør).

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function shuffle(arr) {
  return arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

// Vægtet tilfældigt valg blandt kandidater: færre tidligere valg giver
// højere chance, men ALDRIG nul chance — så en gentagelse fra gang til
// gang sagtens kan ske (ligesom i Mr. White), det er kun over mange gange
// det skal jævne sig ud, ikke fra spil til spil. `counts` er id -> antal
// gange tidligere valgt.
function pickWeighted(candidates, counts) {
  const weights = candidates.map(c => 1 / ((counts[c.id] || 0) + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function buildOptions(correctLabel, distractorLabels) {
  const pool = [correctLabel, ...distractorLabels].slice(0, 4);
  const options = shuffle(pool);
  return { options, correctIndex: options.indexOf(correctLabel) };
}

const QUIPLASH_PROMPTS = [
  'Skriv den mest drilske kommentar til {target}',
  'Det mest pinlige {target} har gjort på denne ferie er...',
  '{target} ville aldrig overleve en dag uden...',
  'Den perfekte hævn over {target} lige nu er...',
  'Hvis {target} havde sit eget TV-show, ville det hedde...',
  'Den mest sandsynlige grund til at {target} brokker sig i morgen er...',
  '{target}s hemmelige superkraft er at være verdensmester i...',
  'Det {target} bruger alt for lang tid på hver dag er...',
  'Hvis {target} var en ret på menuen, ville den hedde...',
  '{target} ville helt sikkert brokke sig hvis...',
  'Den mest overdrevne undskyldning {target} kunne finde på er...',
  'Om 10 år brokker {target} sig stadig over...',
];

// Kun brugt ved PRÆCIS 2 spillere — der er ingen rigtig afstemning ved 2
// (se resolveQuiplashRandom i gameFlow.js), så runden ender ALTID direkte i
// Chancen/whack-a-mole. Derfor et sejrs-hån i stedet for et roast af et
// tilfældigt trukket emne — men med kun 2 spillere ER modstanderen jo en
// helt bestemt person, så {target} indsættes stadig, bare KLIENT-side (se
// index.html) — hvem "den anden spiller" er afhænger af hvem der kigger,
// så det kan ikke bages ind i én fælles prompt-streng server-side.
const WINNER_TAUNT_PROMPTS = [
  'Du vandt lige over {target}. Hvad råber du?',
  'Sig din frækkeste sejrskommentar til {target}',
  'Hvad er det første du siger til {target}, når du vinder?',
];

function pickWinnerTauntPrompt(state) {
  const prompts = getThemeContent(state.themeId).winnerTauntPrompts;
  const idx = pickFromBag(state, 'winnerTaunt', prompts.length);
  return prompts[idx];
}

// "Chancen" kan vises på 3 måder (muldvarp/whack, hjul, spillemaskine) —
// bruges BÅDE af casinobrok (altid) og quiplash (uafgjort/2-spillere, se
// resolveQuiplashVote/resolveQuiplashRandom i gameFlow.js). Hver visning
// begrænses til HØJST ÉN gang pr. HELE spillet (gemt på state.game, ikke
// rummet) — ellers kunne fx whack sagtens optræde flere gange i et langt
// 8/12-rundes spil, hvis quiplash endte uafgjort mere end én gang. Når
// alle 3 er brugt, genbruges de bare tilfældigt igen — der findes ikke
// flere visninger at vælge imellem, men det sker sjældent i praksis.
function pickChanceVisual(state) {
  if (!state.game.usedChanceVisuals) state.game.usedChanceVisuals = [];
  const ALL_VISUALS = ['mole', 'wheel', 'slot'];
  const unused = ALL_VISUALS.filter(v => !state.game.usedChanceVisuals.includes(v));
  const pool = unused.length ? unused : ALL_VISUALS;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (!state.game.usedChanceVisuals.includes(pick)) state.game.usedChanceVisuals.push(pick);
  return pick;
}

// Opdigtede "vrangforestillinger" der blandes ind blandt de ægte svar i
// afstemnings-fasen — generiske nok til at kunne passe som svar på næsten
// alle QUIPLASH_PROMPTS ovenfor, uden at være skrevet til noget bestemt
// prompt. Ingen forfatter — vinder en decoy afstemningen, får ingen rigtig
// spiller point den runde (se resolveQuiplashVote i gameFlow.js).
const QUIPLASH_DECOYS = [
  'At brokke sig over vejret hver eneste dag',
  'At miste telefonen for tredje gang denne uge',
  'At sove til langt over middag og kalde det "restitution"',
  'At skændes højlydt med GPS\'en',
  'At spise is til morgenmad og kalde det sund fornuft',
  'At brokke sig over trafikken hver eneste dag',
  'At tabe kortspillet og påstå det var snyd',
  'At bruge en hel time på at vælge restaurant',
  'At sige "lige om lidt" i tre timer i træk',
  'At købe souvenirs ingen nogensinde bad om',
  'At filme hele solnedgangen i stedet for bare at se den',
  'At påstå man ikke er sulten, og så spise alt andres mad',
  'At pakke for meget og bruge halvdelen af det',
  'At insistere på at køre, men aldrig kende vejen',
];

function pickQuiplashDecoys(state, n) {
  const decoys = getThemeContent(state.themeId).quiplashDecoys;
  const picked = [];
  for (let i = 0; i < n; i++) {
    const idx = pickFromBag(state, 'quiplashDecoy', decoys.length);
    picked.push(decoys[idx]);
  }
  return picked;
}

// Ægte real-world "brok der endte med et resultat"-trivia — blandes ind
// imellem rundens egne data-spørgsmål, så der er noget at grine af selv
// tidligt i en frisk brokkekasse uden meget historik endnu.
const WORLD_TRIVIA = [
  { question: 'I 1985 lancerede Coca-Cola en ny opskrift der fik så massivt brok fra kunderne, at de måtte tage den gamle tilbage efter kun 3 måneder. Hvad hed fadæsen?', correct: 'New Coke', distractors: ['Coca-Cola Zero', 'Cherry Coke', 'Coca-Cola Life'] },
  { question: 'Da Toblerone i 2016 ændrede formen for at spare på chokoladen, brokkede tusindvis af briter sig højlydt. Hvad var deres klage over?', correct: 'For store huller mellem trekanterne', distractors: ['For lille æske', 'Ny smag', 'Manglende nødder'] },
  { question: 'Microsoft fjernede Start-menuen i Windows 8 — og måtte give den tilbage i Windows 10 efter massivt brok. Hvad ville brugerne have tilbage?', correct: 'Start-menuen', distractors: ['Solitaire', 'Den blå skærm', 'Internet Explorer'] },
  { question: 'Facebook fik i årevis brok fra brugere der ville have en "dislike"-knap. Hvad indførte Facebook i stedet i 2016?', correct: 'Reaktioner (fx vred/ked af det)', distractors: ['En decideret dislike-knap', 'Anonyme kommentarer', 'Et klagepanel'] },
  { question: 'En berømt retssag i USA i 1994 handlede om en kunde der brokkede sig over alt for varm kaffe fra en fastfood-kæde. Hvilken kæde?', correct: "McDonald's", distractors: ['Burger King', 'KFC', 'Starbucks'] },
  { question: 'EU har regler om hvor krumme bananer og agurker må være til salg — ofte brugt som eksempel på "unødvendigt bureaukrati". Hvad handler reglerne officielt om?', correct: 'Kvalitetsklassificering ved salg', distractors: ['Miljøbeskyttelse', 'Skattefradrag', 'Transportsikkerhed'] },
  { question: 'Hvad kaldes en person i moderne slang, der er kendt for at brokke sig unødigt meget og forlange "at tale med chefen"?', correct: 'Karen', distractors: ['Susan', 'Karla', 'Debbie'] },
  { question: "Netflix' upopulære forbud mod login-deling på tværs af husstande fik massivt brok — men endte alligevel med at gøre hvad?", correct: "Øge Netflix' omsætning og antal abonnenter", distractors: ['Gå konkurs', 'Fjerne alle gebyrer igen', 'Skifte navn'] },
  { question: 'En britisk navnekonkurrence for et forskningsskib endte med det folkelige forslag "Boaty McBoatface". Hvad besluttede myndighederne til sidst?', correct: 'Skibet fik et andet navn — men en ubåd blev opkaldt Boaty McBoatface', distractors: ['Skibet hed officielt Boaty McBoatface', 'Konkurrencen blev aflyst', 'Navnet blev solgt på auktion'] },
  { question: 'Ryanair er berygtet for ekstra gebyrer rejsende brokker sig over. Hvilket af disse har Ryanair faktisk opkrævet gebyr for?', correct: 'Print af boardingkort i lufthavnen', distractors: ['At sidde i vinduespladsen', 'At tale engelsk ombord', 'Håndbagage under 1 kg'] },
  { question: 'Gap skiftede sit klassiske logo i 2010 — men måtte skifte tilbage efter kun én uge pga. massivt brok. Hvad var især problemet?', correct: 'Det nye logo blev anset for kedeligt og amatøragtigt', distractors: ['Det nye logo lignede en konkurrent', 'Det var for dyrt at trykke', 'Det kunne ikke læses af farveblinde'] },
  { question: 'Tropicana skiftede sin ikoniske appelsin-emballage i 2009 — men måtte tage den gamle tilbage efter kun 2 måneder, da salget styrtdykkede. Hvor meget faldt salget cirka?', correct: 'Ca. 20%', distractors: ['Ca. 2%', 'Ca. 50%', 'Ca. 80%'] },
  { question: 'Snapchat lancerede et upopulært redesign i 2018 — over 1,2 millioner underskrev en petition imod det. Hvad skete der med appen bagefter?', correct: 'Den mistede brugere, og aktien faldt', distractors: ['Den blev lukket permanent', 'Intet, brugerne vænnede sig hurtigt til det', 'Snapchat blev opkøbt af Instagram'] },
  { question: 'Pepsi trak i 2017 en reklame med Kendall Jenner tilbage efter massivt brok om at den bagatelliserede protestbevægelser. Hvor hurtigt blev den trukket?', correct: 'Under 24 timer', distractors: ['Efter en uge', 'Efter en måned', 'Den blev aldrig trukket'] },
  { question: 'Windows Vista fik SÅ meget brok for at være langsomt og irriterende, at Microsoft skyndte sig med efterfølgeren. Hvad hed den?', correct: 'Windows 7', distractors: ['Windows 8', 'Windows XP', 'Windows ME'] },
  { question: "Domino's Pizza indrømmede i en berømt reklamekampagne i 2009, at kundernes brok over smagen var berettiget. Hvad gjorde de?", correct: 'Opfandt en helt ny pizza-opskrift', distractors: ['Lukkede alle butikker', 'Sænkede priserne til det halve', 'Skiftede navn'] },
  { question: 'Fyre Festival i 2017 endte i massivt brok fra gæster der havde betalt formuer for luksus, men i stedet fik overlevelsestelte og hvilken berømt fiasko-servering?', correct: 'En ostesandwich', distractors: ['Rå fisk', 'Ingenting overhovedet', 'Tørret brød og vand' ] },
  { question: 'Reddit lancerede et nyt design i 2018 der fik så meget brok, at brugerne den dag i dag kan vælge det gamle design. Hvilken adresse virker stadig?', correct: 'old.reddit.com', distractors: ['classic.reddit.com', 'legacy.reddit.com', 'vintage.reddit.com'] },
  { question: 'McDonald\'s Szechuan-sauce fra 2017 udløste kaos og brok i butikkerne, da der var alt for lidt af den. Hvad gjorde kæden året efter?', correct: 'Genindførte saucen permanent', distractors: ['Fjernede den for altid', 'Hævede prisen til 50 dollars', 'Sagsøgte fansene'] },
  { question: 'Peloton fik massivt hån og brok for en julereklame i 2019, hvor en mand gav sin kone et motionscykel-abonnement i gave. Hvad skete der med Pelotons aktiekurs bagefter?', correct: 'Den faldt markant', distractors: ['Den steg markant', 'Ingen ændring', 'Aktien blev suspenderet'] },
  { question: "Airbnb fik massivt brok da værter begyndte at opkræve høje 'rengøringsgebyrer' oveni prisen. Hvad indførte Airbnb i 2022 som svar?", correct: 'Et samlet totalpris-visning inkl. alle gebyrer', distractors: ['Forbud mod rengøringsgebyrer', 'Gratis rengøring for alle', 'Lukning af hele appen'] },
  { question: 'Da Instagram i 2016 skiftede fra kronologisk feed til algoritme-sorteret, brokkede brugerne sig massivt. Hvad var hovedklagen?', correct: 'De så ikke længere opslag i den rækkefølge de blev postet', distractors: ['Appen blev pludselig betalt', 'Alle billeder blev sort/hvide', 'Kommentarer forsvandt helt'] },
  { question: 'IKEA har måttet trække varer tilbage efter kundebrok flere gange. Hvilket berømt IKEA-produkt blev kaldt tilbage i 2016 pga. sikkerhedsrisiko for børn?', correct: 'MALM-kommoden (væltefare)', distractors: ['BILLY-reolen', 'POÄNG-lænestolen', 'LACK-bordet'] },
  { question: "Twitter (nu X) fik enormt brok da Elon Musk indførte en betalt 'blåt flueben'. Hvad var hovedklagen fra brugerne?", correct: 'Verificering blev til noget man kunne købe, ikke længere et ægthedsbevis', distractors: ['Flueben blev fjernet helt', 'Appen skiftede navn til noget andet', 'Alle tweets blev betalte'] },
  { question: 'Boeing modtog massivt brok og kritik efter 737 MAX-flystyrt. Hvad var den tekniske hovedårsag der blev udpeget?', correct: 'Et fejlbehæftet automatisk styringssystem (MCAS)', distractors: ['For gamle motorer', 'Manglende brændstof', 'Forkert malet cockpit'] },
  { question: 'Starbucks fik brok for at gøre deres bægre mindre uden at sænke prisen. Hvad kaldes dette fænomen generelt i forbrugerdebatten?', correct: 'Shrinkflation', distractors: ['Deflation', 'Inflation-hop', 'Prisdumping'] },
  { question: 'Amazon fik massivt brok fra forfattere og forlag i 2014 under en prisstrid. Hvilket forlag var Amazon i konflikt med?', correct: 'Hachette', distractors: ['Penguin', 'HarperCollins', 'Gyldendal'] },
  { question: 'Da Google i 2012 lancerede en ny privatlivspolitik der samlede data på tværs af alle tjenester, brokkede EU sig officielt. Hvad krævede EU?', correct: 'At Google skulle ændre politikken for at overholde databeskyttelsesregler', distractors: ['At Google skulle lukke i Europa', 'At Google skulle betale bøde med det samme', 'At Gmail skulle blive gratis for alle'] },
  { question: 'Nintendo fik brok fra fans da Switch-controllere ("Joy-Cons") begyndte at få et kendt teknisk problem. Hvad hed problemet i folkemunde?', correct: 'Joy-Con drift (styrepinden reagerer af sig selv)', distractors: ['Skærm-flimmer', 'Batteri-eksplosion', 'Bluetooth-lækage'] },
  { question: "H&M fik massivt brok og boykot-trusler i 2018 for en reklame med et barn i en trøje med teksten 'Coolest Monkey in the Jungle'. Hvad gjorde H&M?", correct: 'Trak reklamen og undskyldte offentligt', distractors: ['Fastholdt reklamen uden ændringer', 'Sagsøgte kritikerne', 'Lukkede alle butikker i en uge'] },
  { question: 'Uber mødte massivt brok og protester fra taxichauffører i mange storbyer. Hvad var chaufførernes hovedklage?', correct: 'Uber konkurrerede uden samme licenskrav og afgifter som taxier', distractors: ['Uber-biler måtte ikke have GPS', 'Uber tvang folk til at bruge kontanter', 'Uber var forbudt at køre om natten'] },
  { question: 'Kellogg\'s fik brok for at svinde portionerne i deres morgenmadspakker uden at ændre prisen synligt. Hvad kaldes dette trick når producenten skjuler det med emballagens design?', correct: 'Slack fill (misvisende "luft" i pakken)', distractors: ['Cross-selling', 'Bundling', 'Loss leader'] },
  { question: 'British Airways fik voldsomt brok efter et IT-nedbrud i 2017 aflyste hundredvis af fly i en weekend. Hvad var den officielle årsag?', correct: 'En strømafbrydelse der ødelagde deres datacenter', distractors: ['En cyberangreb fra en fremmed magt', 'Manglende piloter', 'For meget sne på landingsbanerne'] },
  { question: 'Spotify fik brok fra musikere for lave streaming-royalties. Hvilken kendt kunstner trak i protest hele sin katalog fra Spotify i en periode?', correct: 'Taylor Swift', distractors: ['Adele', 'Beyoncé', 'Ed Sheeran'] },
  { question: "Volkswagen røg i en kæmpe brok- og tillidskrise i 2015, kendt som 'Dieselgate'. Hvad havde bilerne snydt med?", correct: 'Software der snød udstødningstests for forurening', distractors: ['Falske kilometertællere', 'For lidt brændstof i tanken', 'Ulovlige bremser'] },
  { question: 'Coca-Cola og Pepsi har begge fået brok for brug af en bestemt farvestof i deres drikke, som senere blev forbudt visse steder. Hvad hedder farvestoffet der blev debatteret?', correct: 'Brom-vegetabilsk olie (BVO)', distractors: ['Rødbedeekstrakt', 'Karamelfarve E150', 'Klorofyl'] },
  { question: 'Der opstod massivt brok blandt Google Maps-brugere da appen i en periode dirigerede folk gennem farlige/lukkede veje pga. crowdsourced data. Hvad kaldes appen der først populariserede denne slags "smart" ruteføring, og som Google senere opkøbte?', correct: 'Waze', distractors: ['Tomtom', 'MapQuest', 'Garmin Connect'] },
  { question: 'Da Facebook i 2021 skiftede navn på moderselskabet, fik det blandet brok og hovedrysten. Hvad blev det nye navn?', correct: 'Meta', distractors: ['Nova', 'Axis', 'Horizon'] },
  { question: 'Delta og andre flyselskaber har fået massivt brok for overbooking af fly. Hvad kaldes det (kontroversielle) system hvor flyselskaber bevidst sælger flere billetter end der er sæder?', correct: 'Overbooking', distractors: ['Dobbelt-ticketing', 'Standby-modellen', 'Cross-selling'] },
];

// Neutrale "verdens-brok"-udsagn til sandt/falsk-runden — ligesom
// WORLD_TRIVIA giver disse noget at spille med selv i et helt frisk rum,
// og især ved kun 2 spillere aflaster de byrden ved altid selv at skulle
// finde på et nyt udsagn hver eneste runde. Ingen "forfatter" — begge/alle
// spillere gætter, ingen kan snyde nogen med disse.
const WORLD_TRUEFALSE = [
  { statement: 'IKEA opkalder sine møbler efter et fast system af skandinaviske stednavne og fornavne — det er ikke tilfældigt.', isTrue: true },
  { statement: 'Der findes et officielt "Brokkemuseum" i Danmark, dedikeret udelukkende til utilfredse kunders klagebreve.', isTrue: false },
  { statement: 'Ordet "brok" i betydningen at klage, kommer af samme rod som det engelske ord "broke" (at gå i stykker).', isTrue: false },
  { statement: 'McDonald\'s har officielt et "kundeservice-hotline" nummer man kan ringe til for at brokke sig over is-maskiner der er i stykker.', isTrue: false },
  { statement: 'I Japan findes der professionelle "klage-konsulenter", man kan hyre til at klage på ens vegne over dårlig service.', isTrue: true },
  { statement: 'Den mest almindelige klage til danske flyselskaber handler statistisk set om forsinkelser, ikke om bagage.', isTrue: true },
  { statement: 'Der findes en international "Brokke-dag" anerkendt af FN, hvor man officielt opfordres til at brokke sig mindre.', isTrue: false },
  { statement: 'Ordet "Karen" som slang for en brokkende kunde blev første gang brugt i et middelaldersk skuespil.', isTrue: false },
  { statement: 'En undersøgelse har vist at folk, der skriver deres brok ned i stedet for at sige det højt, ofte føler sig mindre vrede bagefter.', isTrue: true },
  { statement: 'I Storbritannien er det lovpligtigt for restauranter at have en fysisk "klagebog" liggende fremme til gæsterne.', isTrue: false },
  { statement: 'Den mest komplicerede kundeklage nogensinde registreret hos et flyselskab drejede sig om en tabt guldfisk i håndbagagen.', isTrue: false },
  { statement: 'Undersøgelser viser at de fleste utilfredse kunder aldrig brokker sig direkte til virksomheden — de fortæller det bare til andre.', isTrue: true },
  { statement: 'Der findes et dansk ord, der specifikt betyder "at brokke sig i smug uden nogen hører det" — det bruges stadig i dag.', isTrue: false },
  { statement: 'Restauranter med et synligt "klagekort" på bordet får statistisk set færre negative anmeldelser online bagefter.', isTrue: true },
  { statement: 'Verdens længste registrerede kundeklagebrev fylder over 1.000 sider og handlede om en fejlleveret pakke.', isTrue: false },
];

// Kasse-motor-generalisering, Fase 5 (BEVIS-TEMA). Samme prompt-form som
// QUIPLASH_PROMPTS ovenfor, anvendt på bøde/regelbrud-domænet i stedet for
// brok-domænet. 10 prompts (mod originalens 12) — BEVIDST en mindre
// v1-pulje til bevis-formål, udvid før rigtig levering.
const QUIPLASH_PROMPTS_BODE = [
  'Den mest sandsynlige grund til at {target} får en bøde i morgen er...',
  'Skriv den mest drilske kommentar til {target} om deres bøde-historik',
  '{target} ville helt sikkert få en bøde hvis...',
  'Den mest overdrevne undskyldning {target} kunne finde på er...',
  'Hvis {target} havde sin egen bøde-kategori, ville den hedde...',
  '{target}s hemmelige talent er at komme for sent til...',
  'Det {target} bruger alt for lang tid på hver dag er...',
  'Om 10 år får {target} stadig bøder for...',
  'Den mest sandsynlige undskyldning {target} bruger for at slippe for en bøde er...',
  'Hvis {target} var en bøde, hvor stor ville den være, og hvorfor?',
];

// Fase 5 bevis-tema: opdigtede vrangforestillinger til quiplash-afstemning,
// generiske nok til at passe næsten alle QUIPLASH_PROMPTS_BODE ovenfor —
// samme funktion som QUIPLASH_DECOYS, anvendt på bøde-domænet.
const QUIPLASH_DECOYS_BODE = [
  'At komme for sent fordi uret gik forkert — igen',
  'At skylde på trafikken hver eneste gang',
  'At love bod og bedring uden at mene det',
  'At glemme aftalen fuldstændigt',
  'At sige "jeg var lige på vej" i tre timer',
  'At betale bøden med et smil og gøre det igen',
  'At have en helt ny undskyldning hver gang',
  'At påstå det var en misforståelse',
  'At skylde på wifi-forbindelsen',
  'At love at sætte en alarm næste gang',
];

// Fase 5 bevis-tema: ægte, verificerbare fakta om bøder/regler i den
// virkelige verden — samme funktion som WORLD_TRIVIA, men KUN 3 stykker.
// BEVIDST holdt lille: i modsætning til DECOY_BROK (opdigtet, ingen
// sandhedsværdi krævet) skal disse være FAKTUELT KORREKTE, og jeg har
// ikke websøgning til at verificere flere end de mest velkendte,
// bredt dokumenterede eksempler her. Udvid KUN med fakta der er
// dobbelttjekket, ikke bare opdigtet i samme stil — se Dommerens Del B.
// Quizmaster-audit-fund (Martins live test: "Bødespillet bruger Brokspillet
// trivia — why?"): denne pulje delte tidligere sig selv med WORLD_TRIVIA via
// THEME_TRIVIA's tags:['brok','bode'] — men WORLD_TRIVIA er reelt "berømte
// virksomheder der fik massivt BROK fra kunder" (ordet "brok" optræder
// bogstaveligt i de fleste af dens spørgsmål), ikke "afgifter/bøder/
// regelbrud". Den påståede "afgift/regel-overlap"-begrundelse holdt ikke i
// praksis. Udvidet til egen, selvstændig pulje (fine/bøde/regelbrud-domænet)
// — se THEME_TRIVIA nedenfor, som IKKE længere tagger denne med 'brok'.
const WORLD_TRIVIA_BODE = [
  { question: 'Singapore er verdenskendt for at forbyde import og salg af hvad, med høje bøder til følge?', correct: 'Tyggegummi', distractors: ['Balloner', 'Legetøjsvåben', 'Kunstige blomster'] },
  { question: 'I flere lande, bl.a. Schweiz og Finland, beregnes en fartbøde ikke kun ud fra hastigheden, men også ud fra hvad?', correct: 'Din indkomst', distractors: ['Din alder', 'Bilens farve', 'Årstiden'] },
  { question: 'Flere storbyer, bl.a. Venedig, har indført bøder for at gøre hvad på de mest berømte pladser?', correct: 'Fodre duer', distractors: ['Tage billeder', 'Sidde på trapperne', 'Spise is'] },
  { question: 'Singapore er, ud over tyggegummiforbuddet, også kendt for meget høje bøder for hvad?', correct: 'At smide affald på gaden (henkastning af affald)', distractors: ['At cykle på fortovet', 'At spise offentligt', 'At bruge paraply indendørs'] },
  { question: 'New York indførte i 1978 en af verdens første love om, at hundeejere SKAL gøre hvad, med bøde til følge hvis ikke?', correct: 'Samle deres hunds efterladenskaber op', distractors: ['Holde hunden i snor i alle parker', 'Registrere hunden årligt', 'Bære pose synligt til enhver tid'] },
  { question: 'I langt de fleste lande i verden i dag kan man få en bøde for at køre bil uden at gøre hvad?', correct: 'Bruge sikkerhedssele', distractors: ['Have musik tændt', 'Have en ren bil', 'Have vindueskosten med'] },
  { question: 'Automatiske fotovogne/fartkameraer bruges i dag i de fleste lande primært til at udstede bøder for hvad?', correct: 'For høj hastighed', distractors: ['Ulovlig parkering', 'Kørsel uden lys', 'Manglende blinklys'] },
  { question: 'I mange amerikanske storbyer, bl.a. Los Angeles, er "jaywalking" bødebelagt. Hvad betyder det?', correct: 'At krydse gaden uden for et fodgængerfelt', distractors: ['At cykle på vejen', 'At holde ulovligt i vejkanten', 'At gå tur med hund uden snor'] },
  { question: 'I flere europæiske lande, bl.a. Tyskland, kan husstande faktisk få en bøde for hvad?', correct: 'Forkert sortering af affald/genbrug', distractors: ['At have for lidt affald', 'At bruge for meget vand', 'At have en have der er for stor'] },
  { question: 'I mange lande kan man få en bøde for støj efter et bestemt klokkeslæt om aftenen. Hvad kaldes disse regler typisk?', correct: 'Nattero/"quiet hours"', distractors: ['Udgangsforbud', 'Brandregler', 'Byggetilladelser'] },
  { question: 'Virksomheder kan i mange lande få store bøder, hvis de bryder hvilken slags regler på arbejdspladsen?', correct: 'Arbejdsmiljø- og sikkerhedsregler', distractors: ['Marketingregler', 'Ferieregler for ansatte', 'Kantine-hygiejneregler alene'] },
  { question: 'I mange lande fordobles en fartbøde typisk, hvis man kører for stærkt forbi hvad?', correct: 'En skole', distractors: ['En kirke', 'Et posthus', 'Et supermarked'] },
  { question: 'Flere lande har indført en afgift/bøde-lignende gebyr for at mindske forbruget af hvad i butikker?', correct: 'Gratis plastikposer', distractors: ['Plastikflasker med pant', 'Al emballage generelt', 'Kun plastiksugerør'] },
  { question: 'I mange lande er det bødebelagt at gøre hvad uden for selve nytårsperioden?', correct: 'Affyre fyrværkeri', distractors: ['Tænde bål i haven', 'Holde fest efter midnat', 'Grille på altanen'] },
  { question: 'En af de mest almindelige trafikbøder i verden i dag gives for hvad?', correct: 'At bruge håndholdt mobiltelefon under kørsel', distractors: ['At køre med åbent vindue', 'At have en hund løs i bilen', 'At lytte til radio for højt'] },
  { question: 'I mange lande, bl.a. Danmark, kan man få en bøde for at gøre hvad uden gyldigt fisketegn?', correct: 'Fiske i søer, åer eller havet', distractors: ['Sejle en jolle', 'Bade i havet', 'Gå tur langs kysten'] },
  { question: 'Næsten alle lande har markant højere bøder for at parkere ulovligt hvor, sammenlignet med almindelig fejlparkering?', correct: 'På en handicapplads', distractors: ['Tæt på et lyskryds', 'Om natten', 'Med visne blomster i bilen'] },
  { question: 'Butikker og barer kan i mange lande få en bøde, hvis de sælger alkohol til hvem?', correct: 'Mindreårige', distractors: ['Turister', 'Kunder uden kvittering', 'Ansatte'] },
  { question: 'I mange storbyer kan man få en bøde, hvis brandvæsenet rykker ud forgæves pga. hvad?', correct: 'En falsk brandalarm', distractors: ['For sen anmeldelse', 'En defekt røgdetektor', 'Naboklager over lugt'] },
  { question: 'En berømt sag i Schweiz gav i 2010 en af verdens dyreste fartbøder nogensinde, fordi bøden dér beregnes ud fra hvad?', correct: 'Bilistens formue/indkomst', distractors: ['Antallet af tidligere bøder', 'Bilens hestekræfter alene', 'Vejens hastighedsgrænse alene'] },
];

// Fase 5 bevis-tema: samme forsigtighed som WORLD_TRIVIA_BODE ovenfor —
// kun velkendte, dobbelttjekkede fakta.
const WORLD_TRUEFALSE_BODE = [
  { statement: 'I Singapore er det ulovligt at importere og sælge tyggegummi, med bøder for overtrædelse.', isTrue: true },
  { statement: 'I flere lande, bl.a. Schweiz og Finland, beregnes fartbøder ud fra din indkomst, så en høj indkomst kan give en langt større bøde for samme overtrædelse.', isTrue: true },
  { statement: 'New York var en af de første storbyer i verden til at lovgive om, at hundeejere skal samle deres hunds efterladenskaber op.', isTrue: true },
  { statement: 'De fleste lande giver LAVERE fartbøder ved vejarbejde, for ikke at stresse bilisterne unødigt.', isTrue: false },
  { statement: 'Singapores bøder for gentagen henkastning af affald kan indebære samfundstjeneste, ikke kun en pengebøde.', isTrue: true },
  { statement: 'I de fleste lande er det billigere at vente med at betale en fartbøde end at betale den med det samme.', isTrue: false },
];

// Fase 5 bevis-tema: samme funktion som DECOY_BROK — hverdags "bøde-
// udløsende" hændelser, holdt generiske og genkendelige uanset gruppe.
const DECOY_BODE = [
  'Kom fem minutter for sent til mødet',
  'Glemte at sætte telefonen på lydløs til mødet',
  'Parkerede på den forkerte side af vejen',
  'Glemte at aflevere nøglerne til tiden',
  'Efterlod opvasken i køkkenet igen',
  'Meldte afbud i sidste øjeblik',
  'Glemte holdtrøjen til kampen',
  'Kom uden cykel-lygte efter mørkets frembrud',
  'Betalte kontingent en uge for sent',
  'Efterlod bilen uden benzin til næste bruger',
  'Glemte at booke lokalet til mødet',
  'Sendte referatet en dag for sent',
  'Tog den sidste kop kaffe uden at brygge ny',
  'Glemte at melde sygdom til tiden',
  'Parkerede cyklen midt i indgangen',
];

// Kasse-motor-generalisering, tredje tema (Sladrekassen — Martins eget
// bekræftede test-eksempel, se KASSEMOTORPLAN.md's "Testet på to navne"-
// afsnit). Samme prompt-form som QUIPLASH_PROMPTS/QUIPLASH_PROMPTS_BODE,
// anvendt på sladder-domænet i stedet for brok/bøde. 8 prompts — samme
// bevidste v1-størrelse som Bødekassens pulje.
const QUIPLASH_PROMPTS_SLADRE = [
  'Den mest sandsynlige sladderhistorie om {target} lige nu er...',
  'Skriv den mest saftige sladder om {target}',
  '{target} ville helt sikkert blive sladret om hvis...',
  'Den mest overdrevne rygte om {target} kunne være...',
  'Hvis {target} havde sin egen sladderspalte, ville overskriften være...',
  '{target}s hemmelige talent er at sladre om...',
  'Det folk sladrer mest om {target} er...',
  'Om 10 år sladrer folk stadig om {target} og...',
];

const QUIPLASH_DECOYS_SLADRE = [
  'At sladre om naboens nye kæreste til hele gaden',
  'At fortælle alle om en hemmelig fest ingen blev inviteret til',
  'At dele et rygte videre uden at tjekke om det er sandt',
  'At hviske noget "hemmeligt" højt nok til at alle hører det',
  'At love at tie stille, og så sige det til den første man møder',
  'At overdrive en historie hver gang den fortælles videre',
  'At påstå man "bare spurgte", mens man reelt sladrede',
  'At kende alle detaljer om noget der ikke vedkommer en',
];

// Kun 1 stk, samme forsigtighed som WORLD_TRIVIA_BODE — en velkendt,
// bredt dokumenteret etymologi (godsibb = "gud" + "sibb"/slægtning, dvs.
// gudforælder/nær ven), ikke opdigtet. Udvid KUN med dobbelttjekkede fakta.
const WORLD_TRIVIA_SLADRE = [
  { question: 'Det engelske ord "gossip" (sladder) stammer fra det angelsaksiske "godsibb". Hvad betegnede det oprindeligt?', correct: 'En gudforælder eller nær ven', distractors: ['En kongelig budbringer', 'En kirkelig embedsmand', 'En markedssælger'] },
];
const WORLD_TRUEFALSE_SLADRE = [
  { statement: 'Ordet "gossip" kommer oprindeligt fra et gammelengelsk udtryk for en gudforælder eller nær ven, ikke fra et udtryk for at "snakke meget".', isTrue: true },
];

const DECOY_SLADRE = [
  'Fortalte en hemmelighed videre samme dag som løftet om tavshed',
  'Sladrede om en kollega ved kaffemaskinen',
  'Delte et skærmbillede af en privat besked',
  'Genfortalte en historie med ekstra detaljer, der ikke var sande',
  'Lyttede med på en samtale, der ikke handlede om en selv',
  'Videresendte et rygte uden at tjekke det først',
  'Sladrede om en ven til en anden ven',
  'Fortalte alle om en overraskelsesfest, før den var en overraskelse',
];

// Vennekassen
const QUIPLASH_PROMPTS_VENNE = [
  'Den mest sandsynlige grund til at {target} aflyser i sidste øjeblik er...',
  'Skriv den mest drilske kommentar til {target} om deres planlægningsevner',
  '{target} ville aldrig kunne overleve en vennetur uden...',
  'Den perfekte hævn over {target} for at glemme sin runde er...',
  'Hvis {target} havde sin egen vennegruppe-titel, ville den hedde...',
  '{target}s hemmelige superkraft er at være verdensmester i at...',
  'Det {target} bruger alt for lang tid på at vælge er...',
  'Om 10 år er {target} stadig kendt i vennegruppen for...',
];
const QUIPLASH_DECOYS_VENNE = [
  'At booke det samme sommerhus tre år i træk uden at spørge',
  'At love at "lige tjekke kalenderen" og aldrig svare igen',
  'At tabe brætspillet og kræve revanche med det samme',
  'At sende 15 beskeder i gruppechatten på fem minutter',
  'At foreslå det samme spisested hver eneste gang',
  'At love at køre, men altid komme for sent',
  'At glemme at betale sin andel af regningen',
  'At tage æren for en andens gode idé til vennetur',
];
const WORLD_TRIVIA_VENNE = [
  { question: 'Ifølge en kendt teori af antropologen Robin Dunbar er der en øvre grænse for hvor mange stabile venskaber en person typisk kan opretholde. Cirka hvor mange?', correct: 'Omkring 150', distractors: ['Omkring 15', 'Omkring 1.500', 'Omkring 5'] },
];
const WORLD_TRUEFALSE_VENNE = [
  { statement: 'Ifølge antropologen Robin Dunbar kan mennesker typisk kun opretholde omkring 150 stabile sociale relationer ad gangen — kendt som "Dunbars tal".', isTrue: true },
];
const DECOY_VENNE = [
  'Glemte at svare i gruppechatten i tre dage',
  'Bookede samme weekend som en andens fødselsdag',
  'Tabte brætspillet og væltede brættet "ved et uheld"',
  'Foreslog samme restaurant for fjerde gang i træk',
  'Kom en time for sent til den fælles afgang',
  'Glemte sin andel af den fælles dagligvarehandel',
  'Meldte afbud dagen før den planlagte tur',
  'Tog den sidste øl uden at sige det',
];

// Rosekassen — reward-polaritet
const QUIPLASH_PROMPTS_ROSE = [
  'Den mest velfortjente ros til {target} lige nu er...',
  'Skriv den flotteste kompliment til {target}',
  '{target} fortjener ros for altid at være god til...',
  'Den bedste overraskelse {target} kunne give er...',
  'Hvis {target} havde sin egen hæderspris, ville den hedde...',
  '{target}s mest undervurderede talent er...',
  'Det {target} gør bedst uden at vide det er...',
  'Om 10 år bliver {target} stadig rost for...',
];
const QUIPLASH_DECOYS_ROSE = [
  'At altid huske andres fødselsdage uden at blive mindet om det',
  'At dele sin sidste is uden at blive spurgt',
  'At give den mest oprigtige kompliment til den rette person',
  'At heppe højest selv når man selv taber',
  'At sige noget pænt til en fremmed uden grund',
  'At takke betjeningen ekstra tydeligt',
  'At rose en kollega foran chefen',
  'At give en ærlig, men venlig tilbagemelding',
];
const WORLD_TRIVIA_ROSE = [
  { question: 'Forskning i positiv psykologi (bl.a. af John Gottman) peger på et bestemt forhold mellem positive og negative kommentarer, der kendetegner stærke parforhold. Hvad kaldes det populært?', correct: 'Gottman-forholdet (ca. 5:1 positivt/negativt)', distractors: ['50/50-reglen', 'Guldne snit-reglen', '90/10-reglen'] },
];
const WORLD_TRUEFALSE_ROSE = [
  { statement: 'Forskeren John Gottman har foreslået at stærke parforhold typisk har omkring fem positive interaktioner for hver negativ.', isTrue: true },
];
const DECOY_ROSE = [
  'Roste en kollega for en detalje ingen andre lagde mærke til',
  'Gav en uventet kompliment til en fremmed i køen',
  'Fremhævede en vens fremgang foran hele gruppen',
  'Sagde noget pænt om maden til kokken selv',
  'Gav en ærlig, opmuntrende tilbagemelding',
  'Roste børnenes tålmodighed efter en lang dag',
  'Takkede chaufføren ekstra tydeligt',
  'Fremhævede en holdkammerats indsats efter tabet',
];

// Drikkekassen — session-baseret
const QUIPLASH_PROMPTS_DRIK = [
  'Den mest sandsynlige grund til at {target} skylder en runde er...',
  'Skriv den mest drilske kommentar til {target} om deres rundefidus',
  '{target} ville helt sikkert glemme sin runde hvis...',
  'Den perfekte hævn over {target} for at snyde i drikkelegen er...',
  'Hvis {target} havde sin egen signaturdrink, ville den hedde...',
  '{target}s hemmelige talent er at undgå at give runder ved at...',
  'Det {target} altid kommer for sent til festen med er...',
  'Om 10 år skylder {target} stadig en runde for...',
];
const QUIPLASH_DECOYS_DRIK = [
  'At love en runde og "glemme" det med det samme',
  'At spille samme sang tre gange i træk',
  'At snyde tydeligt i en drikkeleg og benægte det',
  'At forsvinde lige når regningen kommer',
  'At love at være ædru vært og alligevel drikke mest',
  'At sove over sig til sin egen fest',
  'At glemme hvor mange runder man selv har fået',
  'At love at ringe efter en taxa og glemme det',
];
const WORLD_TRIVIA_DRIK = [
  { question: 'Den skandinaviske skåltradition med at sige "skål" stammer sprogligt fra hvilket ord?', correct: 'Det gamle ord for drikkekar/bæger', distractors: ['Et gammelt krigsråb', 'Et ord for held', 'Navnet på en vikingekonge'] },
];
const WORLD_TRUEFALSE_DRIK = [
  { statement: 'Ordet "skål" som skåltale stammer sprogligt fra ordet for selve drikkekarret/bægeret man drak af.', isTrue: true },
];
const DECOY_DRIK = [
  'Glemte sin runde for tredje gang på en aften',
  'Spillede den samme sang igen og igen',
  'Snød tydeligt i en drikkeleg',
  'Forsvandt lige da regningen kom',
  'Sov over sig til sin egen fest',
  'Lovede at ringe efter en taxa og glemte det',
  'Drak af andres glas ved en fejl',
  'Kom uden gave til den fælles fest',
];

// Dynamisk Trivia & Dilemma-bank (IMPLEMENTATION PROTOCOL, min. 20 pr. tema):
// ÉN central, TAGGET pulje i stedet for et separat WORLD_TRIVIA_X-array pr.
// skin — hvert element bærer sine egne `tags` (hvilke(t) skin(s) det må vises
// i), og getTriviaForSkin(skinId) samler alt der matcher. Genbrug på tværs af
// skins er KUN tilladt hvor der er naturligt tematisk overlap (præcis de
// grupper protokollen selv definerer):
//   - Socialt/sjovt overlap: drik + venne + sladre
//   - Sandhed/afsløring:     sladre + logn
// RETTET (quizmaster-audit-fund, Martins live test — "Bødespillet bruger
// Brokspillet trivia, why?"): der stod tidligere også et "afgift/regel-
// overlap: bode + brok" her, som delte WORLD_TRIVIA (bogstaveligt om
// "brok"/offentlig kunde-utilfredshed) ind i Bødespillet. Holdt IKKE i
// praksis — samme STRICT BOUNDARY-princip som rose/konkurrence gælder nu
// også bode: egen, isoleret pulje, intet lån fra brok.
// STRICT BOUNDARY: rose og konkurrence (rene reward-polaritet-skins) får
// ALDRIG negativt/straf-vinklet indhold fra brok/bode — de har hver deres
// egen, isolerede pulje. bode (se ovenfor), og hjaelper (professionel/
// holdleder-tone, ikke uformel "brok") er af samme grund også isolerede.
// De ÆLDRE WORLD_TRIVIA_BODE/SLADRE/VENNE/ROSE/DRIK-arrays ovenfor holdes
// UÆNDREDE (bruges stadig direkte af CONTENT_BY_THEME.bode/sladre/venne/
// rose/drik's `worldTrueFalse`-felt), men deres `worldTrivia`-felt erstattes
// nedenfor af getTriviaForSkin(id) — selve spørgsmålsbanken er nu HER.
const THEME_TRIVIA = [
  // --- BROK (egen, isoleret pulje — se STRICT BOUNDARY ovenfor) ---
  ...WORLD_TRIVIA.map(item => ({ ...item, tags: ['brok'] })),
  // --- BØDE (egen, isoleret pulje — se WORLD_TRIVIA_BODE's kommentar) ---
  ...WORLD_TRIVIA_BODE.map(item => ({ ...item, tags: ['bode'] })),

  // --- SOCIALT/SJOVT (drik + venne + sladre) ---
  { question: 'Ifølge antropologen Robin Dunbar er der en øvre grænse for hvor mange stabile venskaber en person typisk kan opretholde. Cirka hvor mange?', correct: 'Omkring 150', distractors: ['Omkring 15', 'Omkring 1.500', 'Omkring 5'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Den skandinaviske skåltradition med at sige "skål" stammer sprogligt fra hvilket ord?', correct: 'Det gamle ord for drikkekar/bæger', distractors: ['Et gammelt krigsråb', 'Et ord for held', 'Navnet på en vikingekonge'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Hvilken dansk skik går ud på at banke i bordet, når nogen fortæller noget usandsynligt, for at "mane det i jorden"?', correct: 'At banke under bordet', distractors: ['At spytte tre gange', 'At klinke glas to gange', 'At rejse sig op'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Ifølge en kendt britisk undersøgelse tilbringer den gennemsnitlige voksne hvor meget af sin fritid sammen med venner om ugen (ca.)?', correct: 'Under 5 timer', distractors: ['Over 20 timer', 'Over 40 timer', 'Under 30 minutter'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Ordet "kammerat" stammer oprindeligt fra et tysk ord der betød hvad?', correct: 'En der deler kammer/værelse med en', distractors: ['En der drikker øl med en', 'En soldat af samme rang', 'En handelspartner'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Det klassiske drikkespil "Ring of Fire"/"Kongespillet" bruger typisk hvilket redskab?', correct: 'Et almindeligt spil kort', distractors: ['En terning', 'En spinning-flaske', 'Et dominosæt'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Hvad kaldes fænomenet, hvor man som gruppe tager mere risikable beslutninger sammen, end man ville gøre hver for sig?', correct: 'Gruppepolarisering', distractors: ['Flokinstinkt-bias', 'Social dovenskab', 'Konformitetspres'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Ifølge en kendt Harvard-undersøgelse er hvad den enkeltstående stærkeste faktor for et langt, lykkeligt liv?', correct: 'Gode nære relationer', distractors: ['Høj indkomst', 'Regelmæssig motion', 'Kort arbejdsuge'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Det gamle udtryk "at få sig en gang bagtalelse" hentyder til hvilken form for snak?', correct: 'At tale dårligt om nogen bag deres ryg', distractors: ['At synge en gammel folkesang', 'At fortælle en vittighed forkert', 'At spille et brætspil'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Hvor mange venner har den gennemsnitlige voksne dansker ifølge flere trivselsundersøgelser typisk som "nære" (ikke bare bekendte)?', correct: '3-5 stykker', distractors: ['15-20 stykker', '30-40 stykker', 'Under 1'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Det danske ord "gilde" (som i "drikkegilde") stammer fra et gammelt ord der betød hvad?', correct: 'Et lag/en sammenslutning der betalte fælles bidrag', distractors: ['En kongelig fest', 'Et sted man solgte øl', 'Et redskab til brygning'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Ifølge en kendt teori kræver det i gennemsnit hvor mange timers samvær, før en bekendt bliver til en "god ven"?', correct: 'Omkring 200 timer', distractors: ['Omkring 20 timer', 'Omkring 2.000 timer', 'Omkring 2 timer'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Hvad hedder det psykologiske fænomen, hvor man tror andre lægger langt mere mærke til ens fejltrin (fx en pinlig kommentar til en fest), end de faktisk gør?', correct: 'Spotlight-effekten', distractors: ['Halo-effekten', 'Bekræftelsesbias', 'Dunning-Kruger-effekten'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Traditionen med at "cheers"/skåle ved at røre glassene sammen menes historisk at stamme fra et ønske om at gøre hvad?', correct: 'Lade lidt drik sprøjte over i hinandens glas som tillidstegn (ingen gift)', distractors: ['Vække guderne med lyden', 'Teste om glasset var ægte krystal', 'Markere hvem der betalte runden'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Det klassiske selskabsspil "Tornado"/"Twister" blev oprindeligt markedsført med hvilket kontroversielt skjulte formål ifølge senere historieskrivning?', correct: 'Som et flirtent "kontakt-spil" for voksne', distractors: ['Som et rent træningsredskab', 'Som et undervisningsspil for skoler', 'Som en reklame for et tæppefirma'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Hvad kaldes det, når en historie eller et rygte vokser og ændrer sig for hver gang det genfortælles fra person til person?', correct: 'Hviskeleg-effekten (seriel reproduktion)', distractors: ['Bekræftelsesbias', 'Mandela-effekten', 'Group-think'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Ifølge klassisk etikette-tradition bør man ved en skål altid gøre hvad, før man drikker?', correct: 'Se de andre i øjnene', distractors: ['Rejse sig helt op', 'Sige et digt', 'Tømme glasset helt'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Hvor mange procent af al menneskelig samtale anslår sprogforskere handler om andre mennesker, dvs. reelt er en form for "sladder" i bred forstand?', correct: 'Omkring 65%', distractors: ['Omkring 5%', 'Omkring 95%', 'Omkring 20%'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'Det danske brætspil-udtryk "at gå bankerot" i et festspil stammer oprindeligt fra italiensk og betød bogstaveligt hvad?', correct: 'At bryde sin bænk/bord i stykker (en fallit handelsmands straf)', distractors: ['At tabe alle sine kort', 'At blive udelukket fra lauget', 'At skylde en konge penge'], tags: ['drik', 'venne', 'sladre'] },
  { question: 'En kendt undersøgelse fra Oxford peger på at latter i en gruppe primært tjener hvilket formål, mere end at signalere noget er sjovt?', correct: 'At styrke sociale bånd', distractors: ['At skræmme rivaler', 'At regulere kropstemperatur', 'At markere hierarki'], tags: ['drik', 'venne', 'sladre'] },

  // --- SANDHED/AFSLØRING (sladre + logn) ---
  { question: 'Det engelske ord "gossip" (sladder) stammer fra det angelsaksiske "godsibb". Hvad betegnede det oprindeligt?', correct: 'En gudforælder eller nær ven', distractors: ['En kongelig budbringer', 'En kirkelig embedsmand', 'En markedssælger'], tags: ['sladre', 'logn'] },
  { question: 'Løgnedetektor-testen (polygraf) måler ikke løgn direkte — hvad måler den reelt?', correct: 'Fysiske stressreaktioner som puls og sved', distractors: ['Hjerneaktivitet direkte', 'Øjenbevægelser alene', 'Stemmens tonehøjde alene'], tags: ['sladre', 'logn'] },
  { question: 'Ifølge flere adfærdsstudier lyver den gennemsnitlige voksne cirka hvor ofte om dagen?', correct: '1-2 gange', distractors: ['10-15 gange', 'Aldrig', 'Over 30 gange'], tags: ['sladre', 'logn'] },
  { question: 'Historien om Pinocchios voksende næse, hver gang han lyver, stammer fra hvilket land?', correct: 'Italien', distractors: ['Tyskland', 'Frankrig', 'Danmark'], tags: ['sladre', 'logn'] },
  { question: 'Hvad kaldes det, når man lyver overbevisende, fordi man selv er begyndt at tro på sin egen løgn?', correct: 'Selvbedrag', distractors: ['Konfabulation-syndrom', 'Falsk hukommelsesparadoks', 'Kognitiv dissonans-lammelse'], tags: ['sladre', 'logn'] },
  { question: 'Ifølge forskning i kropssprog er en klassisk (men ofte overdrevet) "tegn på løgn" at undgå hvad?', correct: 'Øjenkontakt', distractors: ['At krydse benene', 'At smile', 'At tale hurtigt'], tags: ['sladre', 'logn'] },
  { question: 'Det gamle udtryk "en hvid løgn" bruges om hvilken slags løgn?', correct: 'En uskyldig løgn ment til at skåne nogen', distractors: ['En løgn fortalt om vinteren', 'En officiel, dokumenteret løgn', 'En løgn ingen tror på'], tags: ['sladre', 'logn'] },
  { question: 'Hvad kaldes fænomenet, hvor mange mennesker uafhængigt "husker" den samme forkerte version af en begivenhed?', correct: 'Mandela-effekten', distractors: ['Dunning-Kruger-effekten', 'Halo-effekten', 'Placebo-effekten'], tags: ['sladre', 'logn'] },
  { question: 'I brætspillet/festlegen "Mafia"/"Werewolf" er selve kernemekanikken at nogle spillere skal gøre hvad over for resten?', correct: 'Lyve om deres skjulte rolle', distractors: ['Huske flest kort', 'Tegne hurtigst', 'Synge højest'], tags: ['sladre', 'logn'] },
  { question: 'Ifølge kendt forskning i løgn opdages de fleste løgne i hverdagen ikke via kropssprog, men via hvad?', correct: 'Modsigelser i selve historien over tid', distractors: ['Håndens temperatur', 'Pupillernes størrelse', 'Håndskriftens hældning'], tags: ['sladre', 'logn'] },
  { question: 'Det berømte "drengen der råbte ulv"-eventyr bruges typisk som advarsel mod hvad?', correct: 'At lyve så meget at ingen tror på en, når det gælder', distractors: ['At gå alene i skoven', 'At stole på fremmede', 'At holde får'], tags: ['sladre', 'logn'] },
  { question: 'Hvor mange af en løgners egne detaljer i en historie ændrer sig typisk, hver gang de genfortæller den, ifølge kriminalpsykologer?', correct: 'Flere — sande historier er faktisk MERE konsistente ved genfortælling', distractors: ['Ingen — løgne huskes bedst', 'Præcis de samme, altid', 'Kun navnet på personerne'], tags: ['sladre', 'logn'] },
  { question: 'Det engelske ord "fib" (en lille løgn) menes at stamme fra hvilket ældre udtryk?', correct: 'Et opdigtet "fable" (fabel/skrøne)', distractors: ['Et fiskeriudtryk for tomt net', 'Et gammelt bogholderiord', 'Navnet på en middelalderkonge'], tags: ['sladre', 'logn'] },
  { question: 'I klassisk retorik kaldes den kunst at overbevise nogen om noget usandt for hvad?', correct: 'Sofisteri', distractors: ['Retorisk syllogisme', 'Dialektik', 'Eufemisme'], tags: ['sladre', 'logn'] },
  { question: 'Ifølge en kendt Harvard-undersøgelse aktiverer det at holde en løgn hemmelig ofte de samme hjerneområder som hvad?', correct: 'Fysisk smerte/stress', distractors: ['Sult', 'Søvnighed', 'Kulde'], tags: ['sladre', 'logn'] },
  { question: 'Det danske udtryk "at sælge en historie" bruges typisk om hvad?', correct: 'At overbevise nogen om noget der ikke er helt sandt', distractors: ['At skrive en bog om nogen', 'At give en avis et interview', 'At fortælle en vits godt'], tags: ['sladre', 'logn'] },
  { question: 'Hvilken slags løgn kaldes "en skrøne" på dansk?', correct: 'En overdrevet, fantasifuld historie fortalt for sjov', distractors: ['En løgn fortalt i retten', 'En løgn om ens alder', 'En officiel undskyldning'], tags: ['sladre', 'logn'] },
  { question: 'I gamle dage brugte man ordsprog som "løgn har korte ben" for at udtrykke hvad?', correct: 'At løgne hurtigt bliver afsløret', distractors: ['At løgnere er dårlige løbere', 'At løgn er en synd', 'At børn lyver mest'], tags: ['sladre', 'logn'] },
  { question: 'Rygte-spredning i store grupper følger ofte samme matematiske mønster som hvad, ifølge netværksforskere?', correct: 'Spredning af en smitsom sygdom', distractors: ['Aktiekursers udsving', 'Vejrudsigter', 'Trafikpropper'], tags: ['sladre', 'logn'] },
  { question: 'Det klassiske "hvide løgn"-dilemma bruges ofte i etik-undervisning til at diskutere balancen mellem sandhed og hvad?', correct: 'Hensyn/venlighed', distractors: ['Lovgivning', 'Religion', 'Økonomi'], tags: ['sladre', 'logn'] },

  // --- ROSEKASSEN (isoleret, ren reward) ---
  { question: 'Forskning i positiv psykologi (bl.a. af John Gottman) peger på et bestemt forhold mellem positive og negative kommentarer, der kendetegner stærke parforhold. Hvad kaldes det populært?', correct: 'Gottman-forholdet (ca. 5:1 positivt/negativt)', distractors: ['50/50-reglen', 'Guldne snit-reglen', '90/10-reglen'], tags: ['rose'] },
  { question: 'Ifølge trivselsforskning har det at give ros og komplimenter en positiv effekt primært for hvem?', correct: 'Både giveren og modtageren', distractors: ['Kun modtageren', 'Kun giveren', 'Ingen af dem, målbart'], tags: ['rose'] },
  { question: 'Hvad kaldes det psykologiske fænomen, hvor en enkelt positiv egenskab hos nogen får os til automatisk at antage flere gode ting om personen?', correct: 'Halo-effekten', distractors: ['Spotlight-effekten', 'Confirmation bias', 'Anker-effekten'], tags: ['rose'] },
  { question: 'Ifølge en kendt undersøgelse husker folk oftest ikke ORDENE i en kompliment, men hvad?', correct: 'Følelsen af at blive set/værdsat', distractors: ['Hvem der stod ved siden af', 'Tidspunktet på dagen', 'Vejret den dag'], tags: ['rose'] },
  { question: 'Taknemmeligheds-dagbøger (at skrive 3 gode ting ned hver dag) er en velkendt øvelse inden for hvilket forskningsfelt?', correct: 'Positiv psykologi', distractors: ['Adfærdsøkonomi', 'Neurokirurgi', 'Kriminologi'], tags: ['rose'] },
  { question: 'Det gamle udtryk "at give nogen en guldstjerne" stammer fra hvilken oprindelige praksis?', correct: 'Lærere der belønnede elevers gode arbejde med et stjernemærke', distractors: ['Militærets rangmærker', 'Middelalderlige riddertitler', 'En gammel handelstradition'], tags: ['rose'] },
  { question: 'Ifølge forskning i arbejdsglæde er anerkendelse fra kolleger ofte en STÆRKERE motivationsfaktor end hvad?', correct: 'En lille lønforhøjelse', distractors: ['Frokostpausens længde', 'Kontorets indretning', 'Antal møder om ugen'], tags: ['rose'] },
  { question: 'Det japanske koncept "ikigai" handler grundlæggende om at finde hvad?', correct: 'Sin livsglæde/mening med tilværelsen', distractors: ['Den perfekte kop te', 'En livslang karriere ét sted', 'Fysisk balance gennem yoga'], tags: ['rose'] },
  { question: 'Ifølge en kendt undersøgelse fra University of Pennsylvania øger det at skrive et taknemmeligheds-brev til nogen modtagerens lykkefølelse i hvor lang tid bagefter (målt)?', correct: 'I flere uger', distractors: ['Kun i få minutter', 'Slet ikke, målbart', 'I flere år'], tags: ['rose'] },
  { question: 'Hvad kaldes det, når man aktivt fejrer en andens succes lige så meget som sin egen — en kendt nøgle til stærke venskaber?', correct: 'Capitalization (at "kapitalisere" på gode nyheder sammen)', distractors: ['Reciprocitet', 'Halo-effekt', 'Social facilitering'], tags: ['rose'] },
  { question: 'Ifølge trivselsforskning er en oprigtig, KONKRET kompliment (fx om en handling) generelt mere virkningsfuld end hvad?', correct: 'En vag, generel kompliment (fx "du er sød")', distractors: ['En skriftlig kompliment', 'En kompliment fra en fremmed', 'En kompliment givet privat'], tags: ['rose'] },
  { question: 'Traditionen med at give en "medalje" for en god præstation stammer historisk fra hvilken type begivenhed?', correct: 'Sportslige/olympiske konkurrencer i antikken', distractors: ['Kongelige kroninger', 'Religiøse højtider', 'Militære parader alene'], tags: ['rose'] },
  { question: 'Det engelske udtryk "pat on the back" (et klap på skulderen) bruges billedligt om hvad?', correct: 'At anerkende nogens gode indsats', distractors: ['At trøste nogen i sorg', 'At sige farvel', 'At advare nogen'], tags: ['rose'] },
  { question: 'Ifølge forskning smitter positive følelser mellem mennesker gennem et netværk ligesom hvad?', correct: 'En bølge — også via venners venner, ikke kun direkte kontakter', distractors: ['Kun mellem par', 'Slet ikke, målbart', 'Kun inden for familier'], tags: ['rose'] },
  { question: 'Hvad kaldes det, når man bevidst lægger mærke til og udtaler noget positivt om en andens karakter (ikke bare en handling)?', correct: 'Karakterstyrke-anerkendelse', distractors: ['Reciprok altruisme', 'Social spejling', 'Positiv forstærkning alene'], tags: ['rose'] },
  { question: 'Ifølge en kendt undersøgelse i skoleklasser øgede læreres brug af specifik, ægte ros elevernes indsats markant mere end hvad?', correct: 'Ros af intelligens ("du er så klog")', distractors: ['Ingen ros overhovedet', 'Materielle belønninger', 'Karakterer alene'], tags: ['rose'] },
  { question: 'Det gamle ordsprog "et venligt ord koster intet, men er værd meget" understreger hvad?', correct: 'At anerkendelse har stor værdi uden at koste noget', distractors: ['At gaver bør være billige', 'At man skal spare på ordene', 'At tavshed er guld'], tags: ['rose'] },
  { question: 'Ifølge positiv psykologi er "at fejre de små sejre" undervejs en kendt metode til at opnå hvad?', correct: 'Vedvarende motivation mod et større mål', distractors: ['Hurtigere resultater alene', 'Mindre konkurrence i gruppen', 'Lavere forventninger generelt'], tags: ['rose'] },
  { question: 'Hvad kaldes det, når man modtager ros og automatisk afviser den ("det var ikke noget særligt") i stedet for at tage imod den?', correct: 'Kompliment-afbøjning', distractors: ['Social facilitering', 'Selvhandicapping', 'Impostor-projektion'], tags: ['rose'] },
  { question: 'Ifølge en kendt undersøgelse husker folk generelt POSITIVE sociale interaktioner (som en god kompliment) i hvor lang tid, sammenlignet med neutrale hændelser?', correct: 'Markant længere', distractors: ['Kortere tid', 'Præcis lige så længe', 'De glemmes hurtigst af alle'], tags: ['rose'] },

  // --- KONKURRENCEKASSEN (isoleret, ren reward) ---
  { question: 'Ved de olympiske lege i antikkens Grækenland fik vinderen oprindeligt hvilken pris — IKKE en guldmedalje?', correct: 'En krans af oliegrene', distractors: ['En sæk guldmønter', 'Et sværd', 'En statue af sig selv'], tags: ['konkurrence'] },
  { question: 'Hvad kaldes det, når en konkurrence ender helt lige, og man må bruge en ekstra afgørende runde?', correct: 'Omkamp/tie-break', distractors: ['Diskvalifikation', 'Walkover', 'Handicap-runde'], tags: ['konkurrence'] },
  { question: 'Ifølge sportspsykologer er "at være i flow" en tilstand hvor man præsterer bedst, fordi opgaven er hvad?', correct: 'Passende udfordrende — hverken for let eller for svær', distractors: ['Helt uden pres', 'Fysisk let', 'Løst udelukkende alene'], tags: ['konkurrence'] },
  { question: 'I brætspillet skak kaldes det træk, hvor man sætter modstanderens konge fast uden mulighed for at slippe væk, for hvad?', correct: 'Skakmat', distractors: ['Rokade', 'Remis', 'Gambit'], tags: ['konkurrence'] },
  { question: 'Det engelske udtryk "underdog" bruges om en deltager, der forventes at hvad?', correct: 'Tabe, men alligevel overrasker', distractors: ['Vinde sikkert', 'Trække sig fra konkurrencen', 'Dømme konkurrencen'], tags: ['konkurrence'] },
  { question: 'Ifølge konkurrenceforskning præsterer folk ofte bedre i en gruppe-konkurrence, når de kan se hvad undervejs?', correct: 'Deres egen fremgang/score i realtid', distractors: ['Kun slutresultatet til sidst', 'Modstanderens strategi på forhånd', 'Dommerens noter'], tags: ['konkurrence'] },
  { question: 'Hvad kaldes en konkurrenceform, hvor alle møder alle mindst én gang, i modsætning til en udslagsturnering?', correct: 'Alle-mod-alle (round robin)', distractors: ['Knockout-format', 'Gruppefinale', 'Ligastige'], tags: ['konkurrence'] },
  { question: 'I quizsammenhænge kaldes en fælles sidste, højt-vægtet afgørende runde ofte for hvad?', correct: 'Finalerunden/jackpot-runden', distractors: ['Startrunden', 'Straffe-runden', 'Bonusfeltet'], tags: ['konkurrence'] },
  { question: 'Ifølge sportspsykologi kan det at "hepe" højlydt på et hold reelt måles til at give en fordel — hvad kaldes fænomenet?', correct: 'Hjemmebane-fordelen', distractors: ['Placebo-effekten', 'Halo-effekten', 'Spotlight-effekten'], tags: ['konkurrence'] },
  { question: 'Det klassiske "sten, saks, papir"-spil bruges ofte til at afgøre hvad i uformelle konkurrencer?', correct: 'Hvem der starter/får første tur', distractors: ['Den endelige vinder alene', 'Point-fordelingen', 'Dommerens afgørelse'], tags: ['konkurrence'] },
  { question: 'I mange brætspil kaldes den startspiller-fordel man kan få ved terningkast for hvad?', correct: 'Førsteret/startfordel', distractors: ['Handicap', 'Straffekast', 'Byttehandel'], tags: ['konkurrence'] },
  { question: 'Ifølge konkurrenceteori kan "gamification" (at gøre almindelige opgaver til et spil med point) øge motivationen markant — hvad er en klassisk grund til det?', correct: 'Øjeblikkelig feedback og synlig fremgang', distractors: ['Det fjerner al konkurrence', 'Det kræver ingen indsats', 'Det er altid tilfældigt'], tags: ['konkurrence'] },
  { question: 'Det engelske sportsudtryk "photo finish" beskriver en situation hvor hvad afgør sejren?', correct: 'Et fotografi, fordi løbet var for tæt til at se med det blotte øje', distractors: ['Et møntkast', 'Dommerens mavefornemmelse', 'Et ekstra omløb'], tags: ['konkurrence'] },
  { question: 'I mange quizspil kaldes den regel, hvor et forkert svar koster point i stedet for blot intet at give, for hvad?', correct: 'Negativ point-scoring (straf for forkert svar)', distractors: ['Bonusregel', 'Joker-regel', 'Håndicap-regel'], tags: ['konkurrence'] },
  { question: 'Ifølge sportshistorien opstod udtrykket "at gå efter guldet" fra hvilken konkurrenceform?', correct: 'De moderne olympiske lege og deres guldmedaljer', distractors: ['Middelalderlige riddertuneringer', 'Antikkens væddeløb alene', 'En gammel guldgraver-tradition'], tags: ['konkurrence'] },
  { question: 'Hvad kaldes det, når to hold/spillere bytter roller undervejs i en konkurrence for at gøre den mere fair (fx i en quiz)?', correct: 'Rotation/skiftende rækkefølge', distractors: ['Diskvalifikation', 'Sudden death', 'Voldgift'], tags: ['konkurrence'] },
  { question: 'I mange holdkonkurrencer bruges en "joker", der lader et hold gøre hvad én gang i løbet af spillet?', correct: 'Doble deres point på et valgt spørgsmål/runde', distractors: ['Springe en runde over helt', 'Diskvalificere modstanderen', 'Bytte hold midtvejs'], tags: ['konkurrence'] },
  { question: 'Ifølge motivationsforskning er konkurrencer med SYNLIGE ranglister ofte mere motiverende, fordi de udnytter hvilket menneskeligt træk?', correct: 'Trangen til social sammenligning', distractors: ['Frygten for mørke', 'Behovet for stilhed', 'Ønsket om at være alene'], tags: ['konkurrence'] },
  { question: 'Det gamle udtryk "at vinde med hestelængder" (stor sikker margin) stammer fra hvilken sportsgren?', correct: 'Hestevæddeløb', distractors: ['Sejlsport', 'Skak', 'Cykelløb'], tags: ['konkurrence'] },
  { question: 'I mange familie-/venneturneringer bruges "bedst af tre" som afgørelsesform, fordi det gør hvad?', correct: 'Reducerer betydningen af ren tilfældighed i én enkelt runde', distractors: ['Gør spillet kortere generelt', 'Kræver færre deltagere', 'Fjerner behovet for dommer'], tags: ['konkurrence'] },

  // --- KOLLEGAKASSEN (isoleret, professionel/holdleder-tone) ---
  { question: 'Den kendte "Tjekliste"-metode til at reducere fejl på fx hospitaler og i luftfarten blev populariseret af hvilken forfatter/læge?', correct: 'Atul Gawande', distractors: ['Florence Nightingale', 'Ignaz Semmelweis', 'Alexander Fleming'], tags: ['hjaelper'] },
  { question: 'I kvalitetsstyring kaldes princippet om løbende, små forbedringer for hvad (oprindeligt et japansk begreb)?', correct: 'Kaizen', distractors: ['Kanban', 'Lean startup', 'Six Sigma'], tags: ['hjaelper'] },
  { question: 'Hvad kaldes den type fejl, hvor flere små uafhængige svigt tilfældigt sker samtidig og fører til en større hændelse?', correct: 'Schweizerost-modellen (flere "huller" der stemmer overens)', distractors: ['Domino-effekten alene', 'Peter-princippet', 'Parkinsons lov'], tags: ['hjaelper'] },
  { question: 'I mange virksomheder bruges en "post-mortem"/evaluering efter en fejl primært til hvad?', correct: 'At lære af fejlen uden at placere personlig skyld', distractors: ['At finde en syndebuk', 'At dokumentere til en fyring', 'At undgå at rette fejlen'], tags: ['hjaelper'] },
  { question: 'Det engelske begreb "near miss" (nærved-hændelse) bruges i arbejdsmiljøarbejde om hvad?', correct: 'En situation der kunne være gået galt, men ikke gjorde', distractors: ['En fejl der allerede er sket', 'En plan der blev aflyst', 'Et møde der blev udsat'], tags: ['hjaelper'] },
  { question: 'Ifølge arbejdsmiljøforskning falder antallet af fejl markant, når medarbejdere trygt kan gøre hvad?', correct: 'Melde fejl uden frygt for konsekvenser', distractors: ['Arbejde helt alene', 'Undgå al feedback', 'Skifte opgave hver dag'], tags: ['hjaelper'] },
  { question: 'Den velkendte "fire-øjne-princip" i kvalitetssikring betyder at vigtigt arbejde altid skal hvad?', correct: 'Tjekkes af mindst to personer', distractors: ['Udføres to gange af samme person', 'Godkendes af en leder alene', 'Dokumenteres i to eksemplarer'], tags: ['hjaelper'] },
  { question: 'I Toyotas berømte produktionssystem kunne enhver medarbejder trække i en snor for at gøre hvad, hvis de så en fejl?', correct: 'Stoppe hele samlebåndet med det samme', distractors: ['Tilkalde en tolk', 'Bestille flere reservedele', 'Skifte til natskift'], tags: ['hjaelper'] },
  { question: 'Det såkaldte "Peter-princip" beskriver en kendt arbejdspladstendens til at folk forfremmes indtil hvad?', correct: 'De når et niveau, hvor de ikke længere er kompetente', distractors: ['De går på pension', 'De skifter branche', 'De bliver chef for sig selv'], tags: ['hjaelper'] },
  { question: 'Hvad kaldes det dokument, der beskriver præcis hvordan en opgave skal udføres hver gang, for at undgå variation og fejl?', correct: 'En standardprocedure (SOP)', distractors: ['En mødereferat', 'En stillingsbeskrivelse', 'En trivselsrapport'], tags: ['hjaelper'] },
  { question: 'Ifølge klassisk ledelsesteori er konstruktiv feedback mest effektiv, når den gives hvornår efter en fejl?', correct: 'Så tæt på hændelsen som muligt', distractors: ['Ved den årlige medarbejdersamtale alene', 'Aldrig direkte, kun skriftligt', 'Foran hele afdelingen'], tags: ['hjaelper'] },
  { question: 'Det japanske begreb "5S" i arbejdspladsorganisering handler grundlæggende om hvad?', correct: 'Orden, struktur og systematisk oprydning på arbejdspladsen', distractors: ['Fem årlige medarbejdersamtaler', 'Fem sikkerhedsniveauer', 'Fem-dages arbejdsuge'], tags: ['hjaelper'] },
  { question: 'Hvad kaldes det, når man bevidst dobbelttjekker sit eget arbejde, før man afleverer det videre?', correct: 'Selvkontrol/egenkontrol', distractors: ['Delegering', 'Eskalering', 'Benchmarking'], tags: ['hjaelper'] },
  { question: 'Ifølge arbejdsmiljøforskning er en "just culture" (retfærdig kultur) kendetegnet ved at skelne mellem hvad?', correct: 'Ærlige fejl og bevidst skødesløshed', distractors: ['Nye og gamle medarbejdere', 'Store og små virksomheder', 'Dag- og nattevagter'], tags: ['hjaelper'] },
  { question: 'Den kendte "tjek-dobbelt-tjek"-praksis i flyluftfarten før take-off kaldes officielt hvad?', correct: 'Pre-flight tjekliste', distractors: ['Cockpit-briefing alene', 'Passagermanifest', 'Vejrudsigtsprotokol'], tags: ['hjaelper'] },
  { question: 'Ifølge ledelsesforskning er anerkendelse af GOD kvalitet i arbejdet — ikke kun rettelse af fejl — afgørende for hvad?', correct: 'Fastholdt høj kvalitet og motivation over tid', distractors: ['Hurtigere arbejdstempo alene', 'Færre medarbejdere behøves', 'Kortere arbejdsdage'], tags: ['hjaelper'] },
  { question: 'Det engelske ord "accountability" (ansvarlighed) på en arbejdsplads betyder primært hvad?', correct: 'At stå ved sine handlinger og deres konsekvenser', distractors: ['At have flest bogholderi-opgaver', 'At arbejde flest timer', 'At være øverste leder'], tags: ['hjaelper'] },
  { question: 'Ifølge kvalitetsstyringsteori er det billigst at rette en fejl hvornår i en arbejdsproces?', correct: 'Så tidligt som muligt', distractors: ['Efter aflevering til kunden', 'Ved årsafslutningen', 'Det er lige dyrt uanset hvornår'], tags: ['hjaelper'] },
  { question: 'Den kendte "brown paper"-øvelse i procesforbedring går ud på at gøre hvad?', correct: 'Tegne hele arbejdsprocessen fysisk op på papir for at finde flaskehalse', distractors: ['Pakke varer ind i brunt papir', 'Skrive en årsrapport i hånden', 'Male kontoret brunt'], tags: ['hjaelper'] },
  { question: 'Ifølge trivselsundersøgelser på arbejdspladser er en tydelig, forudsigelig proces for at melde fejl med til at gøre hvad?', correct: 'Reducere stress og øge trygheden ved arbejdet', distractors: ['Gøre arbejdet langsommere', 'Øge antallet af fejl', 'Reducere behovet for kompetencer'], tags: ['hjaelper'] },
];

function getTriviaForSkin(skinId){
  const items = THEME_TRIVIA.filter(item => item.tags.includes(skinId));
  return shuffle(items.slice());
}

// Kasse-motor-generalisering (Fase 1, se god-finding-men-du-lovely-zephyr.md):
// tema-keyet indholds-opslag. 'brok' refererer UÆNDRET til konstanterne
// ovenfor (ingen indholds-omskrivning, kun et lookup-lag) — DECOY_BROK
// defineres længere nede i filen, tilføjes til CONTENT_BY_THEME.brok efter
// sin egen definition (se modul-bund), ikke her, for ikke at bruge en
// konstant før den er initialiseret.
// Konkurrence/logn/hjaelper's egne, dedikerede quiplash-sæt — se STRICT
// BOUNDARY-fundet nedenfor (Trivia-protokollen): Konkurrencekassen brugte
// UÆNDRET at genbruge brok-indholdet (QUIPLASH_PROMPTS, "brokker sig"-
// vinklet), hvilket reelt LAK straf-vinklet sprog ind i en ren reward-skin —
// en levende, nåbar fejl (Konkurrencekassens 'spil' ER aktiveret), ikke kun
// et teoretisk problem. Rettet med egne, sejrs-/konkurrence-vinklede sæt.
const QUIPLASH_PROMPTS_KONKURRENCE = [
  'Den mest sandsynlige grund til at {target} vinder næste runde er...',
  'Skriv den bedste sejrs-kommentar til {target}',
  '{target} ville helt sikkert vinde en konkurrence i...',
  'Den mest overdrevne sejrsdans {target} kunne finde på er...',
  'Hvis {target} havde sin egen mesterskabstitel, ville den hedde...',
  '{target}s hemmelige konkurrence-supertalent er...',
  'Det {target} altid vinder over de andre i er...',
  'Om 10 år husker alle stadig {target} for at have vundet...',
];
const QUIPLASH_DECOYS_KONKURRENCE = [
  'At vinde tre gange i træk og stadig kræve revanche',
  'At have en helt urimeligt god held-stribe',
  'At forberede sig alt for grundigt til en simpel leg',
  'At fejre en sejr som om det var en VM-finale',
  'At finde et smuthul i reglerne og udnytte det til fulde',
  'At coache alle andre midt i egen kamp',
  'At huske hver eneste sejr i mindste detalje',
  'At påstå det var "ren strategi", når det var ren tilfældighed',
];
const WORLD_TRUEFALSE_KONKURRENCE = [
  { statement: 'Ved de olympiske lege i antikkens Grækenland fik vinderen en krans af oliegrene i stedet for en medalje.', isTrue: true },
];
const DECOY_KONKURRENCE = [
  'Vandt tre runder i træk og krævede revanche alligevel',
  'Lavede en overdrevet sejrsdans midt i stuen',
  'Fandt et smuthul i reglerne ingen havde set',
  'Forberedte sig alt for seriøst til en afslappet leg',
  'Coachede alle andre midt i sin egen tur',
  'Huskede scoren fra en kamp for tre år siden',
  'Påstod det var strategi, da det var rent held',
  'Krævede en officiel "omkamp" over en bagatel',
];

// Løgnerkassens og Kollegakassens egne quiplash-sæt (defensivt/fremtids-
// sikret: 'spil' er ikke slået til for disse to skins i SKIN_PRESETS'
// allowedGames i dag, men getThemeContent faldt tidligere stille tilbage
// til RÅ brok-indhold for begge, hvis noget nogensinde kaldte dem — samme
// slags leak-mønster som Konkurrencekassens, blot ikke UI-nåbart endnu).
const QUIPLASH_PROMPTS_LOGN = [
  'Den mest sandsynlige løgn {target} fortalte for nylig er...',
  'Skriv den mest overbevisende (opdigtede) undskyldning for {target}',
  '{target} ville helt sikkert lyve om...',
  'Den mest gennemskuelige løgn {target} nogensinde har fortalt er...',
  'Hvis {target} havde sin egen løgnehistorie-titel, ville den hedde...',
  '{target}s hemmelige talent er at bluffe om...',
  'Det {target} altid overdriver en lille smule er...',
  'Om 10 år afsløres {target} stadig for at have løjet om...',
];
const QUIPLASH_DECOYS_LOGN = [
  'At sige "jeg var lige på vej" i en time',
  'At påstå at have læst hele bogen på én aften',
  'At love at det "kun tager to minutter"',
  'At sige man ikke så beskeden, selvom den blev læst med det samme',
  'At overdrive hvor travlt man har haft',
  'At påstå en fejl var "med vilje"',
  'At sige man "næsten" nåede det',
  'At love at huske det denne gang',
];
const WORLD_TRUEFALSE_LOGN = [
  { statement: 'En løgnedetektor (polygraf) måler ikke løgn direkte, men fysiske stressreaktioner som puls og sved.', isTrue: true },
];
const DECOY_LOGN = [
  'Sagde "jeg var lige på vej" en time for tidligt',
  'Påstod at have læst hele materialet grundigt',
  'Lovede det kun ville tage to minutter',
  'Overdrev hvor travlt dagen havde været',
  'Sagde en fejl var med vilje, efter den blev opdaget',
  'Påstod at "næsten" have nået deadline',
  'Lovede at huske det denne gang, igen',
  'Sagde beskeden ikke var set, selvom den var læst',
];

const QUIPLASH_PROMPTS_HJAELPER = [
  'Den mest sandsynlige grund til at {target} laver samme fejl igen er...',
  'Skriv den mest professionelle (men morsomme) tilbagemelding til {target}',
  '{target} ville helt sikkert glemme tjeklisten hvis...',
  'Den mest kreative undskyldning {target} kunne finde på for en fejl er...',
  'Hvis {target} havde sin egen kvalitetsstandard, ville den hedde...',
  '{target}s hemmelige talent er at overse detaljen om...',
  'Det {target} altid glemmer at dobbelttjekke er...',
  'Om 10 år husker teamet stadig {target} for...',
];
const QUIPLASH_DECOYS_HJAELPER = [
  'Glemte at krydse af på tjeklisten alligevel',
  'Sprang sidste kontroltrin over "for at spare tid"',
  'Antog at en anden allerede havde tjekket det',
  'Overså en detalje, der stod tydeligt i vejledningen',
  'Lovede at rette det "med det samme" og glemte det',
  'Genbrugte en gammel løsning uden at opdatere den',
  'Meldte opgaven færdig en time for tidligt',
  'Stolede på hukommelsen i stedet for tjeklisten',
];
const WORLD_TRUEFALSE_HJAELPER = [
  { statement: 'Den kendte "tjekliste"-metode til at reducere fejl på hospitaler og i luftfarten blev populariseret af lægen og forfatteren Atul Gawande.', isTrue: true },
];
const DECOY_HJAELPER = [
  'Glemte at krydse af på tjeklisten',
  'Sprang sidste kontroltrin over for at spare tid',
  'Antog en anden allerede havde tjekket det',
  'Overså en detalje der stod i vejledningen',
  'Lovede at rette det med det samme og glemte det',
  'Genbrugte en gammel løsning uden at opdatere den',
  'Meldte en opgave færdig for tidligt',
  'Stolede på hukommelsen frem for tjeklisten',
];

const CONTENT_BY_THEME = {
  brok: {
    quiplashPrompts: QUIPLASH_PROMPTS,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS,
    worldTrivia: getTriviaForSkin('brok'),
    worldTrueFalse: WORLD_TRUEFALSE,
    gameName: 'Brokspillet',
  },
  // Fase 5 bevis-tema. winnerTauntPrompts GENBRUGER WINNER_TAUNT_PROMPTS
  // uændret (allerede tema-agnostisk, se Simulerings-afsnittet i planen:
  // "sejrs-hån" nævner ingen brok-specifik tekst). gameName "Bødespillet"
  // følger navnekonventionen "{Tema}spillet" bekræftet i planen.
  bode: {
    quiplashPrompts: QUIPLASH_PROMPTS_BODE,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_BODE,
    worldTrivia: getTriviaForSkin('bode'),
    worldTrueFalse: WORLD_TRUEFALSE_BODE,
    decoyBrok: DECOY_BODE,
    gameName: 'Bødespillet',
  },
  // Tredje tema, Sladrekassen — navnepreset på Gruppekasse-motoren (se
  // KASSEMOTORPLAN.md's klassifikations-tabel: kvorum, alle tre spil mulige).
  venne: {
    quiplashPrompts: QUIPLASH_PROMPTS_VENNE,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_VENNE,
    worldTrivia: getTriviaForSkin('venne'),
    worldTrueFalse: WORLD_TRUEFALSE_VENNE,
    decoyBrok: DECOY_VENNE,
    gameName: 'Vennespillet',
  },
  rose: {
    quiplashPrompts: QUIPLASH_PROMPTS_ROSE,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_ROSE,
    worldTrivia: getTriviaForSkin('rose'),
    worldTrueFalse: WORLD_TRUEFALSE_ROSE,
    decoyBrok: DECOY_ROSE,
    gameName: 'Rosespillet',
  },
  drik: {
    quiplashPrompts: QUIPLASH_PROMPTS_DRIK,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_DRIK,
    worldTrivia: getTriviaForSkin('drik'),
    worldTrueFalse: WORLD_TRUEFALSE_DRIK,
    decoyBrok: DECOY_DRIK,
    gameName: 'Rundespillet',
  },
  // Konkurrencekassen — poolPolarity:'reward'-motoren. Genbrugte tidligere
  // brok-indholdet UÆNDRET ("kun gameName er nyt") — RETTET her (Trivia-
  // protokollens STRICT BOUNDARY): egne, sejrs-vinklede quiplash/decoy/
  // trivia-sæt i stedet, se QUIPLASH_PROMPTS_KONKURRENCE ovenfor.
  konkurrence: {
    quiplashPrompts: QUIPLASH_PROMPTS_KONKURRENCE,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_KONKURRENCE,
    worldTrivia: getTriviaForSkin('konkurrence'),
    worldTrueFalse: WORLD_TRUEFALSE_KONKURRENCE,
    decoyBrok: DECOY_KONKURRENCE,
    gameName: 'Konkurrencespillet',
  },
  sladre: {
    quiplashPrompts: QUIPLASH_PROMPTS_SLADRE,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_SLADRE,
    worldTrivia: getTriviaForSkin('sladre'),
    worldTrueFalse: WORLD_TRUEFALSE_SLADRE,
    decoyBrok: DECOY_SLADRE,
    gameName: 'Sladrespillet',
  },
  // logn/hjaelper: 'spil' er ikke aktiveret for disse to skins i
  // SKIN_PRESETS.allowedGames i dag, MEN getThemeContent faldt tidligere
  // stille tilbage til rå brok-indhold for begge, hvis noget nogensinde
  // kaldte dem (defensivt hul, samme mønster som Konkurrencekassens
  // bekræftede leak) — udfyldt fuldt ud her, ikke kun trivia-feltet.
  logn: {
    quiplashPrompts: QUIPLASH_PROMPTS_LOGN,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_LOGN,
    worldTrivia: getTriviaForSkin('logn'),
    worldTrueFalse: WORLD_TRUEFALSE_LOGN,
    decoyBrok: DECOY_LOGN,
    gameName: 'Løgnespillet',
  },
  hjaelper: {
    quiplashPrompts: QUIPLASH_PROMPTS_HJAELPER,
    winnerTauntPrompts: WINNER_TAUNT_PROMPTS,
    quiplashDecoys: QUIPLASH_DECOYS_HJAELPER,
    worldTrivia: getTriviaForSkin('hjaelper'),
    worldTrueFalse: WORLD_TRUEFALSE_HJAELPER,
    decoyBrok: DECOY_HJAELPER,
    gameName: 'Kollegaspillet',
  },
};
function getThemeContent(themeId) {
  return CONTENT_BY_THEME[themeId] || CONTENT_BY_THEME.brok;
}

// "Shuffle bag": trækker uden tilbagelægning fra en pulje af indeks, så intet
// gentages før ALT er brugt — brugte ting ryger bagerst i køen, ikke tilbage
// i puljen med det samme. Gemmes på RUM-niveau (ikke i selve spil-sessionen),
// så rotationen holder på tværs af flere afsluttede spil, ikke kun én omgang.
function pickFromBag(state, bagKey, poolLength) {
  if (!state.gameContentBank) state.gameContentBank = {};
  if (!state.gameContentBank.bags) state.gameContentBank.bags = {};
  let bag = state.gameContentBank.bags[bagKey];
  if (!bag || !bag.length) bag = shuffle(Array.from({ length: poolLength }, (_, i) => i));
  const idx = bag.pop();
  state.gameContentBank.bags[bagKey] = bag;
  return idx;
}

function pickQuiplashPrompt(state, members) {
  const target = pickRandom(members);
  const prompts = getThemeContent(state.themeId).quiplashPrompts;
  const idx = pickFromBag(state, 'quiplash', prompts.length);
  return { prompt: prompts[idx].replace(/\{target\}/g, target.name), targetId: target.id };
}

function pickWorldTrivia(state) {
  const pool = getThemeContent(state.themeId).worldTrivia;
  const idx = pickFromBag(state, 'world', pool.length);
  const item = pool[idx];
  return { question: item.question, isWorld: true, ...buildOptions(item.correct, item.distractors) };
}

function pickWorldTrueFalse(state) {
  const pool = getThemeContent(state.themeId).worldTrueFalse;
  const idx = pickFromBag(state, 'worldTruefalse', pool.length);
  const item = pool[idx];
  return { statement: item.statement, isTrue: item.isTrue, isWorld: true };
}

// Kasse-motor-generalisering (Fase 1, se god-finding-men-du-lovely-zephyr.md):
// spørgsmåls-SKABELONER pr. tema, adskilt fra CONTENT_BY_THEME fordi disse
// ikke er en pulje at vælge FRA — de udfyldes med rummets EGNE data ved
// hver generering (se "Tredje indholdskilde"-fundet i planen). 'brok'
// indeholder den UÆNDREDE originaltekst, kun flyttet ind i en tema-nøgle.
const QUESTION_TEMPLATES_BY_THEME = {
  brok: {
    mostCount: 'Hvem har brokket sig flest gange i denne brokkekasse?',
    fewestCount: 'Hvem har brokket sig færrest gange i denne brokkekasse?',
    totalCount: 'Hvor mange brok er der registreret i alt i denne brokkekasse?',
    longestStreak: 'Hvem har den længste aktuelle streak uden brok?',
    quoteWho: quote => `Ifølge Brokkekassen brokkede nogen sig over: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilket af disse ting brokkede ${name} sig over?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne brokkekasse?',
  },
  // Fase 5 bevis-tema: samme struktur, egen grammatik ("fået bøder" i
  // stedet for "brokket sig", "bødekasse" i stedet for "brokkekasse") —
  // IKKE en mekanisk ord-for-ord-substitution af brok-varianten, se planens
  // pointe om at "ren tekst-omskrivning" kræver ægte skrivearbejde.
  bode: {
    mostCount: 'Hvem har fået flest bøder i denne bødekasse?',
    fewestCount: 'Hvem har fået færrest bøder i denne bødekasse?',
    totalCount: 'Hvor mange bøder er der registreret i alt i denne bødekasse?',
    longestStreak: 'Hvem har den længste aktuelle streak uden en bøde?',
    quoteWho: quote => `Ifølge Bødekassen fik nogen en bøde for: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilket af disse fik ${name} en bøde for?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne bødekasse?',
  },
  venne: {
    mostCount: 'Hvem har brokket sig flest gange i denne vennekasse?',
    fewestCount: 'Hvem har brokket sig færrest gange i denne vennekasse?',
    totalCount: 'Hvor mange brok er der registreret i alt i denne vennekasse?',
    longestStreak: 'Hvem har den længste aktuelle streak uden brok?',
    quoteWho: quote => `Ifølge Vennekassen brokkede nogen sig over: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilket af disse ting brokkede ${name} sig over?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne vennekasse?',
  },
  rose: {
    mostCount: 'Hvem har rost flest gange i denne rosekasse?',
    fewestCount: 'Hvem har rost færrest gange i denne rosekasse?',
    totalCount: 'Hvor mange roser er der registreret i alt i denne rosekasse?',
    longestStreak: 'Hvem har den længste aktuelle ros-streak?',
    quoteWho: quote => `Ifølge Rosekassen roste nogen: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilken ros gav ${name}?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne rosekasse?',
  },
  drik: {
    mostCount: 'Hvem har brokket sig flest gange i denne drikkekasse?',
    fewestCount: 'Hvem har brokket sig færrest gange i denne drikkekasse?',
    totalCount: 'Hvor mange brok er der registreret i alt i denne drikkekasse?',
    longestStreak: 'Hvem har den længste aktuelle streak uden brok?',
    quoteWho: quote => `Ifølge Drikkekassen brokkede nogen sig over: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilket af disse ting brokkede ${name} sig over?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne drikkekasse?',
  },
  konkurrence: {
    mostCount: 'Hvem fører flest gange i denne konkurrencekasse?',
    fewestCount: 'Hvem fører færrest gange i denne konkurrencekasse?',
    totalCount: 'Hvor mange sejre er der registreret i alt i denne konkurrencekasse?',
    longestStreak: 'Hvem har den længste aktuelle sejrsstreak?',
    quoteWho: quote => `Ifølge Konkurrencekassen vandt nogen på: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilken sejr stod ${name} bag?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne konkurrencekasse?',
  },
  sladre: {
    mostCount: 'Hvem har sladret mest i denne sladrekasse?',
    fewestCount: 'Hvem har sladret mindst i denne sladrekasse?',
    totalCount: 'Hvor mange sladderhistorier er der registreret i alt i denne sladrekasse?',
    longestStreak: 'Hvem har den længste aktuelle streak uden at sladre?',
    quoteWho: quote => `Ifølge Sladrekassen sladrede nogen om: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilken sladderhistorie stod ${name} bag?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne sladrekasse?',
  },
  // logn/hjaelper: 'spil' er ikke aktiveret i SKIN_PRESETS.allowedGames i
  // dag, men getQuestionTemplates faldt (ligesom CONTENT_BY_THEME) tidligere
  // stille tilbage til brok's "brokkekasse"-grammatik hvis noget nogensinde
  // kaldte den for disse to temaer — bekræftet som et REELT nåbart hul
  // (ikke kun teoretisk), da et direkte API-kald til 'start' IKKE tjekker
  // gameEnabled server-side (kun klientens UI skjuler fanen).
  logn: {
    mostCount: 'Hvem er blevet afsløret i flest løgne i denne løgnekasse?',
    fewestCount: 'Hvem er blevet afsløret i færrest løgne i denne løgnekasse?',
    totalCount: 'Hvor mange løgne er der registreret i alt i denne løgnekasse?',
    longestStreak: 'Hvem har den længste aktuelle streak uden en afsløret løgn?',
    quoteWho: quote => `Ifølge Løgnekassen blev nogen afsløret i en løgn om: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilken løgn blev ${name} afsløret i?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne løgnekasse?',
  },
  hjaelper: {
    mostCount: 'Hvem har flest noterede fejl i denne kollegakasse?',
    fewestCount: 'Hvem har færrest noterede fejl i denne kollegakasse?',
    totalCount: 'Hvor mange fejl er der noteret i alt i denne kollegakasse?',
    longestStreak: 'Hvem har den længste aktuelle streak uden en noteret fejl?',
    quoteWho: quote => `Ifølge Kollegakassen blev der noteret en fejl om: "${quote}" — hvem var det?`,
    quoteWhich: name => `Hvilken fejl blev noteret for ${name}?`,
    memberCountFallback: 'Hvor mange medlemmer er der i denne kollegakasse?',
  },
};
function getQuestionTemplates(themeId) {
  return QUESTION_TEMPLATES_BY_THEME[themeId] || QUESTION_TEMPLATES_BY_THEME.brok;
}

// Genererer et multiple-choice trivia-spørgsmål ud fra rummets EGNE rigtige
// brok-data — binder spillet sammen med selve Brokkekassen.
function generateTriviaQuestion(state) {
  const t = getQuestionTemplates(state.themeId);
  const members = state.members;
  const allEvents = [...state.events, ...state.history.flatMap(r => r.events || [])].filter(e => !e.free && !e.voided);
  const counts = {};
  members.forEach(m => (counts[m.id] = 0));
  allEvents.forEach(e => { if (counts[e.memberId] !== undefined) counts[e.memberId]++; });
  const totalCount = allEvents.length;

  const candidates = [];

  if (totalCount > 0 && members.length >= 2) {
    const mostId = members.slice().sort((a, b) => counts[b.id] - counts[a.id])[0].id;
    candidates.push(() => {
      const correct = members.find(m => m.id === mostId).name;
      const distractors = members.filter(m => m.id !== mostId).map(m => m.name);
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: t.mostCount, options, correctIndex };
    });
    const fewestId = members.slice().sort((a, b) => counts[a.id] - counts[b.id])[0].id;
    candidates.push(() => {
      const correct = members.find(m => m.id === fewestId).name;
      const distractors = members.filter(m => m.id !== fewestId).map(m => m.name);
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: t.fewestCount, options, correctIndex };
    });
    candidates.push(() => {
      const correct = String(totalCount);
      const distractors = [...new Set([totalCount + 2, Math.max(0, totalCount - 2), totalCount + 5].map(String))];
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: t.totalCount, options, correctIndex };
    });
  }

  const streakEntries = Object.entries(state.streaks || {}).filter(([id]) => members.find(m => m.id === id));
  if (streakEntries.length && members.length >= 2) {
    const [topId] = streakEntries.slice().sort((a, b) => b[1] - a[1])[0];
    const topMember = members.find(m => m.id === topId);
    if (topMember) {
      candidates.push(() => {
        const distractors = members.filter(m => m.id !== topId).map(m => m.name);
        const { options, correctIndex } = buildOptions(topMember.name, distractors);
        return { question: t.longestStreak, options, correctIndex };
      });
    }
  }

  // "Hvem blev det brokket over?" og den omvendte variant — bruger ÆGTE
  // tidligere loggede brok som spørgsmål i stedet for kun optalte
  // statistikker. Bevidst IKKE "hvem sagde/skrev det" — memberId er den der
  // blev ANKLAGET (se accuse-handleren i brok.js), ikke nødvendigvis den der
  // selv tastede anklagen ind i appen, så "brokkede sig over" er den eneste
  // framing der stemmer overens med hvad data faktisk betyder. Vælges
  // TILFÆLDIGT blandt alle rigtige brok hver gang (ikke altid "flest/
  // færrest"), så det jævner sig ud hvem der bliver spurgt om over mange
  // runder, i stedet for altid samme person.
  //
  // FUNDET FEJL (rettet her, se planens "MrBrok/Det Store Brokkeri-audit"):
  // gameLoss-hændelser (fx "Tabte MrBrok") har en message og blev tidligere
  // regnet med i citat-puljen, så et spørgsmål kunne citere en systembesked
  // som var det en rigtig anklage. Ekskluderet her (kun fra CITAT-puljen —
  // tælles stadig korrekt med i counts/totalCount ovenfor, hvor
  // straf-mekanikken hører hjemme).
  const brokEvents = allEvents.filter(e => e.message && e.message.trim() && !e.gameLoss && members.find(m => m.id === e.memberId));
  if (brokEvents.length && members.length >= 3) {
    candidates.push(() => {
      const ev = pickRandom(brokEvents);
      const correct = members.find(m => m.id === ev.memberId);
      const distractors = shuffle(members.filter(m => m.id !== ev.memberId)).slice(0, 3).map(m => m.name);
      const { options, correctIndex } = buildOptions(correct.name, distractors);
      return { question: t.quoteWho(ev.message), options, correctIndex };
    });
    // Kun med hvis der reelt findes nok ANDRE forskellige brok-tekster at
    // bruge som decoys — ellers ville spørgsmålet ikke kunne stilles fair.
    const viableTargets = members.filter(m => {
      const own = brokEvents.filter(e => e.memberId === m.id);
      if (!own.length) return false;
      const otherTexts = new Set(brokEvents.filter(e => e.memberId !== m.id).map(e => e.message));
      return otherTexts.size >= 3;
    });
    if (viableTargets.length) {
      candidates.push(() => {
        const target = pickRandom(viableTargets);
        const correct = pickRandom(brokEvents.filter(e => e.memberId === target.id)).message;
        const otherTexts = [...new Set(brokEvents.filter(e => e.memberId !== target.id).map(e => e.message))];
        const distractors = shuffle(otherTexts).slice(0, 3);
        const { options, correctIndex } = buildOptions(correct, distractors);
        return { question: t.quoteWhich(target.name), options, correctIndex };
      });
    }
  }

  // FUND (quizmaster-audit): i et helt nyt/koldt rum (0 rigtige events) er
  // `candidates` ALTID tom, uanset skin — inklusive Brokkekassen selv,
  // testet direkte: 200/200 trivia-spørgsmål i et koldt rum blev den
  // blanke "hvor mange medlemmer er der"-fallback, for alle 9 skins.
  // Forskellen mellem skins i praksis er IKKE koden her, men hvor hurtigt
  // hver skins rigtige udløser (se THEME_COPY/smaatText) fylder rummet med
  // rigtige events — men koden selv beskyttede ikke imod den kolde
  // periode for NOGEN skin, heller ikke referencen. Rettet ved at falde
  // tilbage til den kuraterede, skin-farvede verdens-trivia-pulje (samme
  // pulje `beginRound` selv bruger 35% af tiden, ALTID ≥20 valideret
  // indhold pr. skin, se scripts/validate-trivia.js) i stedet for en
  // indholdsløs optælling — så et koldt rum føles skin-relevant fra
  // allerførste spil, uanset hvor sjældent den skins egen kasse-knap
  // trykkes i virkeligheden.
  if (!candidates.length) {
    return pickWorldTrivia(state);
  }
  return pickRandom(candidates)();
}

// Vælger hvem der skal skrive næste udsagn/brok: vægtet tilfældigt efter
// hvor mange gange man har gjort DEN SPECIFIKKE rundetype før — færre
// gange giver højere chance, men man kan sagtens rammes to gange i træk
// (bare ikke ofte over mange runder). Sandt/falsk og "hvilket brok"-runden
// har hver sin tæller, så begge rundetyper hver især fordeler skrive-
// byrden ligeligt, i stedet for at én person kan ende med at skrive alt
// sandt/falsk mens en anden altid får guessbrok-runderne. Gemt på RUM-
// niveau (samme sted som resten af indholds-rotationen), IKKE på selve
// spillet — en tæller der nulstilles ved hvert nyt spil ville kun give fair
// fordeling INDEN FOR én omgang, ikke på tværs af flere spil samme aften.
function pickAuthor(state, players, bankKey) {
  if (!state.gameContentBank) state.gameContentBank = {};
  const key = bankKey || 'authorPickCounts';
  if (!state.gameContentBank[key]) state.gameContentBank[key] = {};
  const counts = state.gameContentBank[key];
  const author = pickWeighted(players, counts);
  counts[author.id] = (counts[author.id] || 0) + 1;
  return author;
}

// Falske, opdigtede "brok"-forslag der blandes ind sammen med forfatterens
// EGET rigtige brok i "Hvilket brok ville {author} sige?"-runden — resten
// skal kunne lyde plausible nok til at snyde, men er ikke om nogen bestemt.
// Holdt bevidst til HVERDAGS-ting (pool, biler, supermarked, restauranter,
// rengøring, trapper, toiletter, børn, larm) frem for ferie-specifikke
// oplevelser — noget som "gondol" er kun genkendeligt hvis man faktisk har
// været i Venedig, og afslører sig selv som opdigtet for alle andre. Det
// skal kunne ramme plausibelt uanset hvor eller hvornår man er.
const DECOY_BROK = [
  'Der var kun ét ledigt toilet, og køen flyttede sig ikke',
  'Aircondition lavede en klikkende lyd hele natten',
  'Der var ingen stikkontakter tæt nok på sengen til at oplade telefonen',
  'Morgenmaden løb tør for det gode lige før jeg nåede frem',
  'Solsengene var "reserveret" med et håndklæde kl. 6 om morgenen',
  'GPS\'en insisterede på en "genvej" der tog dobbelt så lang tid',
  'Der var ingen wifi der hvor jeg faktisk sad',
  'Naboerne spillede musik til langt ud på natten',
  'Isen var smeltet allerede da jeg nåede frem',
  'Restauranten havde "udsolgt" af det eneste jeg ville have',
  'Parkeringspladsen kostede mere end det jeg skulle handle',
  'Der var byggestøj lige udenfor vinduet fra kl. 7 hver morgen',
  'Alle håndklæderne lugtede af klor',
  'Køen i supermarkedet flyttede sig slet ikke',
  'Selvbetjeningskassen ville ikke scanne noget som helst',
  'Der var ingen ledige parkeringspladser nogen steder',
  'Bilen ville ikke starte lige da vi skulle af sted',
  'Der var ikke gjort ordentligt rent på badeværelset',
  'Støvsugeren virkede kun halvdelen af tiden',
  'Elevatoren var i stykker, så det blev trapper hele vejen',
  'Der var alt for mange trapper for at komme derop',
  'Damernes var optaget, og mændenes var beskidt',
  'Børnene skændtes om hvem der skulle sidde forrest',
  'Der var ingen børnestole tilbage på restauranten',
  'Legepladsen var fyldt, der var ingen plads til flere',
  'Der var konstant larm fra vejen udenfor',
  // Korte, hurtigt-skrevne opdigtede forslag — hvis alle de opdigtede altid
  // er længere og mere detaljerede end det RIGTIGE brok (som typisk skrives
  // hurtigt under tidspres i selve runden), bliver længden i sig selv et
  // spor der afslører hvilket der er ægte. Blandet ind med de længere
  // ovenfor, så det ikke er en fast regel man kan regne ud.
  'Håndklæderne var våde igen',
  'Isen var smeltet allerede',
  'Wifi\'en droppede hele aftenen',
  'Der var myg overalt ved bordet',
  'Solcremen klistrede i håret',
  'Bussen kom aldrig',
  'Poolen var lukket uden varsel',
  'Der var ingen håndklæder tilbage',
  'Nøglekortet virkede ikke',
  'Middagen var kold da den kom',
  'Parasollen væltede i vinden',
  'Der manglede sæbe på badet',
  'Køen i supermarkedet var uendelig',
  'Ingen ledige borde noget sted',
  'Trappen var spærret af igen',
];
// Tilføjet efter egen definition, ikke inde i CONTENT_BY_THEME's objekt-
// literal ovenfor — DECOY_BROK er en const der endnu ikke er initialiseret
// på det tidspunkt filen når dertil (temporal dead zone).
CONTENT_BY_THEME.brok.decoyBrok = DECOY_BROK;
CONTENT_BY_THEME.konkurrence.decoyBrok = DECOY_BROK;

// Rigtige, tidligere loggede brok fra selve Brokkekassen (hvis den er i
// brug) blandes ind som decoys sammen med den generiske liste ovenfor —
// de er allerede skrevet i familiens eget sprog og tempo, så de er langt
// sværere at kende fra hinanden end noget udelukkende opdigtet kan være.
// Ingen forfatter-tilknytning følger med — kun selve teksten genbruges.
function realEventTexts(state) {
  const fromNow = (state.events || []).filter(e => !e.free && !e.voided);
  const fromHistory = (state.history || []).flatMap(h => h.events || []).filter(e => !e.free && !e.voided);
  return [...fromNow, ...fromHistory]
    .map(e => (e.message || '').trim())
    .filter(t => t && t.length <= 120);
}

function pickDecoyBroks(state, n, excludeText) {
  const decoyBrok = getThemeContent(state.themeId).decoyBrok;
  const pool = [...new Set([...realEventTexts(state), ...decoyBrok])].filter(t => t !== excludeText);
  const shuffled = shuffle(pool.length ? pool : decoyBrok);
  const picked = shuffled.slice(0, n);
  // Sikkerhedsnet for et helt nyt/tomt rum uden ret meget historik endnu —
  // fylder op fra den generiske liste hvis puljen var for lille til at
  // give `n` unikke forslag.
  while (picked.length < n) picked.push(decoyBrok[Math.floor(Math.random() * decoyBrok.length)]);
  return picked;
}

// Tilfældig tildeling af "hvem roser hvem" til Rose-runden — en permutation
// uden faste punkter (ingen får sig selv), så hver spiller BÅDE skriver
// præcis én ros OG modtager præcis én, uden ekstra bogføring. Ved uheld
// (fx 50/50 ved kun 2 spillere) prøves der igen et par gange, og falder det
// stadig ikke på plads roteres listen ét hak — det er ALTID en gyldig
// afledning uden faste punkter for 2+ spillere.
function buildRoseDerangement(ids) {
  if (ids.length < 2) return {};
  let perm;
  let tries = 0;
  do {
    perm = shuffle(ids.slice());
    tries++;
  } while (ids.some((id, i) => perm[i] === id) && tries < 50);
  if (ids.some((id, i) => perm[i] === id)) perm = ids.slice(1).concat(ids.slice(0, 1));
  const map = {};
  ids.forEach((id, i) => { map[id] = perm[i]; });
  return map;
}

// Sætter indholdet af en ny runde op — vælger tilfældigt mellem
// rundetyperne og bygger den nødvendige startdata for hver. `players` er de
// medlemmer der reelt er med i DENNE runde af spillet (kan være en delmængde
// af hele rummet) — trivia-spørgsmål handler stadig om hele rummets rigtige
// brok-historik, uanset hvem der spiller med lige nu.
const ROUND_TYPES = ['quiplash', 'truefalse', 'trivia', 'guessbrok', 'casinobrok', 'rose'];

// Casinobrok (hjul) og rose er rene "held/fyld"-runder uden reelt
// færdigheds- eller vote-element — begrænses til HØJST ÉN gang pr. HELE
// spillet (ikke bare pr. 6-cyklus som resten), så et langt spil på 8/12
// runder ikke viser den samme hjul-tur to gange. Quiplash er bevidst IKKE
// med her, selvom den nogle gange (uafgjort/2 spillere) også lander i
// Chancen — resten af tiden er den en rigtig afstemningsrunde, ikke ren
// tilfældighed, så den skal stadig kunne gentages på tværs af cyklusser.
const ONCE_PER_GAME_TYPES = ['casinobrok', 'rose'];

function beginRound(state, players) {
  state.game.round += 1;
  const playerIds = players.map(m => m.id);
  // Rundetypen trækkes fra en shuffle bag der nulstilles PR SPIL (gemt på
  // state.game, ikke på rummet) — sikrer at alle 6 typer er set mindst én
  // gang før nogen af dem gentages INDEN FOR samme spil. Den gamle
  // rum-niveau-bag (pickFromBag) garanterede kun ingen gentagelse på tværs
  // af ALLE spil samlet, hvilket sagtens kunne betyde 2x samme (fx
  // casinobrok+rose, "hæld"-tunge runder) og 0x trivia inden for ét enkelt
  // spil — mere end halvdelen af runderne blev ren tilfældighed uden nogen
  // rigtig quiz-runde overhovedet.
  if (!state.game.roundTypeBag || !state.game.roundTypeBag.length) {
    const lastType = state.game.current && state.game.current.type;
    if (!state.game.usedOnceTypes) state.game.usedOnceTypes = [];
    const pool = ROUND_TYPES.filter(t => !state.game.usedOnceTypes.includes(t));
    const bag = shuffle(pool.slice());
    // pop() trækker fra ENDEN af arrayet — så bag[bag.length-1] er den
    // NÆSTE der bliver trukket. Uden dette tjek kunne en frisk pose (8+
    // runder, ny cyklus efter alle 6 er brugt) tilfældigvis starte med
    // PRÆCIS samme type som lige blev spillet — en synlig gentagelse i
    // gentagelse, selvom det teknisk set er to uafhængige cyklusser.
    if (lastType && bag.length > 1 && bag[bag.length - 1] === lastType) {
      const swapIdx = bag.findIndex((t, idx) => idx !== bag.length - 1 && t !== lastType);
      if (swapIdx !== -1) {
        const tmp = bag[bag.length - 1];
        bag[bag.length - 1] = bag[swapIdx];
        bag[swapIdx] = tmp;
      }
    }
    // Trivia er den ENESTE rene skills-runde (resten er held/kreativitet) —
    // den skal komme TIDLIGT i cyklussen (blandt de 3 første trukne), ikke
    // bare "et sted blandt de 6". Ellers kan et kort spil, eller ét der
    // afsluttes før alle 8/12 runder er spillet, sagtens aldrig nå at vise
    // den, selvom den reelt lå i posen — hvilket var præcis klagen.
    const earlySlotStart = Math.max(0, bag.length - 3);
    const triviaIdx = bag.indexOf('trivia');
    if (triviaIdx !== -1 && triviaIdx < earlySlotStart) {
      const targetIdx = earlySlotStart + Math.floor(Math.random() * (bag.length - earlySlotStart));
      const tmp = bag[triviaIdx];
      bag[triviaIdx] = bag[targetIdx];
      bag[targetIdx] = tmp;
    }
    state.game.roundTypeBag = bag;
  }
  const type = state.game.roundTypeBag.pop();
  if (ONCE_PER_GAME_TYPES.includes(type) && !state.game.usedOnceTypes.includes(type)) {
    state.game.usedOnceTypes.push(type);
  }
  if (type === 'quiplash') {
    // Ved præcis 2 spillere er der ingen rigtig afstemning (se
    // resolveQuiplashRandom) — runden ender ALTID i Chancen, så prompten er
    // et generisk sejrs-hån i stedet for et roast af et tilfældigt trukket
    // emne. {target} indsættes klient-side (se index.html), ikke her.
    if (players.length === 2) {
      state.game.current = { type, phase: 'answer', prompt: pickWinnerTauntPrompt(state), targetId: null, isWinnerTaunt: true, answers: {} };
    } else {
      const { prompt, targetId } = pickQuiplashPrompt(state, players);
      state.game.current = { type, phase: 'answer', prompt, targetId, answers: {} };
    }
  } else if (type === 'truefalse') {
    // Ved kun 2 spillere falder byrden med at digte et frisk udsagn HVER
    // eneste gang på den samme ene person igen og igen (der er jo kun de 2
    // at vælge forfatter blandt) — så her trækkes et neutralt, forudskrevet
    // "verdens-brok"-udsagn oftere ind som afveksling, ligesom world-trivia
    // gør for quizzen. Ved 3+ spillere holdes det lavere, så det stadig
    // mest handler om jeres egne (mere personlige) påstande om hinanden.
    const worldChance = players.length <= 2 ? 0.45 : 0.2;
    // Ca. hver 4. sandt/falsk-runde (ved 3+ spillere) genbruges i stedet et
    // udsagn fra et TIDLIGERE spil (ikke fra denne runde af spillet selv) —
    // content skal ikke gå til spilde, og det er sjovt at blive mindet om
    // gamle påstande, uden at det bliver et selv-citat midt i spillet. Det
    // mindst for nylig genbrugte udsagn vælges først, så et enkelt ikke
    // bliver ved med at dukke op igen og igen — brugte ting ryger bagerst i køen.
    const bank = (state.gameContentBank && state.gameContentBank.truefalse) || [];
    const reusable = bank.filter(e => playerIds.includes(e.targetId) && e.ts < state.game.startedAt);
    if (Math.random() < worldChance) {
      const w = pickWorldTrueFalse(state);
      state.game.current = { type, phase: 'guess', authorId: null, targetId: null, statement: w.statement, isTrue: w.isTrue, guesses: {}, isWorld: true };
    } else if (reusable.length && Math.random() < 0.25) {
      const old = reusable.slice().sort((a, b) => (a.lastUsedTs || 0) - (b.lastUsedTs || 0))[0];
      old.lastUsedTs = Date.now();
      state.game.current = { type, phase: 'guess', authorId: old.authorId, targetId: old.targetId, statement: old.statement, isTrue: old.isTrue, guesses: {}, reused: true };
    } else {
      const author = pickAuthor(state, players);
      state.game.current = { type, phase: 'write', authorId: author.id, targetId: null, statement: null, isTrue: null, guesses: {} };
    }
  } else if (type === 'trivia') {
    // Ca. hver 3. trivia-runde er ægte real-world brok-trivia i stedet for
    // spørgsmål om rummets egne data — særlig kærkomment i et frisk rum
    // uden meget historik endnu.
    const q = Math.random() < 0.35 ? pickWorldTrivia(state) : generateTriviaQuestion(state);
    state.game.current = { type, phase: 'answer', ...q, choices: {} };
  } else if (type === 'guessbrok') {
    // "Hvilket brok ville {author} sige?" — forfatteren skriver ét RIGTIGT
    // brok, som blandes sammen med 3 opdigtede forslag. Resten gætter hvilket
    // af de 4 der er det ægte. Fungerer lige så godt med kun 2 spillere som
    // med mange, fordi de 3 "modstandere" altid er opdigtede tekster, ikke
    // andre spillere — så det er en ekstra rundetype der giver variation
    // uden at kræve et vist antal spillere.
    const author = pickAuthor(state, players, 'guessBrokAuthorPickCounts');
    state.game.current = { type, phase: 'write', authorId: author.id, statement: null, options: null, correctIndex: null, guesses: {} };
  } else if (type === 'casinobrok') {
    // "Casinobrok" — chanceVisual afgøres HER (server-side, én gang), ikke
    // klient-side — ellers ville forskellige spilleres skærme kunne vise
    // FORSKELLIGE visninger af samme runde. Delt pulje/begrænsning med
    // quiplashs egen Chancen-brug (se pickChanceVisual +
    // resolveQuiplashVote/Random i gameFlow.js) — hver visning (muldvarp/
    // hjul/spillemaskine) højst én gang pr. spil, uanset hvilken rundetype
    // der udløser den.
    const chanceVisual = pickChanceVisual(state);
    if (chanceVisual === 'slot') {
      // Ren spillemaskine-bonusrunde: at skrive et ord først gav ingen
      // mening til et rent chance-træk (se resolveCasinobrokBet i
      // gameFlow.js) — hver spiller vælger i stedet direkte mellem en
      // sikker, lille gevinst og en rigtig satsning med reel tabsrisiko.
      state.game.current = { type, phase: 'bet', chanceVisual, bets: {} };
    } else {
      // Hjul/muldvarp — ALLE spillere skriver hvert sit ene brok-ord (ikke
      // en hel sætning), og der trækkes bagefter lod blandt de indsendte
      // ord. Vinderen er den der skrev det trukne ord — flere spillere kan
      // sagtens skrive samme ord, hver indsendelse er sit eget lod uanset
      // tekst, så det er reelt en tilfældig person der vindes over, bare
      // camoufleret som et ord-lod i stedet for en direkte navnetrækning.
      state.game.current = { type, phase: 'write', words: {}, chanceVisual };
    }
  } else {
    // "Rose" — ikke alt skal handle om brok. Hver spiller skriver en ægte,
    // kort ros til én tilfældigt tildelt medspiller (aldrig sig selv), og
    // bagefter skal alle gætte hvem der skrev hvad om hvem — se
    // transitionRoseToMatch/resolveRoseMatch i gameFlow.js.
    const targets = buildRoseDerangement(playerIds);
    state.game.current = { type, phase: 'write', targets, compliments: {}, guesses: {} };
  }
}

module.exports = { pickRandom, shuffle, pickWeighted, buildOptions, pickFromBag, pickQuiplashPrompt, pickWinnerTauntPrompt, pickChanceVisual, pickWorldTrivia, pickWorldTrueFalse, pickDecoyBroks, pickQuiplashDecoys, generateTriviaQuestion, buildRoseDerangement, beginRound, CONTENT_BY_THEME, getThemeContent, QUESTION_TEMPLATES_BY_THEME, getQuestionTemplates };
