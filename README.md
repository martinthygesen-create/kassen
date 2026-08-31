# Brokkekassen v2 — delt mellem alles egne telefoner

Nu med et rigtigt (men meget lille) backend, så alle ser den samme krukke, samme
feed og samme regnskab — uanset hvis telefon de sidder med. Ingen adgangskoder:
man skriver bare sit navn (og evt. e-mail) for at komme ind.

## Rører det Twiin? Nej.
Dette bliver et **helt nyt, separat Vercel-projekt** — ikke en tilføjelse til et
eksisterende. Hvert Vercel-projekt har sin egen kildekode, sine egne miljøvariabler
og (nu) sin egen lille database. De deler kun din Vercel-konto, ligesom to forskellige
mapper på samme computer. At oprette dette kan ikke slette, overskrive eller påvirke
Twiin's projekt, domæne eller database på nogen måde.

## Sådan gør du — præcis
1. **Opret et nyt GitHub-repo** (eller upload direkte til Vercel uden git — se punkt 3)
   og læg alle filerne fra denne mappe i roden af repoet.
2. På vercel.com: **"Add New" → "Project"** → importér repoet.
   - Framework preset: lad det stå på **"Other"** (Vercel opdager selv `/api`-mappen
     som serverless functions og resten som statiske filer — ingen build-kommando nødvendig).
   - Giv det et nyt, unikt projektnavn, fx `brokkekassen` — ikke samme navn som Twiin.
3. **Uden git:** du kan også trække mappen direkte ind på vercel.com under
   "Deploy" → "Drag and drop", hvis du ikke vil bruge GitHub.
4. **Tilføj database (Upstash Redis):** inde i det nye projekt → fanen **"Storage"**
   → **"Create Database"** → vælg **Upstash → Redis** (der er et gratis niveau,
   rigeligt til dette). Vercel forbinder den automatisk til *kun dette projekt* og
   sætter selv miljøvariablerne `UPSTASH_REDIS_REST_URL` og
   `UPSTASH_REDIS_REST_TOKEN` — du skal ikke selv skrive noget.
5. **Deploy.** Du får en URL, fx `brokkekassen.vercel.app`.
6. Åbn URL'en → tryk **"Opret ny brokkekasse"** → skriv dit navn → kopiér linket
   der vises, og send det i familiens gruppechat. Alle der åbner linket, skriver
   bare deres eget navn og er med — ingen kode, ingen login.

## Hvordan identitet virker
Man genkendes på navn (case-insensitive) inden for samme brokkekasse-link. Åbner du
linket fra en anden telefon og skriver samme navn igen, bliver du genkendt som den
samme person i regnskabet i stedet for at oprette en dublet. Dit navn gemmes lokalt
på telefonen, så du ikke skal skrive det igen næste gang du åbner linket.

## Installér på telefonen
- iPhone (Safari): Del-ikon → "Føj til hjemmeskærm"
- Android (Chrome): menu (⋮) → "Installér app"

## Hvad koster det?
Vercel Hobby-plan og Upstash's gratis niveau er rigeligt til en familie i et par
uger — 0 kr.

## Filer
- `index.html`, `manifest.json`, `sw.js`, `icon.svg` — appen (statiske filer)
- `api/*.js` — de fem serverless-endpoints (room, join, state, brok, vote, cancel, settle)
- `api/_lib/` — delt Redis-forbindelse og state-logik
- `package.json` — eneste dependency er `@upstash/redis`
