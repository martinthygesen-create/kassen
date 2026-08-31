#!/usr/bin/env node
// Dommer, Del A — deterministisk validator for ét kasse-tema (se
// god-finding-men-du-lovely-zephyr.md, "Dommer-mekanisme"-afsnittet).
//
// FORMÅL: ingen fase i byggerækkefølgen må erklæres færdig for et nyt
// tema uden at bestå dette script. Ingen fortolkning her — kun hårde,
// deterministiske gates. Del B (håndværks-/UX-kvalitet) er bevidst IKKE
// her, den kræver menneskelig/Claude-selv-review, se planen.
//
// BRUG:
//   node scripts/validate-theme.js <themeId>
//   node scripts/validate-theme.js --all      (kører mod alle kendte temaer)
//
// Exit code 0 = bestået, 1 = fejl fundet (til brug i et autonomt loop).

const path = require('path');
const mrbrok = require(path.join(__dirname, '..', 'api', '_lib', 'mrbrok'));
const complainer = require(path.join(__dirname, '..', 'api', '_lib', 'complainer'));
const game = require(path.join(__dirname, '..', 'api', '_lib', 'game'));

// Minimum-pulje-størrelser — konkrete tærskler, jf. planens løfte om at
// dette IKKE må forblive et princip uden tal. Baseret på brok-originalens
// egne størrelser som facit (20 mrbrok-emner, 10 arketyper, 19 prompts,
// 12 quiplash-prompts osv.) skaleret ned til et forsvarligt minimum, ikke
// et krav om at matche originalen 1:1 — se hver konstants egen kommentar
// i mrbrok.js/complainer.js/game.js for hvor Bødekassen selv ligger.
const MIN = {
  mrbrokTopics: 8,     // MIN_TOPIC_GAP = ceil(n*0.6) — under 8 føles rotationen hurtigt gentagen
  mrbrokClueTips: 3,
  archetypes: 5,
  situations: 2,
  prompts: 6,
  quiplashPrompts: 6,
  quiplashDecoys: 6,
  worldTrivia: 1,      // se formåls-tema-note: FAKTUEL pulje, størrelse < indhold der er sikkert korrekt
  worldTrueFalse: 1,
  decoyBrok: 6,
};

function fail(list, msg) { list.push(msg); }

// --- MrBrok-indhold (api/_lib/mrbrok.js) ---
function checkMrbrok(themeId, errors, warnings) {
  const mb = mrbrok.CONTENT_BY_THEME[themeId];
  if (!mb) { warnings.push(`[mrbrok] intet indhold for '${themeId}' — falder tilbage til 'brok' i produktion, ikke en fejl i sig selv, men bør have eget indhold før levering`); return; }
  if (!mb.mrbrokTopics || mb.mrbrokTopics.length < MIN.mrbrokTopics) fail(errors, `[mrbrok] mrbrokTopics: ${mb.mrbrokTopics ? mb.mrbrokTopics.length : 0} stk, minimum ${MIN.mrbrokTopics}`);
  if (!mb.mrbrokClueTips || mb.mrbrokClueTips.length < MIN.mrbrokClueTips) fail(errors, `[mrbrok] mrbrokClueTips: ${mb.mrbrokClueTips ? mb.mrbrokClueTips.length : 0} stk, minimum ${MIN.mrbrokClueTips}`);
  if (!mb.gameName || typeof mb.gameName !== 'string') fail(errors, `[mrbrok] gameName mangler eller er ikke en streng`);
  // Ingen lækket "brok"/"MrBrok"/"Brokkekassen"-streng i et FREMMED temas eget indhold
  if (themeId !== 'brok' && mb.mrbrokTopics) {
    mb.mrbrokTopics.forEach((t, i) => {
      if (/\bbrok\w*/i.test(t) && !/bødekasse|bødespil/i.test(t)) fail(errors, `[mrbrok] mrbrokTopics[${i}] indeholder muligvis lækket brok-sprog: "${t}"`);
    });
  }
}

// --- Det Store Brokkeri-indhold (api/_lib/complainer.js) ---
function checkComplainer(themeId, errors, warnings) {
  const c = complainer.CONTENT_BY_THEME[themeId];
  if (!c) { warnings.push(`[complainer] intet indhold for '${themeId}' — falder tilbage til 'brok'`); return; }
  if (!c.archetypes || c.archetypes.length < MIN.archetypes) fail(errors, `[complainer] archetypes: ${c.archetypes ? c.archetypes.length : 0} stk, minimum ${MIN.archetypes}`);
  if (!c.situations || c.situations.length < MIN.situations) fail(errors, `[complainer] situations: ${c.situations ? c.situations.length : 0} stk, minimum ${MIN.situations}`);
  if (!c.prompts || c.prompts.length < MIN.prompts) fail(errors, `[complainer] prompts: ${c.prompts ? c.prompts.length : 0} stk, minimum ${MIN.prompts}`);
  if (!c.gameName || typeof c.gameName !== 'string') fail(errors, `[complainer] gameName mangler eller er ikke en streng`);
  // Håndværks-spec, Del A's grænse af det der KAN tjekkes deterministisk:
  // hver arketype skal have id, name, promptHook (der slutter på tankestreg,
  // se composePromptText's grammatik-antagelse) og MINDST 2 instructions.
  // Selve INDHOLDS-kvaliteten (er instruktionerne konkrete nok?) er Del B.
  if (c.archetypes) {
    c.archetypes.forEach((a, i) => {
      if (!a.id || !a.name || !a.promptHook) fail(errors, `[complainer] archetypes[${i}] mangler id/name/promptHook`);
      if (a.promptHook && !a.promptHook.trim().endsWith('—')) fail(errors, `[complainer] archetypes[${i}].promptHook slutter ikke på tankestreg (bryder composePromptText's sammensætnings-grammatik)`);
      if (!a.instructions || a.instructions.length < 2) fail(errors, `[complainer] archetypes[${i}] har under 2 instructions`);
    });
  }
  // Hver situations-kategori i COMPLAINER_SITUATIONS skal have mindst ét
  // prompt der matcher den (ellers kan pickPromptFor aldrig ramme den
  // kategori for en spiller tildelt netop den situation).
  if (c.situations && c.prompts) {
    c.situations.forEach(sit => {
      if (!c.prompts.some(p => p.category === sit)) fail(errors, `[complainer] situation '${sit}' har intet matchende prompt (category === '${sit}')`);
    });
  }
}

// --- Brokspillet-indhold + trivia-skabeloner (api/_lib/game.js) ---
function checkGame(themeId, errors, warnings) {
  const g = game.CONTENT_BY_THEME[themeId];
  if (!g) { warnings.push(`[game] intet indhold for '${themeId}' — falder tilbage til 'brok'`); return; }
  if (!g.quiplashPrompts || g.quiplashPrompts.length < MIN.quiplashPrompts) fail(errors, `[game] quiplashPrompts: ${g.quiplashPrompts ? g.quiplashPrompts.length : 0} stk, minimum ${MIN.quiplashPrompts}`);
  if (!g.winnerTauntPrompts || !g.winnerTauntPrompts.length) fail(errors, `[game] winnerTauntPrompts mangler (må gerne genbruge brok-varianten, den er allerede tema-agnostisk)`);
  if (!g.quiplashDecoys || g.quiplashDecoys.length < MIN.quiplashDecoys) fail(errors, `[game] quiplashDecoys: ${g.quiplashDecoys ? g.quiplashDecoys.length : 0} stk, minimum ${MIN.quiplashDecoys}`);
  if (!g.worldTrivia || g.worldTrivia.length < MIN.worldTrivia) fail(errors, `[game] worldTrivia: ${g.worldTrivia ? g.worldTrivia.length : 0} stk, minimum ${MIN.worldTrivia}`);
  if (!g.worldTrueFalse || g.worldTrueFalse.length < MIN.worldTrueFalse) fail(errors, `[game] worldTrueFalse: ${g.worldTrueFalse ? g.worldTrueFalse.length : 0} stk, minimum ${MIN.worldTrueFalse}`);
  if (!g.decoyBrok || g.decoyBrok.length < MIN.decoyBrok) fail(errors, `[game] decoyBrok: ${g.decoyBrok ? g.decoyBrok.length : 0} stk, minimum ${MIN.decoyBrok}`);
  if (!g.gameName || typeof g.gameName !== 'string') fail(errors, `[game] gameName mangler eller er ikke en streng`);
  // quiplashPrompts skal indeholde {target}-pladsholderen, ellers crasher
  // pickQuiplashPrompt's .replace() stille (ingen fejl, bare et forkert
  // spørgsmål uden nogens navn indsat).
  if (g.quiplashPrompts) {
    g.quiplashPrompts.forEach((p, i) => {
      if (!p.includes('{target}')) fail(errors, `[game] quiplashPrompts[${i}] mangler {target}-pladsholder: "${p}"`);
    });
  }
  // worldTrivia/worldTrueFalse: struktur-tjek (Del A kan IKKE tjekke om
  // fakta er sande — det er en menneskelig/Del B-opgave, se
  // WORLD_TRIVIA_BODE's egen kommentar i game.js).
  if (g.worldTrivia) {
    g.worldTrivia.forEach((item, i) => {
      if (!item.question || !item.correct || !Array.isArray(item.distractors) || !item.distractors.length) {
        fail(errors, `[game] worldTrivia[${i}] mangler question/correct/distractors`);
      }
    });
  }

  // Spørgsmåls-skabeloner
  const t = game.QUESTION_TEMPLATES_BY_THEME[themeId];
  if (!t) { warnings.push(`[game] ingen QUESTION_TEMPLATES_BY_THEME for '${themeId}' — falder tilbage til 'brok's grammatik, sandsynligvis forkert for et andet tema`); return; }
  ['mostCount', 'fewestCount', 'totalCount', 'longestStreak', 'memberCountFallback'].forEach(key => {
    if (!t[key] || typeof t[key] !== 'string') fail(errors, `[game] QUESTION_TEMPLATES_BY_THEME.${themeId}.${key} mangler eller er ikke en streng`);
  });
  ['quoteWho', 'quoteWhich'].forEach(key => {
    if (typeof t[key] !== 'function') fail(errors, `[game] QUESTION_TEMPLATES_BY_THEME.${themeId}.${key} mangler eller er ikke en funktion`);
  });
}

// --- Formåls-tema-harness: cross-cutting koherens (den tredje port, se
// planen). Del A kan kun tjekke det STRUKTURELT deterministiske — resten
// (matcher tonen faktisk toneRegister?) er Del B/menneskelig review. Ét
// deterministisk tjek ER muligt her: at gameName rent faktisk ER
// tema-specifikt, ikke en kopi af brok-variantens navn ved en fejl. ---
function checkThemeIdentityNotLeaked(themeId, errors) {
  if (themeId === 'brok') return;
  const names = [
    mrbrok.CONTENT_BY_THEME[themeId] && mrbrok.CONTENT_BY_THEME[themeId].gameName,
    complainer.CONTENT_BY_THEME[themeId] && complainer.CONTENT_BY_THEME[themeId].gameName,
    game.CONTENT_BY_THEME[themeId] && game.CONTENT_BY_THEME[themeId].gameName,
  ];
  const brokNames = ['MrBrok', 'Det Store Brokkeri', 'Brokspillet'];
  names.forEach((n, i) => {
    if (n && brokNames.includes(n)) fail(errors, `[formåls-tema] spil #${i} for tema '${themeId}' bruger stadig brok-variantens gameName ('${n}') — ikke reskinnet`);
  });
}

function validateTheme(themeId) {
  const errors = [];
  const warnings = [];
  checkMrbrok(themeId, errors, warnings);
  checkComplainer(themeId, errors, warnings);
  checkGame(themeId, errors, warnings);
  checkThemeIdentityNotLeaked(themeId, errors);
  return { themeId, errors, warnings };
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Brug: node scripts/validate-theme.js <themeId> | --all');
    process.exit(1);
  }
  const themeIds = arg === '--all'
    ? [...new Set([...Object.keys(mrbrok.CONTENT_BY_THEME), ...Object.keys(complainer.CONTENT_BY_THEME), ...Object.keys(game.CONTENT_BY_THEME)])]
    : [arg];

  let anyFailed = false;
  themeIds.forEach(themeId => {
    const { errors, warnings } = validateTheme(themeId);
    console.log(`\n=== Tema: ${themeId} ===`);
    if (!errors.length) console.log('  ✅ Bestået (Del A, deterministisk)');
    errors.forEach(e => console.log(`  ❌ ${e}`));
    warnings.forEach(w => console.log(`  ⚠️  ${w}`));
    if (errors.length) anyFailed = true;
  });
  console.log('');
  process.exit(anyFailed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { validateTheme, MIN };
