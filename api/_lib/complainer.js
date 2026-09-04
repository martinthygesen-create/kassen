// Rent INDHOLD til Det Store Brokkeri ("The Big Complainer") — arketyper,
// situationer og prompt-puljen. Selve spil-FLOWET (runder, mistankeafstemning,
// bank/gamble, afsløring, gættefinale) ligger i _lib/complainerFlow.js,
// samme opdeling som MrBrok's mrbrok.js/mrbrokFlow.js og Brokspillets
// game.js/gameFlow.js. Ligger under _lib/ så den IKKE tæller med i Vercels
// 12-serverless-function-loft.
//
// VIGTIGT (se CLAUDE.md's "Planlagt: The Big Complainer"-afsnit): dette er et
// HELT SELVSTÆNDIGT tredje spil, ikke en gren af MrBrok. Denne fil rører
// ALDRIG MRBROK_TOPICS eller andet MrBrok-indhold — egen uafhængig pulje.

const { pickRandom, shuffle } = require('./game');

// Arketyper — hver spiller får hemmeligt tildelt én, som styrer TONEN i
// deres brok (ikke selve emnet, det kommer fra situationen+prompten).
//
// VIGTIGT designvalg (produktejer-feedback, se commit-historikken): en bar
// personligheds-etiket alene ("den udadvendte") er for bredt og abstrakt til
// reelt at kunne spilles eller genkendes — "hvordan skal nogen nogensinde
// gætte det?". Hver arketype er derfor et KONKRET, fusioneret persona
// (erhverv/rolle + en brok-stil), ikke to løse akser — fx "Den
// passiv-aggressive pilot", ikke "pilot" og "passiv-aggressiv" hver for sig.
// Hver arketype bærer desuden 2-3 EKSPLICITTE, konkrete spille-instruktioner
// (ikke bare ét vagt trait-ord) — det er dem der reelt sænker barren for at
// spille rollen sjovt med det samme, jf. produktejerens egen begrundelse:
// alt skal hinte mod rollen, men instruktioner om SELVE BROK-STILEN gør det
// nemt at gå i gang uden yderligere forberedelse. ~10 stykker, med bredt
// forskellige erhverv/personaer OG forskellig underliggende brok-stil på
// tværs af puljen — ikke bare 10 gensyn med samme 4 stilarter.
//
// `promptHook`: kort (≤12 ord) persona-indramning der sættes FORAN selve den
// situationelle prompt (se composePromptText nedenfor), så prompten reelt
// ekkoer HVEM man er, ikke kun HVORDAN man skal levere den. Bevidst IKKE en
// fuld arketype×situation×tier-indholdsmatrix (10×5×3 er for meget nyt
// indhold at skrive/vedligeholde) — samme underliggende COMPLAINER_PROMPTS
// genbruges uændret, kun sammensætningen ved levering er ny. Hver hook
// slutter med en tankestreg, så den situationelle prompt (med sit første
// bogstav sænket til småt, se composePromptText) kan hægtes rimeligt
// grammatisk videre på som ÉN sammenhængende sætning.
const COMPLAINER_ARCHETYPES = [
  {
    id: 'pilot', name: 'Den passiv-aggressive pilot',
    promptHook: 'Som en der er vant til at have styringen i luften —',
    instructions: [
      'Det er altid andres skyld — aldrig dit eget ansvar.',
      'Du er højrøstet og overdriver gerne.',
      'Smil stift mens du siger det værste.',
    ],
  },
  {
    id: 'kok', name: 'Den udadvendte kok',
    promptHook: 'Med hele køkkenets fulde opmærksomhed som vane —',
    instructions: [
      'Du råber det ud med det samme — helt uden filter.',
      'Overdriv følelserne teatralsk, gerne med håndbevægelser.',
      'Du er dybt fornærmet hvis nogen tvivler på din smag.',
    ],
  },
  {
    id: 'nabo', name: 'Den indre-brokkende nabo',
    promptHook: 'Som en der helst holder tingene for sig selv —',
    instructions: [
      'Sig "det er helt fint" — men lad stilheden bagefter tale.',
      'Brug stikpiller og hentydninger i stedet for at sige det ligeud.',
      'Skift emne brat hvis nogen spørger direkte ind til det.',
    ],
  },
  {
    id: 'foraelder', name: 'Den martyr-agtige forælder',
    promptHook: 'Som en der altid stiller sig selv sidst —',
    instructions: [
      'Det er altid dig der ofrer dig — nævn det, ubedt.',
      'Sammenlign med alt det du "kunne" have gjort i stedet.',
      'Afslut med et dybt suk og "det er jo helt fint, jeg klarer det".',
    ],
  },
  {
    id: 'projektleder', name: 'Den passiv-aggressive projektleder',
    promptHook: 'Med et skema der aldrig helt går op —',
    instructions: [
      'Send indirekte hip via "bare lige en tanke..." — aldrig direkte kritik.',
      'Ros først, stik så kniven ind med et "men".',
      'Brug ordet "interessant" som skjult kritik.',
    ],
  },
  {
    id: 'laerer', name: 'Den udadvendte lærer',
    promptHook: 'Som en der er vant til at få hele lokalets opmærksomhed —',
    instructions: [
      'Du taler højt og bruger hele kroppen når du brokker dig.',
      'Inddrag "os alle sammen" i din vrede, som en fælles sag.',
      'Du elsker en god pointe og gentager den gerne tre gange.',
    ],
  },
  {
    id: 'fitness', name: 'Den martyr-agtige fitnessinstruktør',
    promptHook: 'Som en der altid er der klokken seks for andre —',
    instructions: [
      'Du giver ALT for andre, og ingen forstår hvor hårdt det er.',
      'Nævn hvor tidligt du står op, for andres skyld.',
      'Antyd at ingen ville klare sig uden dig.',
    ],
  },
  {
    id: 'taxachauffoer', name: 'Den indre-brokkende taxachauffør',
    promptHook: 'Som en der ser alt fra bagsædet, men sjældent siger det —',
    instructions: [
      'Mumle det halvt for dig selv i stedet for at sige det direkte.',
      'Brug en tør, underspillet tone — aldrig råb.',
      'Lad en lang pause tale for dig efter en stikpille.',
    ],
  },
  {
    id: 'influencer', name: 'Den passiv-aggressive influencer',
    promptHook: 'Med et smil klar til kameraet, uanset hvad —',
    instructions: [
      'Pak alt ind i positivitet — "helt fint, bare synd at...".',
      'Vær sødt giftig — "haha nej men altså" mens du sviner.',
      'Understreg at "jeg siger det jo bare i kærlighed".',
    ],
  },
  {
    id: 'haandvaerker', name: 'Den udadvendte håndværker',
    promptHook: 'Som en der siger tingene ligeud, håndværker-stil —',
    instructions: [
      'Du brokker dig højt og direkte, uden omsvøb.',
      'Brug konkrete, fysiske eksempler — "det tog MIG tre timer at rette".',
      'Du er stolt af at sige tingene ligeud — "nogen må jo sige det".',
    ],
  },
];

// De "everyday"-situationer alle spillere trækkes tilfældigt mellem — styrer
// hvilken kategori af prompts man får tilbudt.
const COMPLAINER_SITUATIONS = ['chef', 'nabo', 'familie', 'kollega', 'ven'];

// Prompt-puljen. `category` matcher enten en af COMPLAINER_SITUATIONS
// (situations-specifik) eller 'relational' (kan bruges af alle uanset
// situation — de "relationelle vinkel"-spørgsmål fra konceptet, der skaber
// en lille ironisk dobbeltlags-karakter: en brokker der ikke selv ser sin
// egen rolle i andres brok). `tier` 1-3 styrer eskalering hen over runderne
// (1 = bred åbner, 3 = skarp/personlig).
//
// SCENARIE-SKABELON (produktejer-rettelse — de oprindelige bare-spørgsmål
// var for abstrakte til at give noget konkret at spille på): hver prompt er
// nu EN LILLE SCENE, ikke bare et spørgsmål, bygget af fire faste dele —
// (a) en konkret UDLØSENDE HÆNDELSE, (b) en PERSONLIG GRUND til at det
// stikker ekstra (træthed, skam, gammel konflikt...), (c) et SPECIFIKT —
// ofte lidt ironisk-forkert — PUBLIKUM at brokke sig til (en der intet har
// med sagen at gøre, eller ligefrem burde være den sidste man sagde det
// til), og (d) selve spørgsmålet ("Hvad siger du?"). Samme struktur som
// produktejerens eget eksempel: "Dine børn ringer og vil ha' penge til is.
// Du har ikke selv fået is længe, og det pisser dig af. Du brokker dig til
// en kollega uden børn — hvad siger du?" — se rel1 nedenfor, som ER det
// eksempel. Bevidst IKKE vandede/vage formuleringer — max saft, alle
// brokker sig hårdt i karakter.
const COMPLAINER_PROMPTS = [
  // --- chef ---
  { id: 'chef1', category: 'chef', tier: 1, text: 'Din chef beder dig blive en time ekstra fredag eftermiddag — igen. Du brokker dig til rengøringsassistenten, som er ved at låse af og bare vil hjem. Hvad siger du?' },
  { id: 'chef2', category: 'chef', tier: 2, text: 'Din chef roser dig for et projekt, du selv ved du kludrede i det meste af. Du brokker dig til din partner om det bagefter, som bare spurgte hvordan dagen gik. Hvad siger du?' },
  { id: 'chef3', category: 'chef', tier: 3, text: 'Din chef har lige givet en kollega den forfremmelse, du selv har knoklet for i to år. Du brokker dig til din bedste ven over telefonen, som egentlig ringede om noget helt andet. Hvad siger du?' },
  { id: 'chef4', category: 'chef', tier: 3, text: 'Din chef beder dig "lige" tage endnu et møde klokken 16 en fredag. Du brokker dig til naboen over hækken, som slet ikke aner hvad du overhovedet laver til daglig. Hvad siger du?' },
  // --- nabo ---
  { id: 'nabo1', category: 'nabo', tier: 1, text: 'Din nabo har igen parkeret foran din indkørsel. Du brokker dig til postbuddet, som lige er kommet forbi med en pakke og bare vil videre. Hvad siger du?' },
  { id: 'nabo2', category: 'nabo', tier: 2, text: 'Din nabo klipper græsplænen klokken syv en søndag morgen. Du brokker dig til din partner, som stadig prøver at sove videre ved siden af dig. Hvad siger du?' },
  { id: 'nabo3', category: 'nabo', tier: 3, text: 'Din nabo har klaget over din hæk til grundejerforeningen — bag din ryg. Du brokker dig til en fælles bekendt, som er gode venner med jer begge. Hvad siger du?' },
  // --- familie ---
  { id: 'familie1', category: 'familie', tier: 1, text: 'Din svigermor ringer for tredje gang denne uge med et "lille" råd om opdragelsen. Du brokker dig til en kollega, som ikke selv har børn. Hvad siger du?' },
  { id: 'familie2', category: 'familie', tier: 2, text: 'Din bror glemmer, igen, din fødselsdag — men husker alle andres. Du brokker dig til din mor, som altid ender med at tage hans parti. Hvad siger du?' },
  { id: 'familie3', category: 'familie', tier: 3, text: 'Dine forældre blander sig i, hvor I skal holde jul, for tredje år i træk. Du brokker dig til din svoger, som du ellers aldrig taler privat med. Hvad siger du?' },
  // --- kollega ---
  { id: 'kollega1', category: 'kollega', tier: 1, text: 'En kollega tager æren for din idé på mødet, mens du sidder lige ved siden af. Du brokker dig til receptionisten, som knap nok kender dig. Hvad siger du?' },
  { id: 'kollega2', category: 'kollega', tier: 2, text: 'En kollega "glemmer" igen at invitere dig med til frokost. Du brokker dig til den nye praktikant, som lige er startet og ikke aner hvem der er hvem. Hvad siger du?' },
  { id: 'kollega3', category: 'kollega', tier: 3, text: 'En kollega har brugt din research uden at nævne dig i rapporten til direktøren. Du brokker dig til HR, som egentlig bare spurgte hvordan du havde det. Hvad siger du?' },
  // --- ven ---
  { id: 'ven1', category: 'ven', tier: 1, text: 'Din bedste ven aflyser jeres aftale for tredje gang i træk — igen i sidste øjeblik. Du brokker dig til en kollega, som aldrig har mødt vedkommende. Hvad siger du?' },
  { id: 'ven2', category: 'ven', tier: 2, text: 'En ven låner penge af dig og "glemmer" det hver eneste gang, det bliver nævnt. Du brokker dig til din frisør, mens du sidder fastspændt i stolen. Hvad siger du?' },
  { id: 'ven3', category: 'ven', tier: 3, text: 'En ven har fortalt din hemmelighed videre til folk, du slet ikke stoler på. Du brokker dig til vennens kæreste, som du normalt aldrig taler alene med. Hvad siger du?' },
  // --- relational (bruges af alle, uanset situation) ---
  { id: 'rel1', category: 'relational', tier: 1, text: 'Dine børn ringer og vil ha\' penge til is. Du har ikke selv fået is længe, og det pisser dig af. Du brokker dig til en kollega uden børn. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 2, text: 'Nogen brokker sig til dig om noget helt banalt, mens du selv står med et rigtigt problem. Du brokker dig videre til din partner om det, bagefter, om hvor lidt folk forstår. Hvad siger du?' },
  { id: 'rel3', category: 'relational', tier: 3, text: 'Du brokker dig ofte over folk der ikke lytter — men din partner peger på, at du selv gjorde præcis det i går. Du brokker dig til din bedste ven over at blive kaldt hyklerisk. Hvad siger du?' },
  { id: 'rel4', category: 'relational', tier: 3, text: 'En du står tæt på ville blive chokeret, hvis de hørte hvad du siger om dem, når de ikke er der. Du brokker dig om netop den person til en fælles ven. Hvad siger du?' },
];

// Kasse-motor-generalisering, Fase 5 (BEVIS-TEMA). Samme håndværks-spec
// som COMPLAINER_ARCHETYPES ovenfor: konkret fusioneret persona (rolle +
// reaktions-stil på at blive taget i et regelbrud), 2-3 eksplicitte
// instruktioner, promptHook der slutter på tankestreg. 8 arketyper (mod
// originalens 10) — BEVIDST en mindre v1-pulje til bevis-formål, ikke den
// endelige tilstræbte størrelse. Udvid FØR levering til rigtige brugere.
const COMPLAINER_ARCHETYPES_BODE = [
  {
    id: 'bortforklarer', name: 'Den bortforklarende holdkaptajn',
    promptHook: 'Som en der altid har en grund klar —',
    instructions: [
      'Du har ALTID en logisk forklaring parat, uanset hvor tynd den er.',
      'Skyld gerne på trafik, vejret eller "systemet".',
      'Bliv let fornærmet hvis nogen tvivler på undskyldningen.',
    ],
  },
  {
    id: 'fornaermet_kasserer', name: 'Den fornærmede kasserer',
    promptHook: 'Som en der tager regnskabet personligt —',
    instructions: [
      'Du opfatter enhver bøde som en anklage mod din karakter.',
      'Sukk tungt og nævn hvor meget arbejde du lægger i det hele.',
      'Vend samtalen til hvor lidt de andre forstår dit ansvar.',
    ],
  },
  {
    id: 'skoedeslos', name: 'Den skødesløse praktikant',
    promptHook: 'Som en der tager det hele med et skuldertræk —',
    instructions: [
      'Du synes reglerne er lidt overdrevne, og siger det gerne højt.',
      'Svar kort og afslappet, som om det er en bagatel.',
      'Foreslå at "det klarer sig nok" i stedet for at love bedring.',
    ],
  },
  {
    id: 'panisk', name: 'Den paniske nybegynder',
    promptHook: 'Som en der er rædselsslagen for at gøre noget forkert —',
    instructions: [
      'Du overdriver hvor forfærdeligt det er, selvom det er småt.',
      'Undskyld gentagne gange, gerne mere end nødvendigt.',
      'Lov højt og tydeligt at det aldrig sker igen.',
    ],
  },
  {
    id: 'beregnende', name: 'Den beregnende veteran',
    promptHook: 'Som en der har regnet på det i årevis —',
    instructions: [
      'Diskuter helt roligt om bøden reelt er "pengene værd".',
      'Sammenlign med tidligere bøder og deres "pris".',
      'Vær mistænkeligt afslappet omkring hele situationen.',
    ],
  },
  {
    id: 'passiv_aggressiv_kollega', name: 'Den passiv-aggressive kollega',
    promptHook: 'Som en der helst antyder frem for at sige det ligeud —',
    instructions: [
      'Brug stikpiller i stedet for at indrømme noget direkte.',
      'Sig "det er helt fint" på en måde der tydeligt betyder det modsatte.',
      'Skift emne brat hvis nogen presser på for et rigtigt svar.',
    ],
  },
  {
    id: 'dobbeltmoralsk_dommer', name: 'Den dobbeltmoralske regelrytter',
    promptHook: 'Som en der ellers ynder at håndhæve reglerne strengt —',
    instructions: [
      'Vær tydeligt flov over at blive taget i det samme du plejer at dømme andre for.',
      'Forsøg at bortforklare hvorfor DIN situation er anderledes.',
      'Lov at være "endnu strengere" fremover for at kompensere.',
    ],
  },
  {
    id: 'optimistisk_eftergiver', name: 'Den evigt optimistiske eftergiver',
    promptHook: 'Som en der altid tror på en bedre fremtid —',
    instructions: [
      'Vær urokkeligt positiv, uanset hvor tit det er sket før.',
      'Lov "helt sikkert næste gang" med overbevisning.',
      'Vend det hele til noget muntert i stedet for en undskyldning.',
    ],
  },
];

// Fase 5 bevis-tema: samme kategori-struktur som brok-situationerne
// (COMPLAINER_SITUATIONS), tilpasset en bøde/regelbrud-kontekst.
const COMPLAINER_SITUATIONS_BODE = ['hold', 'arbejde', 'forening', 'familie'];

// Fase 5 bevis-tema: samme fire-delt scenarie-skabelon som
// COMPLAINER_PROMPTS ovenfor (udløsende hændelse + personlig grund +
// specifikt publikum + spørgsmål) — anvendt på "fik en bøde/blev taget i
// et regelbrud" i stedet for "brokkede sig over noget". 11 prompts (mod
// originalens 19) — BEVIDST en mindre v1-pulje, udvid før rigtig levering.
const COMPLAINER_PROMPTS_BODE = [
  { id: 'hold1', category: 'hold', tier: 1, text: 'Du får en bøde for at komme ti minutter for sent til træning igen. Du brokker dig til en holdkammerat der lige er ankommet til tiden. Hvad siger du?' },
  { id: 'hold2', category: 'hold', tier: 2, text: 'Træneren indfører en ny bøde for glemte sko, efter du selv har glemt dine to gange. Du brokker dig til klubbens materialemand, som bare vil have styr på tingene. Hvad siger du?' },
  { id: 'hold3', category: 'hold', tier: 3, text: 'Holdkaptajnen offentliggør bødelisten i gruppechatten med dit navn øverst. Du brokker dig til din partner, som ikke aner noget om holdets interne regler. Hvad siger du?' },
  { id: 'arbejde1', category: 'arbejde', tier: 1, text: 'Du bliver noteret for at komme for sent til morgenmødet for tredje gang denne måned. Du brokker dig til receptionisten, som lige er mødt selv. Hvad siger du?' },
  { id: 'arbejde2', category: 'arbejde', tier: 2, text: 'Chefen indfører en bøde-kasse for mobiltelefoner der ringer under møder — og din ringer først. Du brokker dig til en kollega fra en helt anden afdeling. Hvad siger du?' },
  { id: 'forening1', category: 'forening', tier: 1, text: 'Du glemmer at betale kontingent til tiden, og kassereren sender en påmindelse til hele bestyrelsen. Du brokker dig til din nabo, som ikke engang er medlem. Hvad siger du?' },
  { id: 'forening2', category: 'forening', tier: 3, text: 'Bestyrelsen vedtager en ny bøde for udeblivelse fra generalforsamlingen — lige efter du selv meldte afbud. Du brokker dig til et helt nyt medlem, som knap nok kender reglerne endnu. Hvad siger du?' },
  { id: 'familie1', category: 'familie', tier: 1, text: 'Du glemmer at hente børnene til tiden, og din partner indfører en "hjemme-bødekasse" på stedet. Du brokker dig til din mor over telefonen. Hvad siger du?' },
  { id: 'rel1', category: 'relational', tier: 1, text: 'Nogen andre får en bøde for præcis det du selv gjorde sidste uge uden konsekvens. Du brokker dig til en helt udenforstående ven om uretfærdigheden. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 2, text: 'Du bliver mindet om en bøde du "glemte" at betale for tre måneder siden. Du brokker dig til din bedste ven om at blive holdt op imod noget så gammelt. Hvad siger du?' },
  { id: 'rel3', category: 'relational', tier: 3, text: 'Du opdager at du selv har foreslået den bøderegel, du nu brokker dig mest over. Du brokker dig til din partner om hvor urimeligt dit eget forslag har vist sig at være. Hvad siger du?' },
];

// Tredje tema, Sladrekassen — navnepreset på Gruppekasse-motoren (se
// KASSEMOTORPLAN.md). 6 arketyper (mod originalens 10) — samme bevidste
// v1-størrelse som Bødekassens pulje. Domæne: sladder/rygter i stedet for
// brok eller regelbrud/undskyldning.
const COMPLAINER_ARCHETYPES_SLADRE = [
  {
    id: 'frisoer', name: 'Den hviskende frisør',
    promptHook: 'Med en kunde i stolen og øre for alt —',
    instructions: [
      'Du sænker stemmen dramatisk før du deler det bedste.',
      'Du lover "det bliver kun mellem os" — og siger det alligevel videre.',
      'Du kræver flere detaljer, jo mere pikante jo bedre.',
    ],
  },
  {
    id: 'nabo_bekymret', name: 'Den bekymrede nabo',
    promptHook: 'Som en der "bare holder øje" af ren omsorg —',
    instructions: [
      'Du indpakker al sladder som bekymring for de andre.',
      'Du nævner "jeg siger det jo kun fordi jeg er bekymret".',
      'Du overdriver hvor tit du "tilfældigt" lægger mærke til ting.',
    ],
  },
  {
    id: 'veninde_fornaermet', name: 'Den fornærmede veninde',
    promptHook: 'Som en der aldrig glemmer en gammel strid —',
    instructions: [
      'Du bringer altid gamle konflikter op som "bare et eksempel".',
      'Du er dybt fornærmet på andres vegne, uopfordret.',
      'Du sukker og siger "jeg vil jo ikke sige noget, men...".',
    ],
  },
  {
    id: 'portner_vidende', name: 'Den vidende portner',
    promptHook: 'Som en der ser alt, men siger det stille —',
    instructions: [
      'Du taler lavmælt, som om væggene lytter.',
      'Du antyder mere end du siger direkte.',
      'Du nyder tydeligt at vide noget, andre ikke ved.',
    ],
  },
  {
    id: 'kollega_snakkesalig', name: 'Den snakkesalige kollega',
    promptHook: 'Som en der aldrig kan holde på noget —',
    instructions: [
      'Du deler det højlydt, uden filter.',
      'Du tilføjer "men sig det ikke videre" — mens du selv gør præcis det.',
      'Du er stolt af altid at vide det først.',
    ],
  },
  {
    id: 'svigermor_mistaenksom', name: 'Den mistænksomme svigermor',
    promptHook: 'Som en der ser skjulte motiver overalt —',
    instructions: [
      'Du antyder at der er "mere i det end man tror".',
      'Du sammenligner med "dengang" for at understrege pointen.',
      'Du er urokkeligt sikker på at have ret, helt uden beviser.',
    ],
  },
];

const COMPLAINER_SITUATIONS_SLADRE = ['ven', 'familie', 'arbejde', 'nabo'];

// Samme fire-delt scenarie-skabelon som COMPLAINER_PROMPTS/_BODE (udløsende
// hændelse + personlig grund + specifikt publikum + spørgsmål), anvendt på
// "hørte/opdagede noget om nogen" i stedet for brok/bøde. 8 prompts (inkl.
// 2 'relational', som er åbne for alle situationer) — samme bevidste
// v1-størrelse som Bødekassens pulje, udvid før rigtig levering.
const COMPLAINER_PROMPTS_SLADRE = [
  { id: 'ven1', category: 'ven', tier: 1, text: 'Du hører at en veninde har sagt noget grimt om dig bag din ryg. Du sladrer om det til en fælles ven, som egentlig bare ville høre om din weekend. Hvad siger du?' },
  { id: 'ven2', category: 'ven', tier: 2, text: 'En ven i vennegruppen har åbenbart datet to personer samtidig. Du sladrer om det til en anden fælles ven, som er tæt med begge parter. Hvad siger du?' },
  { id: 'familie1', category: 'familie', tier: 1, text: 'Din svoger har åbenbart lånt penge af hele familien uden at sige det til nogen. Du sladrer om det til din mor, som elsker den slags historier. Hvad siger du?' },
  { id: 'familie2', category: 'familie', tier: 3, text: 'Du opdager at din bror har løjet om sin nye stilling for hele familien. Du sladrer om det til din kusine, som elsker familiedramaer. Hvad siger du?' },
  { id: 'arbejde1', category: 'arbejde', tier: 2, text: 'Du hører rygter om at en kollega snart bliver fyret. Du sladrer om det til praktikanten, som lige er startet og ikke kender nogen endnu. Hvad siger du?' },
  { id: 'nabo1', category: 'nabo', tier: 1, text: 'Din nabo har åbenbart holdt en hemmelig fest mens de andre var bortrejst. Du sladrer om det til postbuddet, som bare vil aflevere en pakke. Hvad siger du?' },
  { id: 'rel1', category: 'relational', tier: 1, text: 'Nogen sladrer til dig om en hemmelighed, men beder dig love ikke at sige det videre. Du sladrer alligevel til din partner samme aften. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 2, text: 'Du opdager at den du selv sladrer mest til, sladrer videre om dig til andre. Du sladrer om DET til en helt tredje person. Hvad siger du?' },
];

// Løgnerkasse-motoren (se KASSEMOTORPLAN.md's klassifikations-tabel): kun
// Spil 2 (MrBrok)+3 (Det Store Brokkeri) mulige, Brokspillet udelades helt
// (se SKIN_PRESETS' allowedGames client-side). 6 arketyper — domæne: at
// lyve/bortforklare, ikke brokke/undskylde et regelbrud.
const COMPLAINER_ARCHETYPES_LOGN = [
  {
    id: 'sailer_charmerende', name: 'Den charmerende bedrageriske sælger',
    promptHook: 'Med et smil klar til enhver handel —',
    instructions: [
      'Du lyver flydende og uden at blinke.',
      'Du charmerer dig ud af enhver mistanke.',
      'Du skifter historie hvis nogen presser for hårdt.',
    ],
  },
  {
    id: 'nervoes_foerstegang', name: 'Den nervøse førstegangsløgner',
    promptHook: 'Som en der sjældent lyver, og det ses tydeligt —',
    instructions: [
      'Du bliver synligt nervøs og stammer lidt.',
      'Du overforklarer detaljer ingen bad om.',
      'Du skifter emne hurtigt hvis nogen stiller opfølgende spørgsmål.',
    ],
  },
  {
    id: 'dobbeltagent_rutineret', name: 'Den rutinerede dobbeltagent',
    promptHook: 'Som en der har løjet professionelt i årevis —',
    instructions: [
      'Du er fuldstændig rolig og konsistent.',
      'Du husker dine egne løgne perfekt.',
      'Du vender mistanken tilbage på den der spørger.',
    ],
  },
  {
    id: 'teenager_bortforklarende', name: 'Den bortforklarende teenager',
    promptHook: 'Som en der altid har en ny udflugt klar —',
    instructions: [
      'Du skifter historie hvis den første ikke virker.',
      'Du bliver defensiv og fornærmet over at blive tvivlet.',
      'Du involverer en ven som "kan bekræfte det".',
    ],
  },
  {
    id: 'konspirationsteoretiker', name: 'Den overbevisende konspirationsteoretiker',
    promptHook: 'Som en der tror fuldt og fast på sin egen version —',
    instructions: [
      'Du fremlægger løgnen som en indlysende sandhed.',
      'Du henviser til "kilder" ingen kan tjekke.',
      'Du bliver ophidset hvis nogen udfordrer historien.',
    ],
  },
  {
    id: 'pokerspiller_koelig', name: 'Den kølige pokerspiller',
    promptHook: 'Som en der aldrig lader ansigtet afsløre noget —',
    instructions: [
      'Du holder et helt neutralt ansigtsudtryk.',
      'Du svarer kort og undgår overflødige detaljer.',
      'Du lader stilhed arbejde for dig i stedet for at forklare for meget.',
    ],
  },
];

const COMPLAINER_SITUATIONS_LOGN = ['ven', 'familie', 'arbejde', 'fremmed'];

const COMPLAINER_PROMPTS_LOGN = [
  { id: 'ven1', category: 'ven', tier: 1, text: 'Du har løjet om hvorfor du aflyste jeres aftale i sidste øjeblik. Du forklarer dig til en fælles ven, som var der og ved bedre. Hvad siger du?' },
  { id: 'ven2', category: 'ven', tier: 3, text: 'Du har løjet om at kunne lide en vens nye kæreste. Du bliver konfronteret af vennen selv, som fornemmer noget er galt. Hvad siger du?' },
  { id: 'familie1', category: 'familie', tier: 1, text: 'Du har løjet om hvor meget du reelt brugte på gaven til din svigermor. Du forklarer dig til din partner, som så kvitteringen. Hvad siger du?' },
  { id: 'arbejde1', category: 'arbejde', tier: 2, text: 'Du har løjet om at have færdiggjort en opgave, du reelt ikke er startet på. Du forklarer dig til din chef, som lige spurgte til status. Hvad siger du?' },
  { id: 'fremmed1', category: 'fremmed', tier: 1, text: 'Du har løjet om din alder for at slippe billigere ind et sted. Du forklarer dig til en dørmand, som lige har set dit id. Hvad siger du?' },
  { id: 'rel1', category: 'relational', tier: 1, text: 'Du har lige opdaget at en ven løj om noget småt for nylig. Du forklarer nu DIN egen lignende løgn til den samme ven. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 2, text: 'Du bliver mindet om en løgn du fortalte for længe siden, som nu viser sig at være opdaget. Du forklarer dig til den du løj for dengang. Hvad siger du?' },
];

// Godkendelseskasse-motoren (se planens klassifikation: Kollegakassen — kun
// Spil 3 mulig, og KUN i dæmpet form: arketyper er ren arbejdsstil, ALDRIG
// en navngiven reel person som skurk, jf. magt-asymmetrien i et
// ansættelsesforhold). 5 arketyper, situationer uden nogen konkret anklaget
// person nævnt i selve prompten.
const COMPLAINER_ARCHETYPES_HJAELPER = [
  {
    id: 'perfektionist_grundig', name: 'Den grundige perfektionist',
    promptHook: 'Som en der dobbelttjekker alt —',
    instructions: [
      'Du er stille og metodisk i din stil.',
      'Du nævner konkrete detaljer uden at pege på en bestemt person.',
      'Du holder tonen professionel, aldrig anklagende.',
    ],
  },
  {
    id: 'multitasker_travl', name: 'Den travle multitasker',
    promptHook: 'Som en der altid har for mange bolde i luften —',
    instructions: [
      'Du taler hurtigt og lidt stresset.',
      'Du fokuserer på ARBEJDSSTILEN, aldrig en navngiven synder.',
      'Du foreslår en praktisk løsning fremfor at brokke dig.',
    ],
  },
  {
    id: 'observatoer_rolig', name: 'Den rolige observatør',
    promptHook: 'Som en der lægger mærke til mønstre over tid —',
    instructions: [
      'Du taler roligt og reflekteret.',
      'Du beskriver et generelt mønster, ikke en enkelt hændelse.',
      'Du er konstruktiv i din tone.',
    ],
  },
  {
    id: 'ny_i_teamet', name: 'Den nye i teamet',
    promptHook: 'Som en der stadig lærer rutinerne at kende —',
    instructions: [
      'Du er nysgerrig og stiller spørgsmål frem for at anklage.',
      'Du sammenligner med hvordan det blev gjort et andet sted.',
      'Du er ydmyg i din tone.',
    ],
  },
  {
    id: 'rutineret_erfaren', name: 'Den erfarne rutinerede',
    promptHook: 'Som en der har set det meste før —',
    instructions: [
      'Du er tålmodig, men tydelig.',
      'Du refererer til "sådan plejer vi at gøre det".',
      'Du holder fokus på arbejdsgangen, ikke en person.',
    ],
  },
];

const COMPLAINER_SITUATIONS_HJAELPER = ['opgave', 'tid', 'kommunikation'];

const COMPLAINER_PROMPTS_HJAELPER = [
  { id: 'opgave1', category: 'opgave', tier: 1, text: 'En opgave blev leveret uden at følge den aftalte skabelon. Du nævner det over for en kollega fra en anden afdeling, som ikke kender detaljerne. Hvad siger du?' },
  { id: 'opgave2', category: 'opgave', tier: 2, text: 'En tilbagevendende opgave bliver konsekvent løst på en anden måde end aftalt. Du nævner det til en ny kollega, som lige er startet. Hvad siger du?' },
  { id: 'tid1', category: 'tid', tier: 1, text: 'En deadline blev overskredet uden besked i forvejen. Du nævner det til receptionisten, som ikke har noget med sagen at gøre. Hvad siger du?' },
  { id: 'tid2', category: 'tid', tier: 2, text: 'Et møde starter konsekvent for sent. Du nævner det til en ekstern samarbejdspartner, som lige er ankommet til tiden. Hvad siger du?' },
  { id: 'kommunikation1', category: 'kommunikation', tier: 1, text: 'En vigtig besked blev ikke videregivet til resten af teamet. Du nævner det til en praktikant, som ikke var involveret. Hvad siger du?' },
  { id: 'rel1', category: 'relational', tier: 2, text: 'Du bliver selv mindet om en lignende fejl du selv lavede for nylig. Du nævner det alligevel videre til en kollega. Hvad siger du?' },
];

// Vennekassen — 6 arketyper, vennegruppe-specifikke personaer.
const COMPLAINER_ARCHETYPES_VENNE = [
  {
    id: 'venn_for_sent', name: 'Den evigt for sent ankomne ven',
    promptHook: 'Som en der aldrig når det til tiden —',
    instructions: [
      'Du har altid en ny, kreativ undskyldning klar.',
      'Du lover "aldrig igen" hver gang.',
      'Du er charmerende nok til at slippe godt fra det.',
    ],
  },
  {
    id: 'madanmelder_kompromisloes', name: 'Den kompromisløse madanmelder',
    promptHook: 'Som en der altid har en mening om stedet —',
    instructions: [
      'Du er brandret i din kritik af små detaljer.',
      'Du sammenligner med "et bedre sted" du kender.',
      'Du er overrasket hvis nogen er uenig.',
    ],
  },
  {
    id: 'planlaegger_bookende', name: 'Den evigt bookende planlægger',
    promptHook: 'Som en der elsker en detaljeret plan —',
    instructions: [
      'Du bliver stresset hvis planen ændres i sidste øjeblik.',
      'Du sender opdateringer i gruppechatten konstant.',
      'Du er stolt af dit regneark.',
    ],
  },
  {
    id: 'improvisator_afslappet', name: 'Den afslappede improvisator',
    promptHook: 'Som en der aldrig planlægger noget på forhånd —',
    instructions: [
      'Du er uanfægtet af kaos.',
      'Du foreslår altid "vi finder ud af det".',
      'Du er skuffet hvis nogen presser på for en fast plan.',
    ],
  },
  {
    id: 'gruppeleder_nostalgisk', name: 'Den nostalgiske gruppeleder',
    promptHook: 'Som en der altid husker "de gode gamle dage" —',
    instructions: [
      'Du sammenligner alt med "dengang".',
      'Du bliver sentimental uden varsel.',
      'Du insisterer på gamle traditioner.',
    ],
  },
  {
    id: 'vennespiller_konkurrence', name: 'Den konkurrenceprægede vennespiller',
    promptHook: 'Som en der aldrig kan lade være med at vinde —',
    instructions: [
      'Du tager selv et venskabeligt spil alvorligt.',
      'Du fejrer sejre lidt for højlydt.',
      'Du kræver revanche med det samme.',
    ],
  },
  // Quizmaster-audit (indholdsdybde): Vennekassen havde kun 6 arketyper/6
  // prompts mod Bødekassens 8/11, selvom begge har fuld 3-spils-adgang —
  // udvidet til samme dybde-niveau, samme skabelon (rolle+stil, 2-3
  // eksplicitte instruktioner, promptHook der slutter på tankestreg).
  {
    id: 'oekonom_deleregning', name: 'Den nøjeregnende deleregnings-ekspert',
    promptHook: 'Som en der altid regner ned til sidste krone —',
    instructions: [
      'Du husker præcis hvem der skylder hvad, ned til øren.',
      'Du foreslår en app til at dele regningen "for retfærdighedens skyld".',
      'Du bliver stille fornærmet hvis nogen runder op i din favør.',
    ],
  },
  {
    id: 'nostalgisk_fotograf', name: 'Den overivrige minde-fotograf',
    promptHook: 'Som en der skal dokumentere hvert eneste øjeblik —',
    instructions: [
      'Du afbryder for det perfekte gruppebillede, hele tiden.',
      'Du poster det i gruppechatten før aftenen overhovedet er slut.',
      'Du bliver såret hvis nogen ikke vil være med på billedet.',
    ],
  },
];

const COMPLAINER_SITUATIONS_VENNE = ['ven', 'fest', 'rejse', 'spil'];

const COMPLAINER_PROMPTS_VENNE = [
  { id: 'fest1', category: 'fest', tier: 1, text: 'Du opdager at værten glemte at invitere dig til den fælles ferieplanlægning. Du brokker dig til en ven der ikke engang skal med. Hvad siger du?' },
  { id: 'fest2', category: 'fest', tier: 3, text: 'Du opdager at resten af vennegruppen har haft en hyggeaften uden dig, som ingen nævnte bagefter. Du brokker dig til vennens søskende, som du knap kender. Hvad siger du?' },
  { id: 'rejse1', category: 'rejse', tier: 2, text: 'Vennegruppen kan ikke blive enige om rejsemål for tredje weekend i træk. Du brokker dig til din partner, som ikke er en del af vennegruppen. Hvad siger du?' },
  { id: 'rejse2', category: 'rejse', tier: 3, text: 'Du opdager at to andre i vennegruppen allerede har booket flybilletter uden at spørge resten. Du brokker dig til en ven fra en helt anden vennekreds. Hvad siger du?' },
  { id: 'spil1', category: 'spil', tier: 1, text: 'En ven tager brætspilsaftenen alt for seriøst igen. Du brokker dig til en anden ven, der lige er ankommet. Hvad siger du?' },
  { id: 'spil2', category: 'spil', tier: 2, text: 'En ven ændrer reglerne midt i spillet, "fordi det giver bedre mening nu". Du brokker dig til vennens kæreste, som ikke selv spillede med. Hvad siger du?' },
  { id: 'ven1', category: 'ven', tier: 1, text: 'En ven aflyser jeres faste aftale for tredje gang i træk. Du brokker dig til en kollega, som aldrig har mødt vedkommende. Hvad siger du?' },
  { id: 'ven2', category: 'ven', tier: 3, text: 'Du opdager at en ven har inviteret alle andre til noget, undtagen dig. Du brokker dig til vennens partner. Hvad siger du?' },
  { id: 'ven3', category: 'ven', tier: 2, text: 'En ven låner dit værktøj/udstyr og afleverer det tilbage i stykker uden at nævne det selv. Du brokker dig til en fælles ven, som lige har hørt den halve historie. Hvad siger du?' },
  { id: 'rel1', category: 'relational', tier: 2, text: 'En ven brokker sig konstant over planlægning, men bidrager aldrig selv med noget. Du brokker dig om DET til en tredje ven. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 3, text: 'Du indser at du selv gjorde nøjagtig det du lige har brokket dig over hos en anden ven, for få uger siden. Du brokker dig om det til en ven der husker begge episoder. Hvad siger du?' },
];

// Rosekassen — reward-polaritet, 5 arketyper, personaer der ROSER.
const COMPLAINER_ARCHETYPES_ROSE = [
  {
    id: 'konferencier_overstroemmende', name: 'Den overstrømmende konferencier',
    promptHook: 'Med et mikrofonklart smil og lovord til alle —',
    instructions: [
      'Du roser i superlativer, aldrig moderat.',
      'Du klapper og hepper højlydt.',
      'Du finder noget positivt i alt.',
    ],
  },
  {
    id: 'mentor_stille', name: 'Den stille anerkendende mentor',
    promptHook: 'Som en der roser med få, men velvalgte ord —',
    instructions: [
      'Du taler roligt og oprigtigt.',
      'Du fremhæver én konkret detalje, ikke det hele.',
      'Du mener hvert ord du siger.',
    ],
  },
  {
    id: 'heppekor_entusiastisk', name: 'Den entusiastiske heppekor-leder',
    promptHook: 'Som en der aldrig kan sidde stille af begejstring —',
    instructions: [
      'Du er højlydt og energisk.',
      'Du inddrager alle omkring dig i din begejstring.',
      'Du gentager rosen flere gange for at understrege den.',
    ],
  },
  {
    id: 'analytisk_ros_giver', name: 'Den analytiske ros-giver',
    promptHook: 'Som en der roser med konkrete argumenter —',
    instructions: [
      'Du underbygger din ros med specifikke eksempler.',
      'Du sammenligner med tidligere præstationer.',
      'Du er saglig, men tydeligt imponeret.',
    ],
  },
  {
    id: 'familiaer_varm', name: 'Den varme familiære ros-giver',
    promptHook: 'Som en der roser som var det ens eget barn —',
    instructions: [
      'Du er varm og personlig i din tone.',
      'Du nævner hvor stolt du er.',
      'Du krammer verbalt gennem ordene.',
    ],
  },
  // Quizmaster-audit (indholdsdybde): Rosekassen havde kun 5 arketyper/6
  // prompts, den tyndeste pulje af alle skins med fuld 3-spils-adgang.
  // Udvidet til 8/11 — SAMME reward-only regel som resten af filen: intet
  // her må antyde straf/anklage, kun forskellige STILARTER at rose i.
  {
    id: 'poetisk_ordkunstner', name: 'Den poetiske ros-digter',
    promptHook: 'Som en der aldrig roser i almindelig prosa —',
    instructions: [
      'Du finder blomstrede, næsten overdrevne billedsprog.',
      'Du holder en lille kunstpause før pointen.',
      'Du virker selv rørt af dine egne ord.',
    ],
  },
  {
    id: 'lunefuld_humorist', name: 'Den lunefulde ros-humorist',
    promptHook: 'Som en der roser bedst gennem en god drilleri —',
    instructions: [
      'Du pakker rosen ind i et kærligt drilleri først.',
      'Du griner selv undervejs.',
      'Du mener det oprigtigt, selvom tonen er let.',
    ],
  },
  {
    id: 'ceremoniel_hoejtidelig', name: 'Den højtidelige ros-ceremonimester',
    promptHook: 'Som en der behandler enhver ros som en lille tale —',
    instructions: [
      'Du indleder med "jeg vil gerne sige noget vigtigt".',
      'Du taler langsomt og med vægt på hvert ord.',
      'Du afslutter altid med en lille skål eller klapsalve.',
    ],
  },
];

const COMPLAINER_SITUATIONS_ROSE = ['ven', 'familie', 'arbejde', 'fremmed'];

const COMPLAINER_PROMPTS_ROSE = [
  { id: 'ven1', category: 'ven', tier: 1, text: 'En ven overraskede hele gruppen med en gennemtænkt gave. Du roser vedkommende til en fælles ven, som ikke selv var med. Hvad siger du?' },
  { id: 'ven3', category: 'ven', tier: 2, text: 'En ven huskede noget lille og vigtigt for dig, som du selv havde glemt. Du roser det til en fælles ven, som ikke aner hvor meget det betød. Hvad siger du?' },
  { id: 'familie1', category: 'familie', tier: 1, text: 'Din søster lavede en fantastisk middag til hele familien. Du roser hende til din mor, som ikke selv smagte den. Hvad siger du?' },
  { id: 'familie2', category: 'familie', tier: 2, text: 'Din nevø/niece klarede noget svært for første gang, helt uden hjælp. Du roser det til en bedsteforælder, som ikke selv var til stede. Hvad siger du?' },
  { id: 'arbejde1', category: 'arbejde', tier: 2, text: 'En kollega reddede et vigtigt projekt i sidste øjeblik. Du roser vedkommende til en helt anden afdeling. Hvad siger du?' },
  { id: 'arbejde2', category: 'arbejde', tier: 3, text: 'En kollega tog stille og roligt skylden for en fælles fejl, for at skåne resten af teamet. Du roser det til en leder, som ellers aldrig hører om den slags. Hvad siger du?' },
  { id: 'fremmed1', category: 'fremmed', tier: 1, text: 'En fremmed hjalp dig med noget helt uventet på gaden. Du roser oplevelsen til en ven over telefonen. Hvad siger du?' },
  { id: 'ven2', category: 'ven', tier: 3, text: 'En ven har ændret sig markant til det bedre det seneste år. Du roser forandringen direkte til vennen selv. Hvad siger du?' },
  { id: 'rel1', category: 'relational', tier: 2, text: 'Du bliver selv rost for noget, og indser at du sjældent giver samme ros videre. Du roser nu en anden for præcis det samme. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 3, text: 'Du indser at den du roser mindst, faktisk fortjener det mest. Du roser vedkommende for første gang i lang tid, til en fælles ven som lagde mærke til stilheden. Hvad siger du?' },
  { id: 'rel3', category: 'relational', tier: 1, text: 'Du hører en anden rose en tredje person varmt. Du supplerer med din egen ros af samme person, til den der startede det. Hvad siger du?' },
];

// Drikkekassen — session-baseret, 6 arketyper, fest/drikkeleg-personaer.
const COMPLAINER_ARCHETYPES_DRIK = [
  {
    id: 'rundegiver_overivrig', name: 'Den overivrige rundegiver',
    promptHook: 'Som en der altid byder på en tur mere —',
    instructions: [
      'Du er storsindet og lidt for generøs.',
      'Du glemmer let hvor mange runder du selv har givet.',
      'Du bliver fornærmet hvis nogen takker nej.',
    ],
  },
  {
    id: 'rundeunddrager_strategisk', name: 'Den strategiske rundeunddrager',
    promptHook: 'Som en der altid lige er på toilettet ved regningen —',
    instructions: [
      'Du finder kreative undskyldninger for at forsvinde.',
      'Du foreslår "vi deler bare til sidst" og glemmer det.',
      'Du er charmerende nok til at slippe godt fra det.',
    ],
  },
  {
    id: 'quizspiller_haabloes', name: 'Den håbløse quizspiller',
    promptHook: 'Som en der altid gætter helt forkert med stor selvtillid —',
    instructions: [
      'Du svarer højlydt og selvsikkert på forkerte svar.',
      'Du forsvarer dit svar selv når du bliver rettet.',
      'Du er uforstyrret af at tabe.',
    ],
  },
  {
    id: 'drikkelegsspiller_konkurrence', name: 'Den competitive drikkelegsspiller',
    promptHook: 'Som en der tager enhver drikkeleg dødsens alvorligt —',
    instructions: [
      'Du tager reglerne bogstaveligt og strengt.',
      'Du kræver revanche med det samme.',
      'Du fejrer sejre højlydt.',
    ],
  },
  {
    id: 'tidlig_hjemgaaende', name: 'Den trætte tidlig-hjemgående',
    promptHook: 'Som en der altid vil hjem før alle andre —',
    instructions: [
      'Du finder undskyldninger for at gå tidligt.',
      'Du bliver alligevel overtalt til at blive.',
      'Du fortryder det næste morgen.',
    ],
  },
  {
    id: 'fest_veteran_nostalgisk', name: 'Den nostalgiske fest-veteran',
    promptHook: 'Som en der har været til hver eneste fest i årevis —',
    instructions: [
      'Du sammenligner med "sidste års fest".',
      'Du husker detaljer ingen andre kan huske.',
      'Du fortæller den samme historie igen.',
    ],
  },
  // Quizmaster-audit (indholdsdybde): Drikkekassen havde kun 6 arketyper/6
  // prompts, samme tynde niveau som Vennekassen/Rosekassen — udvidet til
  // 8/11, samme skabelon.
  {
    id: 'shotansvarlig_ivrig', name: 'Den ivrige shot-ansvarlige',
    promptHook: 'Som en der altid har det næste shot klar —',
    instructions: [
      'Du finder på en ny grund til et shot hvert femte minut.',
      'Du bliver skuffet hvis stemningen dæmpes.',
      'Du husker aldrig selv hvor mange du har taget.',
    ],
  },
  {
    id: 'kok_sent_paa_natten', name: 'Den sent-på-natten madlavende ven',
    promptHook: 'Som en der ALTID ender med at lave mad klokken 3 —',
    instructions: [
      'Du insisterer på at alle skal smage din natmad.',
      'Du bliver fornærmet hvis nogen takker nej til maden.',
      'Du efterlader et rodet køkken uden at nævne det selv.',
    ],
  },
];

const COMPLAINER_SITUATIONS_DRIK = ['fest', 'runde', 'spil', 'morgen'];

const COMPLAINER_PROMPTS_DRIK = [
  { id: 'fest1', category: 'fest', tier: 1, text: 'Nogen spillede den samme sang tre gange i træk til festen. Du brokker dig til en gæst der lige er ankommet. Hvad siger du?' },
  { id: 'fest3', category: 'fest', tier: 2, text: 'Nogen skruede op for musikken hver gang stemningen faldt til ro. Du brokker dig til en nabo der lige er kigget forbi. Hvad siger du?' },
  { id: 'runde1', category: 'runde', tier: 1, text: 'Du opdager at du har givet tre runder, og ingen andre har givet én. Du brokker dig til bartenderen, som bare ekspederer. Hvad siger du?' },
  { id: 'runde2', category: 'runde', tier: 3, text: 'Du opdager at "vi deler bare til sidst" endte med at du betalte mest, igen. Du brokker dig til en helt fremmed ved baren. Hvad siger du?' },
  { id: 'spil1', category: 'spil', tier: 2, text: 'Nogen snød tydeligt i drikkelegen, men nægter det. Du brokker dig til en ven der ikke så det ske. Hvad siger du?' },
  { id: 'spil2', category: 'spil', tier: 1, text: 'Nogen opfinder nye regler til drikkelegen midt i, som altid tilfældigvis gavner dem selv. Du brokker dig til en gæst der først lige er mødt op. Hvad siger du?' },
  { id: 'morgen1', category: 'morgen', tier: 2, text: 'Du vågner op og opdager at du lovede at arrangere næste fest. Du brokker dig til din partner, som advarede dig i forvejen. Hvad siger du?' },
  { id: 'morgen2', category: 'morgen', tier: 3, text: 'Du finder ud af at du sang karaoke solo foran hele festen, og alle har det på video. Du brokker dig til den eneste der IKKE filmede det. Hvad siger du?' },
  { id: 'fest2', category: 'fest', tier: 3, text: 'Værten glemte at invitere dig til efterfesten. Du brokker dig til en fælles ven, som var der. Hvad siger du?' },
  { id: 'rel1', category: 'relational', tier: 1, text: 'Nogen brokker sig over at skulle give en runde, men accepterer altid andres. Du brokker dig om DET til en tredje gæst. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 2, text: 'Du indser at du selv gjorde nøjagtig det du plejer at brokke dig over andre for til fester. Du brokker dig om det til en gæst der husker begge aftener. Hvad siger du?' },
];

// Konkurrencekassen — EGET indhold, IKKE en regex-omskrivning af brok-
// puljens klage-scener (se commit-historikken/quizmaster-audit-fund:
// CONTENT_BY_THEME's tidligere konkurrence-gren erstattede kun ordet
// "brokker dig til" med "praler du til" i brok's egne KLAGE-scenarier —
// gav grammatisk forkerte sætninger ("Du praler du til...") og situationer
// der stadig var klager, ikke sejre, fx "chefen beder dig blive en time
// ekstra — du praler du til rengøringsassistenten" gav ingen mening som
// praleri). Reward-polaritet betyder man praler af EGNE sejre, ikke
// klager over andres opførsel — derfor egne situationer (sport/spil/
// arbejde/familie/ven, ikke chef/nabo/familie/kollega/ven) og egne
// arketyper (bragende leverings-stil, ikke brok-stil).
const COMPLAINER_ARCHETYPES_KONKURRENCE = [
  {
    id: 'pilot', name: 'Den selvsikre pilot',
    promptHook: 'Som en der er vant til at have styringen i luften —',
    instructions: [
      'Du er ikke i tvivl om at du gjorde det bedst.',
      'Du er højrøstet og overdriver gerne dine bedrifter.',
      'Smil bredt mens du fortæller det, som om det var oplagt.',
    ],
  },
  {
    id: 'kok', name: 'Den udadvendte kok',
    promptHook: 'Med hele køkkenets fulde opmærksomhed som vane —',
    instructions: [
      'Du råber sejren ud med det samme — helt uden filter.',
      'Overdriv følelserne teatralsk, gerne med håndbevægelser.',
      'Du er dybt fornærmet hvis nogen ikke er lige så imponerede som dig selv.',
    ],
  },
  {
    id: 'nabo', name: 'Den beskedent-praleriske nabo',
    promptHook: 'Som en der "bare lige nævner det i forbifarten" —',
    instructions: [
      'Sig "det var ikke noget særligt" — men fortæl det alligevel i detaljer.',
      'Brug små hints og antydninger i stedet for at sige det ligeud.',
      'Skift emne brat, som om du slet ikke selv lagde mærke til sejren.',
    ],
  },
  {
    id: 'foraelder', name: 'Den opofrende sportsforælder',
    promptHook: 'Som en der altid har lagt alt til side for det her —',
    instructions: [
      'Det er dig der har trænet mest, nævn det, ubedt.',
      'Sammenlign med alt det du "kunne" have gjort i stedet.',
      'Afslut med et stolt suk og "men det var jo hele indsatsen værd".',
    ],
  },
  {
    id: 'projektleder', name: 'Den strategiske projektleder',
    promptHook: 'Med et regneark der beviser det —',
    instructions: [
      'Send indirekte hip via "bare lige en detalje..." — aldrig direkte praleri.',
      'Ros modstanderen først, fremhæv så din egen sejr med et "men".',
      'Brug ordet "interessant" som skjult overlegenhed.',
    ],
  },
  {
    id: 'laerer', name: 'Den udadvendte lærer',
    promptHook: 'Som en der er vant til at få hele lokalets opmærksomhed —',
    instructions: [
      'Du taler højt og bruger hele kroppen når du fortæller om sejren.',
      'Inddrag "vi gjorde det sammen", men gør klart hvem der reelt bar det.',
      'Du elsker en god pointe og gentager den gerne tre gange.',
    ],
  },
  {
    id: 'fitness', name: 'Den hårdtarbejdende fitnessinstruktør',
    promptHook: 'Som en der altid er der klokken seks, også for sig selv —',
    instructions: [
      'Du har ALT arbejdet for det, og ingen forstår hvor hårdt det var.',
      'Nævn hvor tidligt du stod op for at nå det.',
      'Antyd at ingen andre ville have klaret det samme.',
    ],
  },
  {
    id: 'taxachauffoer', name: 'Den afdæmpet-praleriske taxachauffør',
    promptHook: 'Som en der ser alt fra bagsædet, men gerne fortæller det —',
    instructions: [
      'Fortæl det roligt og underspillet, som om det var indlysende.',
      'Brug en tør, selvsikker tone — aldrig råb.',
      'Lad en lang pause tale for dig efter pointen.',
    ],
  },
  {
    id: 'influencer', name: 'Den polerede influencer',
    promptHook: 'Med et smil klar til kameraet, uanset hvad —',
    instructions: [
      'Pak alt ind i taknemmelighed — "helt vildt heldig, men også bare hårdt arbejde".',
      'Vær sødt selvpromoverende — "haha nej men altså" mens du praler.',
      'Understreg at "jeg siger det jo bare fordi I spurgte".',
    ],
  },
  {
    id: 'haandvaerker', name: 'Den ligeud-praleriske håndværker',
    promptHook: 'Som en der siger tingene ligeud, håndværker-stil —',
    instructions: [
      'Du praler højt og direkte, uden omsvøb.',
      'Brug konkrete, fysiske eksempler — "det tog MIG kun halvdelen af tiden".',
      'Du er stolt af at sige tingene ligeud — "nogen må jo sige det".',
    ],
  },
];

const COMPLAINER_SITUATIONS_KONKURRENCE = ['sport', 'spil', 'arbejde', 'familie', 'ven'];

const COMPLAINER_PROMPTS_KONKURRENCE = [
  // --- sport ---
  { id: 'sport1', category: 'sport', tier: 1, text: 'Du vinder den uofficielle løbetur mod din kollega på vej til bussen. Du praler af det til den fremmede i køen bagved, som slet ikke aner hvad der lige skete. Hvad siger du?' },
  { id: 'sport2', category: 'sport', tier: 2, text: 'Du slår hele familien i minigolf for tredje gang i træk. Du praler af det til naboen over hækken, som ikke engang vidste I havde spillet. Hvad siger du?' },
  { id: 'sport3', category: 'sport', tier: 3, text: 'Du vinder årets padel-turnering i klubben, efter at have tabt de sidste tre år. Du praler af det til din gamle træner, som engang sagde du ikke havde talentet. Hvad siger du?' },
  // --- spil ---
  { id: 'spil1', category: 'spil', tier: 1, text: 'Du vinder Ludo mod hele familien tre gange i træk juleaften. Du praler af det til postbuddet dagen efter, som bare afleverer en pakke. Hvad siger du?' },
  { id: 'spil2', category: 'spil', tier: 2, text: 'Du gætter alle svarene rigtigt til quizzen, mens dit hold ellers plejer at tabe. Du praler af det til din frisør, mens du sidder fastspændt i stolen. Hvad siger du?' },
  { id: 'spil3', category: 'spil', tier: 3, text: 'Du slår din svoger i poker for første gang nogensinde, efter års drilleri. Du praler af det til din bedste ven over telefonen, som egentlig ringede om noget helt andet. Hvad siger du?' },
  // --- arbejde ---
  { id: 'arbejde1', category: 'arbejde', tier: 1, text: 'Du lander den største aftale i afdelingen dette kvartal. Du praler af det til rengøringsassistenten, som er ved at låse af og bare vil hjem. Hvad siger du?' },
  { id: 'arbejde2', category: 'arbejde', tier: 2, text: 'Din chef roser dit projekt foran hele mødelokalet. Du praler af det til din partner bagefter, som bare spurgte hvordan dagen gik. Hvad siger du?' },
  { id: 'arbejde3', category: 'arbejde', tier: 3, text: 'Du får den forfremmelse, du selv har knoklet for i to år. Du praler af det til receptionisten, som knap nok kender dig. Hvad siger du?' },
  // --- familie ---
  { id: 'familie1', category: 'familie', tier: 1, text: 'Dit hold vinder familiens årlige stafet til sommerfesten. Du praler af det til en kollega, som ikke engang kender resten af familien. Hvad siger du?' },
  { id: 'familie2', category: 'familie', tier: 2, text: 'Dit barn scorer det afgørende mål, og du var den der trænede med hende/ham hver dag. Du praler af det til din mor, som altid ender med at tage din brors parti. Hvad siger du?' },
  { id: 'familie3', category: 'familie', tier: 3, text: 'Du vinder årets julequiz mod hele familien for tredje år i træk. Du praler af det til din svoger, som du ellers aldrig taler privat med. Hvad siger du?' },
  // --- ven ---
  { id: 'ven1', category: 'ven', tier: 1, text: 'Du slår din bedste ven i den evige diskussion om hvem der løber hurtigst — sort på hvidt, med en app til at bevise det. Du praler af det til en kollega, som aldrig har mødt vedkommende. Hvad siger du?' },
  { id: 'ven2', category: 'ven', tier: 2, text: 'Du vinder væddemålet, I lavede for tre måneder siden, som ingen troede du kunne vinde. Du praler af det til din frisør, mens du sidder fastspændt i stolen. Hvad siger du?' },
  { id: 'ven3', category: 'ven', tier: 3, text: 'Du bliver kåret som årets rejsefælle af vennegruppen efter at have planlagt hele turen. Du praler af det til vennens kæreste, som du normalt aldrig taler alene med. Hvad siger du?' },
  // --- relational (bruges af alle, uanset situation) ---
  { id: 'rel1', category: 'relational', tier: 1, text: 'Dine børn spørger hvem der er bedst til computerspil i familien, og alle peger på dig. Du praler af det til en kollega uden børn. Hvad siger du?' },
  { id: 'rel2', category: 'relational', tier: 2, text: 'Nogen praler af en lille sejr, mens du selv lige har vundet noget meget større. Du praler videre til din partner om det, bagefter, om hvor lidt folk forstår hvad en RIGTIG sejr er. Hvad siger du?' },
  { id: 'rel3', category: 'relational', tier: 3, text: 'Du plejer at prale af dine sejre — men din partner peger på, at du glemte at nævne modstanderens dårlige dag. Du praler til din bedste ven over at blive kaldt en dårlig vinder, af at vinde. Hvad siger du?' },
  { id: 'rel4', category: 'relational', tier: 3, text: 'En du står tæt på ville blive overrasket, hvis de hørte hvor meget du reelt praler af sejren, når de ikke er der. Du praler om netop den sejr til en fælles ven. Hvad siger du?' },
];

// Kasse-motor-generalisering (Fase 1, se god-finding-men-du-lovely-zephyr.md):
// tema-keyet indholds-opslag. 'brok' refererer UÆNDRET til arketyper/
// situationer/prompts ovenfor (ingen indholds-omskrivning, kun et
// lookup-lag) — nye temaer tilføjes som nye nøgler, ukendt themeId falder
// tilbage til 'brok', crasher aldrig et rum uden kurateret indhold endnu.
const CONTENT_BY_THEME = {
  brok: {
    archetypes: COMPLAINER_ARCHETYPES,
    situations: COMPLAINER_SITUATIONS,
    prompts: COMPLAINER_PROMPTS,
    gameName: 'Det Store Brokkeri',
  },
  // Fase 5 bevis-tema. gameName "Bødefælden" (ikke "Det Store Brokkeri" —
  // spilnavne er tema-afhængige, se planen).
  bode: {
    archetypes: COMPLAINER_ARCHETYPES_BODE,
    situations: COMPLAINER_SITUATIONS_BODE,
    prompts: COMPLAINER_PROMPTS_BODE,
    gameName: 'Bødefælden',
  },
  // Konkurrencekassen: eget indhold (se COMPLAINER_ARCHETYPES_KONKURRENCE's
  // kommentar ovenfor for hvorfor — en tidligere regex-omskrivning af
  // brok's egne klage-scener gav grammatisk forkerte, meningsløse sætninger).
  konkurrence: {
    archetypes: COMPLAINER_ARCHETYPES_KONKURRENCE,
    situations: COMPLAINER_SITUATIONS_KONKURRENCE,
    prompts: COMPLAINER_PROMPTS_KONKURRENCE,
    gameName: 'Konkurrencefælden',
  },
  sladre: {
    archetypes: COMPLAINER_ARCHETYPES_SLADRE,
    situations: COMPLAINER_SITUATIONS_SLADRE,
    prompts: COMPLAINER_PROMPTS_SLADRE,
    gameName: 'Sladrefælden',
  },
  logn: {
    archetypes: COMPLAINER_ARCHETYPES_LOGN,
    situations: COMPLAINER_SITUATIONS_LOGN,
    prompts: COMPLAINER_PROMPTS_LOGN,
    gameName: 'Løgnefælden',
  },
  hjaelper: {
    archetypes: COMPLAINER_ARCHETYPES_HJAELPER,
    situations: COMPLAINER_SITUATIONS_HJAELPER,
    prompts: COMPLAINER_PROMPTS_HJAELPER,
    gameName: 'Kollegafælden',
  },
  venne: {
    archetypes: COMPLAINER_ARCHETYPES_VENNE,
    situations: COMPLAINER_SITUATIONS_VENNE,
    prompts: COMPLAINER_PROMPTS_VENNE,
    gameName: 'Vennefælden',
  },
  rose: {
    archetypes: COMPLAINER_ARCHETYPES_ROSE,
    situations: COMPLAINER_SITUATIONS_ROSE,
    prompts: COMPLAINER_PROMPTS_ROSE,
    gameName: 'Rosefælden',
  },
  drik: {
    archetypes: COMPLAINER_ARCHETYPES_DRIK,
    situations: COMPLAINER_SITUATIONS_DRIK,
    prompts: COMPLAINER_PROMPTS_DRIK,
    gameName: 'Rundefælden',
  },
};
function getThemeContent(themeId) {
  return CONTENT_BY_THEME[themeId] || CONTENT_BY_THEME.brok;
}

// Vælger arketype + situation til hver spiller. Ikke vægtet/roterende som
// MrBrok's pickMrBrok — Det Store Brokkeri er endnu ung nok til at et simpelt
// tilfældigt shuffle er fint (kan senere udbygges med samme
// gentagelses-modstand hvis det bliver et problem i praksis).
function assignArchetypesAndSituations(players, themeId) {
  const theme = getThemeContent(themeId);
  const archetypes = {};
  const situations = {};
  players.forEach(p => {
    archetypes[p.id] = pickRandom(theme.archetypes).id;
    situations[p.id] = pickRandom(theme.situations);
  });
  return { archetypes, situations };
}

// Ønsket tier for en given runde ud af det samlede antal opbygningsrunder —
// jævnt fordelt tredjedele, så et 4-runders spil fx giver tier 1,2,2,3 og et
// 6-runders spil giver 1,1,2,2,3,3.
function tierForRound(round, totalRounds) {
  const third = Math.max(1, Math.ceil(totalRounds / 3));
  if (round <= third) return 1;
  if (round <= third * 2) return 2;
  return 3;
}

// Vælger en prompt til en spiller for en given runde: matcher spillerens
// situation (eller 'relational', som er åben for alle), prioriterer den
// ønskede eskalerings-tier, og undgår prompts spilleren allerede har fået i
// dette spil. Falder gradvist tilbage (forkert tier, så hvilken som helst
// kategori) frem for nogensinde at returnere ingenting.
function pickPromptFor(playerId, situation, round, totalRounds, usedIds, themeId) {
  const prompts = getThemeContent(themeId).prompts;
  const used = new Set(usedIds || []);
  const desiredTier = tierForRound(round, totalRounds);
  const eligible = (tier, anyCategory) => prompts.filter(p =>
    !used.has(p.id) &&
    (anyCategory || p.category === situation || p.category === 'relational') &&
    p.tier === tier
  );
  let pool = eligible(desiredTier, false);
  if (!pool.length) pool = prompts.filter(p => !used.has(p.id) && (p.category === situation || p.category === 'relational'));
  if (!pool.length) pool = prompts.filter(p => !used.has(p.id));
  if (!pool.length) pool = prompts; // hele puljen brugt — så må noget gå igen
  return pickRandom(pool);
}

// Sammensætter den FAKTISKE prompt-tekst en spiller ser: arketypens
// promptHook (persona-linse) + den situationelle prompt valgt af
// pickPromptFor ovenfor. Ren PRÆSENTATIONS-sammensætning ved levering —
// selve COMPLAINER_PROMPTS-puljen og dens id/category/tier-udvælgelse
// rører vi ALDRIG, kun hvordan den valgte prompt vises frem. Sænker den
// situationelle prompts første bogstav, så de to dele hægter sammen som ÉN
// sætning efter hookens tankestreg, i stedet for to bolted-on stumper (fx
// "Som en der er vant til at have styringen i luften — hvad er det
// seneste din chef har bedt dig om..."). Kaldes fra complainerFlow.js's
// beginComplainRound, som har både arketype-id'et og selve prompten ved
// hånden.
function composePromptText(archetypeId, promptText, themeId) {
  const archetype = getThemeContent(themeId).archetypes.find(a => a.id === archetypeId);
  if (!archetype || !archetype.promptHook || !promptText) return promptText;
  const lowered = promptText.charAt(0).toLowerCase() + promptText.slice(1);
  return `${archetype.promptHook} ${lowered}`;
}

// Det Store Brokkeri gemmer en hemmelighed i state.complainer (hvem der er "Den
// Store Brokker") — men hele state sendes som én samlet JSON-blob til
// klienten ved hver poll/handling (se api/state.js), så vi maskerer det
// hemmelige felt ud fra HVEM der kigger, hver gang state serialiseres.
// Samme filosofi som _lib/store.js's redactStateFor for MrBrok — ligger her
// (og ikke i store.js) udelukkende for at undgå en cirkulær require med
// _lib/complainerFlow.js, som selv bruger store.js's uid().
//
// Skyldig-identiteten holdes hemmelig for ALLE (inklusive den skyldige selv)
// indtil c.revealed bliver sat af beginReveal() i complainerFlow.js — det er
// selve pointen i spillet (se CLAUDE.md). Opbygningsrundernes brok siges HØJT
// ved bordet (se beginComplainRound i complainerFlow.js) — der er intet
// tekstfelt og intet der gemmes af selve ordlyden, kun HVEM der har turen
// (order/turnIndex/speakerId) og HVILKEN prompt de fik, hvilket ikke er
// hemmeligt for nogen — så 'complain'-fasen kræver ingen redaktion
// overhovedet, i modsætning til vote/judge som stadig er hemmelige
// afstemninger indtil alle har stemt.
function redactComplainerFor(state, viewerId) {
  const c = state.complainer;
  if (!c || !c.active || (c.current && c.current.type === 'gameover')) return state;
  const isGuilty = !!(c.revealed && viewerId && viewerId === c.guiltyId);
  const safe = { ...c, guiltyId: undefined, youAreGuilty: isGuilty };
  if (safe.current) {
    const cur = { ...safe.current };
    if (cur.type === 'vote') {
      const mine = viewerId && Object.prototype.hasOwnProperty.call(cur.votes || {}, viewerId);
      cur.voteCount = Object.keys(cur.votes || {}).length;
      cur.votes = mine ? { [viewerId]: cur.votes[viewerId] } : {};
    } else if (cur.type === 'judge') {
      const mine = viewerId && Object.prototype.hasOwnProperty.call(cur.votes || {}, viewerId);
      cur.voteCount = Object.keys(cur.votes || {}).length;
      cur.votes = mine ? { [viewerId]: cur.votes[viewerId] } : {};
    } else if (cur.type === 'bet') {
      // EXPERIMENTAL "Udfordring" (se applyComplainerChallenge i
      // complainerFlow.js): den fulde stemmefordeling er normalt skjult
      // (kun cur.topId — vinderen — er offentlig), og afsløres kun for alle
      // hvis nogen bruger deres udfordring denne runde.
      if (!cur.challenged) cur.tally = undefined;
    }
    safe.current = cur;
  }
  return { ...state, complainer: safe };
}

module.exports = {
  COMPLAINER_ARCHETYPES,
  COMPLAINER_SITUATIONS,
  COMPLAINER_PROMPTS,
  CONTENT_BY_THEME,
  getThemeContent,
  assignArchetypesAndSituations,
  pickPromptFor,
  composePromptText,
  tierForRound,
  redactComplainerFor,
};
