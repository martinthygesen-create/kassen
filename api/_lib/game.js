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
  const idx = pickFromBag(state, 'winnerTaunt', WINNER_TAUNT_PROMPTS.length);
  return WINNER_TAUNT_PROMPTS[idx];
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
  const picked = [];
  for (let i = 0; i < n; i++) {
    const idx = pickFromBag(state, 'quiplashDecoy', QUIPLASH_DECOYS.length);
    picked.push(QUIPLASH_DECOYS[idx]);
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
  const idx = pickFromBag(state, 'quiplash', QUIPLASH_PROMPTS.length);
  return { prompt: QUIPLASH_PROMPTS[idx].replace(/\{target\}/g, target.name), targetId: target.id };
}

function pickWorldTrivia(state) {
  const idx = pickFromBag(state, 'world', WORLD_TRIVIA.length);
  const item = WORLD_TRIVIA[idx];
  return { question: item.question, isWorld: true, ...buildOptions(item.correct, item.distractors) };
}

function pickWorldTrueFalse(state) {
  const idx = pickFromBag(state, 'worldTruefalse', WORLD_TRUEFALSE.length);
  const item = WORLD_TRUEFALSE[idx];
  return { statement: item.statement, isTrue: item.isTrue, isWorld: true };
}

// Genererer et multiple-choice trivia-spørgsmål ud fra rummets EGNE rigtige
// brok-data — binder spillet sammen med selve Brokkekassen.
function generateTriviaQuestion(state) {
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
      return { question: 'Hvem har brokket sig flest gange i denne brokkekasse?', options, correctIndex };
    });
    const fewestId = members.slice().sort((a, b) => counts[a.id] - counts[b.id])[0].id;
    candidates.push(() => {
      const correct = members.find(m => m.id === fewestId).name;
      const distractors = members.filter(m => m.id !== fewestId).map(m => m.name);
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: 'Hvem har brokket sig færrest gange i denne brokkekasse?', options, correctIndex };
    });
    candidates.push(() => {
      const correct = String(totalCount);
      const distractors = [...new Set([totalCount + 2, Math.max(0, totalCount - 2), totalCount + 5].map(String))];
      const { options, correctIndex } = buildOptions(correct, distractors);
      return { question: 'Hvor mange brok er der registreret i alt i denne brokkekasse?', options, correctIndex };
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
        return { question: 'Hvem har den længste aktuelle streak uden brok?', options, correctIndex };
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
  const brokEvents = allEvents.filter(e => e.message && e.message.trim() && members.find(m => m.id === e.memberId));
  if (brokEvents.length && members.length >= 3) {
    candidates.push(() => {
      const ev = pickRandom(brokEvents);
      const correct = members.find(m => m.id === ev.memberId);
      const distractors = shuffle(members.filter(m => m.id !== ev.memberId)).slice(0, 3).map(m => m.name);
      const { options, correctIndex } = buildOptions(correct.name, distractors);
      return { question: `Ifølge Brokkekassen brokkede nogen sig over: "${ev.message}" — hvem var det?`, options, correctIndex };
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
        return { question: `Hvilket af disse ting brokkede ${target.name} sig over?`, options, correctIndex };
      });
    }
  }

  if (!candidates.length) {
    const distractors = [String(members.length + 1), String(Math.max(1, members.length - 1)), String(members.length + 2)];
    const { options, correctIndex } = buildOptions(String(members.length), [...new Set(distractors)]);
    return { question: 'Hvor mange medlemmer er der i denne brokkekasse?', options, correctIndex };
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
  const pool = [...new Set([...realEventTexts(state), ...DECOY_BROK])].filter(t => t !== excludeText);
  const shuffled = shuffle(pool.length ? pool : DECOY_BROK);
  const picked = shuffled.slice(0, n);
  // Sikkerhedsnet for et helt nyt/tomt rum uden ret meget historik endnu —
  // fylder op fra den generiske liste hvis puljen var for lille til at
  // give `n` unikke forslag.
  while (picked.length < n) picked.push(DECOY_BROK[Math.floor(Math.random() * DECOY_BROK.length)]);
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

module.exports = { pickRandom, shuffle, pickWeighted, buildOptions, pickFromBag, pickQuiplashPrompt, pickWinnerTauntPrompt, pickChanceVisual, pickWorldTrivia, pickWorldTrueFalse, pickDecoyBroks, pickQuiplashDecoys, generateTriviaQuestion, buildRoseDerangement, beginRound };
