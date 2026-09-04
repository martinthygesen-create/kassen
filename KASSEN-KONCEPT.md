# Kassen — generisk platform-koncept (brainstorm-notat)

Ikke under aktiv udvikling — et koncept-notat til senere overvejelse, ikke en
instruktion til at bygge noget. Se `CLAUDE.md` for aktive arkitektur-krav.

## Kernetanken

"Brokkekassen" er i virkeligheden to ting i én app:
1. **Kassen** — en generisk motor: confirmed-by-peers hændelse → koster ind i
   en fælles pulje → streaks/lodtrækning/topliste ovenpå.
2. **Spillene** — Brokspillet, MrBrok, Det Store Brokkeri, bygget til at
   spilles når man er fysisk sammen.

Kassen er ikke reelt brok-specifik i sin kerne — den er en generel "spor og
gamificér en delt, tilbagevendende social adfærd" motor, der tilfældigvis
lancerede med brok som sit første skin.

**Målbillede**: "Vi spiller Kassen" som et generisk, brand-agnostisk værktøj —
ligesom man siger "send det på mail" uden at tænke på hvad indholdet er.

## Den centrale pointe om navngivning

Løsningen er IKKE en dropdown med 4-5 forudbyggede skins. Det er et tomt
felt ved oprettelse: **"Hvad handler jeres kasse om?"** — gruppen skriver
selv "sladderkassen", "drikkekassen", hvad som helst. Ejerskabet af navnet
ligger hos gruppen, ikke hos appen. Det er den del der reelt minder om
"det er generisk som e-mail" — fordi det er brugeren, ikke en menu, der
definerer hvad værktøjet bruges til.

## De variabler der reelt skal til

Gennemtænkt via konkrete tanke-eksperimenter (drikkekassen, pokerkassen,
venindekassen — se nedenfor), ikke bare teoretisk:

1. **Enhed/valuta** — €, kr, shots, point osv.
2. **Varighedsmodel** — dette er IKKE bare kosmetik, det er den første reelt
   arkitektoniske ændring: dagligt-cyklende (nuværende model, streaks/
   `dayBoundary`) vs. én samlet session (fest/pokeraften, ingen
   dags-grænse, kører til den lukkes manuelt) vs. løbende-indtil-I-mødes
   (venindekassen-modellen — faktisk identisk med den nuværende model).
3. **Hvornår spil er tilgængelige** — "altid" (nuværende) vs. "kun i
   pauserne" (pokeraften — kan ikke spille midt i en hånd) — et koncept
   appen slet ikke har i dag.

## Tanke-eksperimenter (validerer/stress-tester teorien)

- **Drikkekassen**: samme kasse-motor virker næsten 1:1 (bekræft-af-vidner
  passer FINT til druk). Kræver derimod: session-baseret tidsmodel (ikke
  dags-cyklus), fjernelse af message-feltet (for langsomt til en fest),
  lynhurtig lav-friktions bekræftelse (ét tryk, ikke afvente kvorum over
  timer), og en levende fejrings-feed (genbrug eksisterende
  coin-drop-animation, bare 🍺-tema). Første kandidat til faktisk at bygge
  som en håndlavet skin.
- **Pokerkassen**: kassen bliver en SIDE-pulje for bordetikette (ikke selve
  indsatserne — poker har allerede sin egen pengemekanik). Introducerer
  "spil kun i pauserne"-begrebet.
- **Venindekassen**: interessant fordi den kræver NÆSTEN INGEN strukturel
  ændring — matcher allerede den nuværende dags-cyklus + mødes-og-spil
  rytme perfekt. De reelle ubekendte er ikke tekniske: (1) bekræftelse uden
  fælles tilstedeværelse (fjernvenner kan ikke "se" hinandens dag, så
  bekræftelse bliver selv-bekræft/dispute i stedet for vidne-baseret), og
  (2) at huske appen findes uden fysisk/dagligt prompt (retention-risiko,
  ikke teknisk risiko).

## Indhold: løsningen på "cold start"

Ikke ren AI-generering fra bunden (for usikker kvalitet, se "de to væddemål"
nedenfor). I stedet en kombination:

1. **Onboarding-runde**: hver deltager svarer på 2-3 hurtige spørgsmål
   (fx "nævn 3 ting du elsker/hader ved X") FØR spillene går i gang — sikrer
   at der altid er ægte indhold fra dag ét, uanset hvor ny/stille kassen har
   været.
2. **Genbrug af PROMPTS på tværs af kasser af samme type** — en
   "sladderkasse" oprettet næste måned nyder godt af alle tidligere
   sladderkassers prompt-bibliotek. Vokser produktet bredere, ikke kun
   dybere i ét rum.
3. **Vigtig grænse**: det der genbruges er selve SPØRGSMÅLET/prompten, ALDRIG
   folks faktiske svar. "Nævn 3 ting du elsker ved en ven" er trygt at
   genbruge — en specifik gruppes faktiske svar er privat og bliver aldrig
   delt på tværs af rum.

Universel prompt-form der virker uanset kasse-type: "nævn N ting du
elsker/hader ved X" — formen genererer det sociale øjeblik, ikke det
specifikke indhold.

## De to væddemål (ærlig risikovurdering)

- **Væddemål 1 — generisk kasse-kerne (få variabler)**: LAV risiko. Allerede
  valideret gennem flere tanke-eksempler. Buildbar nu med reel tillid.
- **Væddemål 2 — spil der intelligent tilpasser/låser op baseret på
  akkumuleret data**: HØJ risiko. Ikke arkitektonisk umuligt (nyt spil der
  "popper op" er bare endnu et flag styret af en regel i stedet for manuelt
  admin-toggle), men indholds-KVALITETEN fra sparsomt/rodet data er
  uafprøvet og kan sagtens føles fladt.

**Anbefaling**: byg IKKE den intelligente arkitektur først. Test billigt:
lav drikkekassen som en håndskrevet, statisk skin (ligesom det oprindelige
brok-indhold blev håndskrevet) og se om folk rent faktisk nyder en
ikke-brok kasse. Landene det, er den intelligente/selvkørende lag først
værd at investere i derefter — automatisér noget der allerede er bevist,
i stedet for at satse hele idéen på et uprøvet generativt fundament.

## Konkret næste skridt (når/hvis I går videre)

Martin vil prøve drikkekassen som en skin. Det er det rigtige første
eksperiment: billigt, håndgribeligt, og tester direkte om "de andre kasser"
faktisk er sjove, uden at kræve nogen af de to store, uprøvede satsninger
(generativ arkitektur eller fuld generalisering) først.

## Genbrugelige runde-elementer i koden i dag

Konkret optælling af hvilke felter/funktioner i den nuværende runde-motor
der allerede er generiske nok til at bære flere kasse-typer:

- `roomId` — isolerer én gruppe/session, deles via link (ingen kode/login)
- `members[]` — navngivne deltagere, identificeres på tværs af enheder
- `pending` — ét "aktivt øjeblik" ad gangen (i dag: en påstand der afventer
  stemmer); kan genbruges til aktivt spørgsmål, aktivt hjul-spin, aktiv
  trækning
- `votes[]` + `need` — tærskel-baseret bekræftelse (2/3 osv.); kan genbruges
  til peer-godkendelse ELLER erstattes af vært-godkendelse (facit-mode)
- `events[]` — løbende feed af bekræftede hændelser i runden; kan genbruges
  til spørgsmål/svar-historik, hjul-resultater
- `createdAt` — runde-start, bruges til "dag X"
- `history[]` — arkiv af lukkede runder m. totals pr. medlem; kan genbruges
  til quiz-score over flere dage, wheel-gevinster over tid
- `settle()` — lukker runde, nulstiller, arkiverer; kan genbruges uændret
  til enhver rundetype

Mangler stadig (ikke bygget endnu): roller (admin/host), spørgsmålskø,
randomizer-komponent som selvstændig genbrugelig del, facit-godkendelse,
hold-struktur.

## Yderligere bekræftede fremtidige "skins" på samme motor

Ud over drikkekassen (ovenfor) er følgende også drøftet:

- **Bødekassen / Løgnerkassen / Hjælperkassen / Roskassen** — 100% samme
  motor, kun tekst/enhed/farve skifter.
- **Løftekassen** (løfte + opfølgning senere) — kræver et tid/deadline-
  begreb, findes ikke i dag.
- **Dilemmakassen** (afstemning om en ting, ikke en person) — kræver
  "mål = ting" i stedet for "mål = person".
- **Konkurrencekassen** (løbende leaderboard/ranking) — kræver sortering/
  ranking-visning + evt. "runde i runden" (daglig vinder).
- **Skænderikassen** (to konkurrerende versioner af samme hændelse) —
  kræver flere samtidige påstande om samme hændelse, ikke kun én.
- **Quiz/trivia mellem hjælpere/ansatte/teams** — kræver roller (admin/
  host/medhost), facit-godkendelse (vært alene, ikke gruppe-stemning),
  spørgsmålskø, hold-struktur, evt. kobling til en ekstern AI-trivia-motor.
- **Randomizer-runder** (hjul/lodtrækning) — hjul- og spillemaskine-
  visningen findes allerede (Casinobrok i Brokspillet, se
  `buildWheelChanceHtml`/`buildSlotCabinetHtml` i `index.html`); det der
  mangler er at gøre den til en selvstændig, genbrugelig komponent løsrevet
  fra Brokspillets egen rundetype — IKKE en helt ny komponent.
- **Rygtebørsen** (idé, ikke udforsket) — en AKTIV rygte-mekanik (selv sætte
  et rygte i omløb), i modsat til Sladrekassens nuværende REAKTIVE
  rapportér-knap. Muligvis sjovere. Ikke designet endnu.
- **Valgbar enhed pr. rum** (idé, ikke udforsket) — `state.unit` (€/kr/point)
  er allerede generisk i koden, men fast pr. skin ved oprettelse. Kunne
  gøres til et valg i step 3, ikke kun skin-forudbestemt.

Fælles kerne der IKKE ændres på tværs af nogen af disse:
`members[]`, `pending`, `votes[]`+`need`, `events[]`, `history[]`, `settle()`.
