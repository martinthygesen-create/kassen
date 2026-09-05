#!/usr/bin/env node
// Tematisk-fit-auditor ("Dommer, Del B" — se scripts/validate-theme.js's
// egen kommentar om at håndværks-/UX-kvalitet bevidst IKKE er dækket der,
// "kræver menneskelig/Claude-selv-review"). Denne fil er det forsøg: en
// DETERMINISTISK heuristik der finder KANDIDATER til tematisk mismatch —
// ikke en erstatning for at spille/læse indholdet selv, men et første,
// gentageligt filter, så samme fejlklasse (Konkurrencekassens "praler du
// til"-regex, Bødespillets delte Brokspillet-trivia, Bødefældens
// "brokker dig"-reaktionsverb på et undskyldnings-tema) fanges FØR
// levering, ikke først ved en rigtig spilaften.
//
// Rører KUN _lib/mrbrok.js, _lib/complainer.js, _lib/game.js's INDHOLD
// (emner/arketyper/prompts/trivia) — aldrig *Flow.js (selve spil-flowet).
// Enhver fejl denne fil finder kan derfor rettes UDEN motor-ændring, kun
// tekst i disse tre filers CONTENT_BY_THEME-puljer.
//
// TO SLAGS FUND:
//  1) ORD-LÆKAGE: et andet skins "kerne-mekanik-ord" (fx "brokke" i et
//     tema der ikke er brok/venne/drik) optræder i teksten. Ikke 100%
//     pålideligt alene — "fremfor at brokke dig" er fx en BEVIDST
//     negation, ikke en lækage — så hvert fund vises MED kontekst, til et
//     menneske/Claude at vurdere, ikke en blind fail.
//  2) ORDRET GENBRUG: et skins pulje deler for mange IDENTISKE linjer med
//     brok's egen pulje (samme indhold, kun teknisk "tagget" til flere
//     temaer, eller kopieret ind uden reel tilpasning) — tærsklen er sat
//     over de par generiske scaffolding-linjer (fx clue-tippet "Hold
//     svaret kort...") der er BEVIDST delt ordret på tværs af alle temaer.
//
// BRUG:
//   node scripts/audit-theme-fit.js            (alle skins)
//   node scripts/audit-theme-fit.js <themeId>   (ét skin)

const path = require('path');
const mrbrok = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrok'));
const complainer = require(path.join(__dirname, '..', 'api', '_lib', 'complainer'));
const game = require(path.join(__dirname, '..', 'api', '_lib', 'game'));
const { SKIN_REGISTRY } = require(path.join(__dirname, '..', 'api', '_lib', 'themeRegistry'));

// Hvert skins eget "kerne-mekanik-ord" (den REAKTION/HANDLING spilleren
// bliver bedt om at gøre) — brugt til at opdage hvornår ET ANDET skins ord
// er sivet ind. 'venne' og 'drik' er bevidst UDELADT fra "ejer" listen for
// 'brok'-stammen (se CLAUDE.md/commit-historik: begge er selv reelt
// klage-domæner, "brokker dig" passer dem lige så godt som brok selv) —
// de optræder derfor ikke som "fremmed" for hinanden eller for brok.
// BEVIDST IKKE 'rose':/ros\w*/ eller 'bode':/undskyld\w*/ her — afprøvet,
// men "ros"/"roser" og "undskyldning" er for almindelige danske ord i sig
// selv (enhver skin kan naturligt nævne at nogen "roser" nogen, eller
// finde "en undskyldning") til at være et pålideligt lækage-signal —
// gav kun støj, ingen reelle fund, ved første kørsel. Kun ord der er
// tilstrækkeligt SÆREGNE til et bestemt tema er med.
const MECHANIC_WORD = {
  brok: /\bbrok\w*/i,
  venne: /\bbrok\w*/i,
  drik: /\bbrok\w*/i,
  sladre: /\bsladr\w*/i,
  konkurrence: /\bpral\w*/i,
  logn: /\b(løgn\w*|lyv\w*|løj)\b/i,
};
// Skins der deler et BEVIDST, dokumenteret tematisk overlap (se
// api/_lib/game.js's THEME_TRIVIA-header) — tjekkes IKKE mod hinandens
// mekanik-ord.
const SHARED_MECHANIC_GROUPS = [
  new Set(['brok', 'venne', 'drik']), // "afgift/regel"... nej, reelt: samme klage-domæne
  new Set(['sladre', 'logn']), // "sandhed/afsløring"-overlap
];
function foreignMechanicChecks(themeId) {
  return Object.entries(MECHANIC_WORD).filter(([ownerId, re]) => {
    if (!re || ownerId === themeId) return false;
    if (SHARED_MECHANIC_GROUPS.some(g => g.has(ownerId) && g.has(themeId))) return false;
    return true;
  });
}

// Kendte, BEVIDST negerede/eksplicit-kontrasterende brugsmønstre — et fund
// der matcher en af disse er IKKE en lækage, men et bevidst modsætnings-
// signal (fx "fremfor at brokke dig" i hjaelper's professionelle tone).
// Holdt som en simpel "står ordet 'fremfor'/'i stedet for'/'ikke' lige før
// det fundne ord"-heuristik, ikke en fuld sprogmodel — false negatives
// (en reel lækage der tilfældigvis også har et af disse ord i nærheden)
// er mere sandsynlige end false positives her, så et menneske bør stadig
// skimme rapporten, ikke kun stole blindt på grøn.
function looksNegated(haystack, matchIndex) {
  const before = haystack.slice(Math.max(0, matchIndex - 40), matchIndex).toLowerCase();
  return /(fremfor at|i stedet for at|ikke|aldrig|frem for at)\s*$/.test(before.trim() + ' ');
}

function findLeaks(themeId, label, entries) {
  const findings = [];
  const checks = foreignMechanicChecks(themeId);
  entries.forEach(({ text, ref }) => {
    if (!text) return;
    checks.forEach(([ownerId, re]) => {
      const re2 = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = re2.exec(text))) {
        if (looksNegated(text, m.index)) continue; // bevidst kontrast, ikke lækage
        findings.push({ label, ref, ownerId, word: m[0], context: text });
      }
    });
  });
  return findings;
}

// Ordret genbrug: hvor mange linjer i et skins pulje findes BOGSTAVELIGT
// (efter trim) i brok's egen pulje af samme indholdstype? Et par delte
// generiske scaffolding-linjer er forventet og fint (se filens header) —
// tærsklen ligger bevidst højt (>60%) for kun at ramme reel "delt pulje
// uden tilpasning", ikke enkelte bevidst genbrugte hjælpelinjer.
function overlapWithBrok(themeId, label, ownItems, brokItems) {
  if (themeId === 'brok' || !ownItems.length || !brokItems || !brokItems.length) return null;
  const brokSet = new Set(brokItems.map(s => s.trim()));
  const shared = ownItems.filter(s => brokSet.has(s.trim()));
  const ratio = shared.length / ownItems.length;
  if (ratio > 0.6) {
    return { label, ratio, sharedCount: shared.length, total: ownItems.length, sample: shared.slice(0, 3) };
  }
  return null;
}

function auditMrbrok(themeId) {
  const entry = SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
  if (!entry.allowedGames.includes('mrbrok')) return { skipped: 'mrbrok ikke tilladt for dette skin' };
  const c = mrbrok.getThemeContent(themeId);
  const brokC = mrbrok.getThemeContent('brok');
  const leakEntries = [
    ...c.mrbrokTopics.map(t => ({ text: t, ref: 'mrbrokTopics' })),
    ...c.mrbrokClueTips.map(t => ({ text: t, ref: 'mrbrokClueTips' })),
  ];
  const leaks = findLeaks(themeId, 'mrbrok', leakEntries);
  const overlaps = [
    overlapWithBrok(themeId, 'mrbrok.mrbrokTopics', c.mrbrokTopics, brokC.mrbrokTopics),
    overlapWithBrok(themeId, 'mrbrok.mrbrokClueTips', c.mrbrokClueTips, brokC.mrbrokClueTips),
  ].filter(Boolean);
  return { leaks, overlaps, gameName: c.gameName };
}

function auditComplainer(themeId) {
  const entry = SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
  if (!entry.allowedGames.includes('complainer')) return { skipped: 'complainer ikke tilladt for dette skin' };
  const c = complainer.getThemeContent(themeId);
  const brokC = complainer.getThemeContent('brok');
  const leakEntries = [
    ...c.archetypes.flatMap(a => [
      { text: a.name, ref: `complainer.archetypes[${a.id}].name` },
      { text: a.promptHook, ref: `complainer.archetypes[${a.id}].promptHook` },
      ...(a.instructions || []).map(i => ({ text: i, ref: `complainer.archetypes[${a.id}].instructions` })),
    ]),
    ...c.prompts.map(p => ({ text: p.text, ref: `complainer.prompts[${p.id}]` })),
  ];
  const leaks = findLeaks(themeId, 'complainer', leakEntries);
  const overlaps = [
    overlapWithBrok(themeId, 'complainer.prompts (rå tekst)', c.prompts.map(p => p.text), brokC.prompts.map(p => p.text)),
    overlapWithBrok(themeId, 'complainer.archetypes.instructions',
      c.archetypes.flatMap(a => a.instructions || []),
      brokC.archetypes.flatMap(a => a.instructions || [])),
  ].filter(Boolean);
  return { leaks, overlaps, gameName: c.gameName };
}

function auditGame(themeId) {
  const entry = SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
  if (!entry.allowedGames.includes('spil')) return { skipped: "'spil' ikke tilladt for dette skin" };
  const c = game.getThemeContent(themeId);
  const brokC = game.getThemeContent('brok');
  const leakEntries = [
    ...(c.quiplashPrompts || []).map(t => ({ text: t, ref: 'quiplashPrompts' })),
    ...(c.quiplashDecoys || []).map(t => ({ text: t, ref: 'quiplashDecoys' })),
    ...(c.decoyBrok || []).map(t => ({ text: t, ref: 'decoyBrok' })),
    ...(c.worldTrivia || []).map(t => ({ text: t.question, ref: 'worldTrivia' })),
    ...(c.worldTrueFalse || []).map(t => ({ text: t.statement, ref: 'worldTrueFalse' })),
  ];
  const leaks = findLeaks(themeId, 'game', leakEntries);
  const overlaps = [
    overlapWithBrok(themeId, 'game.quiplashPrompts', c.quiplashPrompts || [], brokC.quiplashPrompts),
    overlapWithBrok(themeId, 'game.quiplashDecoys', c.quiplashDecoys || [], brokC.quiplashDecoys),
    overlapWithBrok(themeId, 'game.decoyBrok', c.decoyBrok || [], brokC.decoyBrok),
    overlapWithBrok(themeId, 'game.worldTrivia', (c.worldTrivia || []).map(t => t.question), (brokC.worldTrivia || []).map(t => t.question)),
  ].filter(Boolean);
  return { leaks, overlaps, gameName: c.gameName };
}

function printReport(themeId) {
  console.log(`\n=== Tematisk-fit-audit: ${themeId} ===`);
  const results = {
    mrbrok: auditMrbrok(themeId),
    complainer: auditComplainer(themeId),
    spil: auditGame(themeId),
  };
  let anyIssue = false;
  Object.entries(results).forEach(([game_, r]) => {
    if (r.skipped) { console.log(`  · ${game_}: ${r.skipped}`); return; }
    console.log(`  · ${game_} ("${r.gameName}")`);
    if (!r.leaks.length && !r.overlaps.length) {
      console.log('      ✅ ingen kandidater fundet');
      return;
    }
    r.leaks.forEach(f => {
      anyIssue = true;
      console.log(`      ⚠️  ORD-LÆKAGE: "${f.word}" (tilhører '${f.ownerId}') i ${f.ref}`);
      console.log(`          "${f.context}"`);
    });
    r.overlaps.forEach(o => {
      anyIssue = true;
      console.log(`      ⚠️  ORDRET GENBRUG: ${o.label} deler ${o.sharedCount}/${o.total} linjer (${Math.round(o.ratio * 100)}%) ordret med brok — ikke tilpasset temaet:`);
      o.sample.forEach(s => console.log(`          "${s}"`));
    });
  });
  if (!anyIssue) console.log('  ✅ Ingen fund for dette skin — ingen indholds-ændring identificeret som nødvendig.');
  return anyIssue;
}

function main() {
  const arg = process.argv[2];
  const themeIds = arg ? [arg] : Object.keys(SKIN_REGISTRY);
  let anyIssueTotal = false;
  themeIds.forEach(id => { if (printReport(id)) anyIssueTotal = true; });
  console.log(`\n${anyIssueTotal ? '⚠️  Fund at vurdere ovenfor' : '✅ Ingen kandidater fundet i nogen skin'} — husk: dette er kandidater til MENNESKELIG/Claude-vurdering (se filens header), ikke en hård pass/fail-gate som validate-theme.js. Alt denne fil kan finde rettes uden motor-ændring (kun indhold i _lib/mrbrok.js/_lib/complainer.js/_lib/game.js).\n`);
  process.exit(0); // bevidst altid exit 0 — dette er et review-værktøj, ikke en CI-gate
}

if (require.main === module) main();
module.exports = { auditMrbrok, auditComplainer, auditGame };
