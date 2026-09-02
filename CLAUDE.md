# CLAUDE.md

Instruktioner og kontekst til fremtidige Claude Code-sessioner på dette repo.

## Projektet

Brokkekassen er en dansk familie-ferie-PWA med et fælles regnskab ("krukken")
og to mini-spil, delt via `activeApp` i `index.html`:

- **Brokspillet** (`activeApp = 'spil'`) — quiz/afstemnings-mini-spil (quiplash,
  sandt/falsk, trivia, guessbrok, casinobrok, rose). Logik i `api/game.js`,
  `api/_lib/game.js`, `api/_lib/gameFlow.js`.
- **MrBrok** (`activeApp = 'mrbrok'`) — Mr. White-agtigt social deduktionsspil.
  Logik i `api/mrbrok.js`, `api/_lib/mrbrok.js`, `api/_lib/mrbrokFlow.js`.

Begge deler rummets lobby/medlemmer (`state.members`) og regnskab, men har hver
sin egen `state.game`/`state.mrbrok`-gren og kan ikke være aktive samtidig i
samme rum.

## Planlagt: "The Big Complainer" — VIGTIGT arkitektur-krav

Der er under overvejelse et **helt nyt, tredje standalone spil** (arbejdstitel
"The Big Complainer" / "Den Store Brokker"), IKKE en videreudvikling eller
variant af MrBrok — selvom det oprindeligt blev diskuteret som "et omvendt
MrBrok".

**Det er IKKE en erstatning for MrBrok.** MrBrok skal blive ved med at
eksistere og fungere uændret som sit eget spil. The Big Complainer er et
TREDJE valg ved siden af Brokspillet og MrBrok — ikke en afløser for nogen
af dem.

**Når/hvis dette bygges, skal det:**
- Være sit eget spil med egen `state`-gren (fx `state.bigComplainer`), egen
  `api/bigcomplainer.js` + `api/_lib/bigComplainerFlow.js`, egen
  `activeApp`-værdi — ikke bygges ind i eller forgrene sig fra
  `state.mrbrok`/`api/mrbrok.js`.
- Må godt **genbruge delte elementer** hvor det giver mening — fx rummets
  lobby/spillervalg-UI, medlemslisten, push-mønsteret, `mutateState`-CAS-
  mønsteret osv. — men kun ved at referere til de samme DELTE helper-
  funktioner/komponenter, aldrig ved at hooke ind i eller forgrene MrBroks
  egen state/flow.
- **Må ikke kunne påvirke Brokspillet eller MrBrok** — hverken deres state,
  deres "kun ét spil aktivt ad gangen i et rum"-regel (det tredje spil skal
  indgå i den samme gensidige udelukkelse, ikke omgå den), eller deres
  indholdspuljer (fx MrBrok's `MRBROK_TOPICS`/`pickTopic`-rotation).

Kort sagt: samme fundament, tre uafhængige spil ovenpå — ikke ét spil der
forgrener sig i tre retninger.

Koncept-noter (arketyper, opbygningsrunder, mistankeafstemning, organisk
afsløring, gættefinale) er ikke skrevet ned et fast sted endnu — spørg
Martin om det fulde koncept-notat før implementering påbegyndes.

## Langsigtet retning: "…Kassen" — generisk rundemotor

Der findes et koncept-notat, `KASSEN-KONCEPT.md`, om at Brokkekassens
runde-motor på sigt kan blive en generisk platform genbrugt til andre
"kasser" end brok. Ikke under aktiv udvikling — men hold denne
genbrugbarhed for øje i nyt arbejde: undgå at hardcode ting specifikt til
ét spil, når det med lidt omtanke kan holdes generisk. Læs
`KASSEN-KONCEPT.md` for de konkrete genbrugelige elementer, bekræftede
fremtidige "skins" og hvad der stadig mangler.

## Én branch, ingen preview

Der køres bevidst med ÉN branch (`claude/brokkekassen-famille-setup-ixh41o`)
som også er prod-branchen — intet preview-setup i Vercel. Nyt arbejde
(inklusive The Big Complainer) skal derfor også committes direkte til denne
branch, IKKE en ny feature-branch — det er en bevidst simplicitets-
beslutning, ikke en forglemmelse.

Da flere Claude Code-sessioner kan arbejde på repoet samtidig på præcis
denne ene branch, er disciplinen omkring `git fetch`/fast-forward FØR hver
push ekstra vigtig — se den gentagne "stale lokal checkout"-problematik i
commit-historikken. Altid: `git fetch origin <branch>` og sammenlign mod
`origin/<branch>` før en push, aldrig antag at lokal HEAD er ajour.

## Mini-spil-kvalitet: Brokspillet er referencestandarden ("Højeste validator")

Efter en "quizmaster"-audit (gentagne bot-simulerede spil kørt direkte mod
`api/_lib/*.js`-motorerne, ikke gæt eller kodelæsning alene — se
commit-historikken omkring omskrivningen af Kollegakassens knap) er
konklusionen: **Brokspillet (`api/_lib/game.js`/`gameFlow.js`) er
arkitektonisk den mest robuste af de tre spil, og skal bruges som
kvalitets-benchmark når nye spil/runde-typer bygges eller ændres.**

Hvorfor Brokspillet er referencen:
- Hver runde har enten ÉT delt indhold (alle ser samme quiplash-prompt/
  trivia-spørgsmål/udsagn) eller frit tekst-input fra spilleren selv —
  ALDRIG flere uafhængigt udtrukne pulje-elementer til flere forskellige
  spillere i samme runde. Det gør Brokspillet strukturelt IMMUNT over for
  en hel fejlklasse (se nedenfor).
- Nødbremse-mønsteret (`BROKSPILLET_AUTO_MS`/`COMPLAINT_COUNTDOWN_MS` i
  `gameFlow.js`) sikrer at ingen runde nogensinde kan gå i stå — genbrugt
  identisk af MrBrok og Det Store Brokkeri, men først bevist robust her.

**Konkret fejlklasse fundet og rettet i Det Store Brokkeri** (findes IKKE i
Brokspillet eller MrBrok, netop pga. ovenstående): `pickPromptFor` i
`complainer.js` uddelte påstande til hver spiller uafhængigt af hvad de
ANDRE spillere i SAMME runde allerede havde fået — kun egen historik blev
undgået. Ved normale familiestørrelser (5-6 spillere) fik 2+ spillere
bogstaveligt samme påstand i samme runde i 95-100% af runderne, målt ved
gentagen simulering, selv i den største indholdspulje (brok, 20 prompts).
Rettet i `beginComplainRound` (complainerFlow.js) med et ekstra per-runde
exclusion-set. **Enhver ny spilmekanik der uddeler individuelt indhold til
flere spillere i samme runde SKAL eksplicit udelukke hvad andre spillere
allerede har fået i den runde — antag det ikke er dækket af eksisterende
per-spiller-historik alene.**

MrBrok er også testet grundigt (gentagne bot-spil, alle skins, min./maks.
spillerantal) og er solid — men er strukturelt immun over for samme
fejlklasse af en anden grund: ét delt emne pr. spil, ikke pr. spiller.
