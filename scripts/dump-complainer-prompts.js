#!/usr/bin/env node
// Hjælpe-værktøj (Martins fund: "svært at teste med bots, men se
// resultatet ... og tjek spil logik ud" — garblede sammensatte sætninger
// som "med en kunde i stormen og et øre" i Sladrefælden). Dumper den
// FAKTISKE, sammensatte prompt-tekst (arketype-hook + situationel prompt,
// se composePromptText i _lib/complainer.js) for EVERY arketype × EVERY
// prompt i et givent (eller alle) skin — ikke kun de tilfældige
// kombinationer et enkelt spil rammer — så hele kombinationsrummet kan
// læses igennem for grammatiske/tematiske sammenstød.
//
// BRUG:
//   node scripts/dump-complainer-prompts.js <themeId>
//   node scripts/dump-complainer-prompts.js --all

const path = require('path');
const complainer = require(path.join(__dirname, '..', 'api', '_lib', 'complainer'));
const { SKIN_REGISTRY } = require(path.join(__dirname, '..', 'api', '_lib', 'themeRegistry'));

function dumpTheme(themeId) {
  const entry = SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
  if (!entry.allowedGames.includes('complainer')) return;
  const c = complainer.getThemeContent(themeId);
  console.log(`\n${'='.repeat(70)}\n${themeId} (${c.gameName})\n${'='.repeat(70)}`);
  c.archetypes.forEach(a => {
    console.log(`\n--- ${a.name} (${a.id}) ---`);
    console.log(`  hook: "${a.promptHook}"`);
    c.prompts.forEach(p => {
      const composed = complainer.composePromptText(a.id, p.text, themeId);
      console.log(`  [${p.category}/t${p.tier}] ${composed}`);
    });
  });
}

function main() {
  const arg = process.argv[2];
  const themeIds = (!arg || arg === '--all') ? Object.keys(SKIN_REGISTRY) : [arg];
  themeIds.forEach(dumpTheme);
}

if (require.main === module) main();
