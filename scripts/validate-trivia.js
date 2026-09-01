#!/usr/bin/env node
// Trivia & Dilemma-bank-validator (IMPLEMENTATION PROTOCOL: "DYNAMISK
// TRIVIA & DILEMMA-BANK") — samme "Dommer"-filosofi som
// scripts/validate-theme.js: ingen fortolkning, kun hårde, deterministiske
// gates, egnet til et autonomt loop (exit 0 = bestået, 1 = fejl fundet).
//
// BRUG:
//   node scripts/validate-trivia.js
//
// Verificerer:
//   1. Hvert af de 9 skins har >= 20 gyldige trivia-elementer
//      (getThemeContent(skinId).worldTrivia, se getTriviaForSkin i
//      api/_lib/game.js).
//   2. Hvert element har gyldig form: en spørgsmålstekst, ét korrekt svar,
//      og mindst 3 forskellige distraktorer (matcher buildOptions' brug).
//   3. Polaritets-grænsen overholdes: Rosekassen og Konkurrencekassen
//      (rene reward-skins) har NUL elementer med straf-/anklage-vinklet
//      sprog fra brok/bode-domænet lækket ind — "0 anklager i Rosekassen".

const path = require('path');
const game = require(path.join(__dirname, '..', 'api', '_lib', 'game'));

const SKINS = ['brok', 'bode', 'sladre', 'venne', 'rose', 'drik', 'konkurrence', 'logn', 'hjaelper'];
const MIN_PER_SKIN = 20;

// Polaritets-grænse: ord der signalerer brok/bode's straf-/anklage-vinkling
// (accusatory/punishment framing) — må ALDRIG optræde i de rene reward-
// skins' egne trivia-tekst. Bevidst en ordliste, ikke en fuld NLP-analyse —
// samme pragmatiske niveau som validate-theme.js's egne leak-checks.
const PUNISHMENT_LEAK_WORDS = /\bbrok(ke|ker|kede|keri)?\b|\bbøde(r|kasse)?\b|\banklag(e|et|er|ede)\b/i;
const REWARD_ONLY_SKINS = ['rose', 'konkurrence'];

function itemText(item) {
  return [item.question, item.correct, ...(item.distractors || [])].join(' ');
}

function main() {
  const errors = [];
  const warnings = [];
  const report = [];

  for (const skinId of SKINS) {
    const content = game.getThemeContent(skinId);
    const pool = content.worldTrivia || [];

    if (pool.length < MIN_PER_SKIN) {
      errors.push(`[${skinId}] kun ${pool.length} trivia-elementer, minimum ${MIN_PER_SKIN}`);
    }

    let invalidCount = 0;
    pool.forEach((item, i) => {
      if (!item.question || typeof item.question !== 'string' || !item.question.trim()) {
        errors.push(`[${skinId}] element[${i}] mangler gyldig question-tekst`);
        invalidCount++;
      }
      if (!item.correct || typeof item.correct !== 'string' || !item.correct.trim()) {
        errors.push(`[${skinId}] element[${i}] mangler gyldigt correct-svar`);
        invalidCount++;
      }
      if (!Array.isArray(item.distractors) || item.distractors.length < 3) {
        errors.push(`[${skinId}] element[${i}] har under 3 distraktorer (${item.distractors ? item.distractors.length : 0})`);
        invalidCount++;
      } else {
        const uniq = new Set(item.distractors);
        if (uniq.size !== item.distractors.length) {
          warnings.push(`[${skinId}] element[${i}] har duplikerede distraktorer`);
        }
        if (item.distractors.includes(item.correct)) {
          errors.push(`[${skinId}] element[${i}] har korrekt svar gentaget som distraktor`);
          invalidCount++;
        }
      }
    });

    // Polaritets-grænse — kun for de rene reward-skins.
    let leakCount = 0;
    if (REWARD_ONLY_SKINS.includes(skinId)) {
      pool.forEach((item, i) => {
        if (PUNISHMENT_LEAK_WORDS.test(itemText(item))) {
          errors.push(`[${skinId}] element[${i}] indeholder straf-/anklage-vinklet sprog (brok/bøde/anklage): "${item.question}"`);
          leakCount++;
        }
      });
    }

    report.push({ skinId, count: pool.length, invalidCount, leakCount });
  }

  console.log('=== Trivia & Dilemma-bank — validering pr. skin ===\n');
  for (const r of report) {
    const status = r.invalidCount === 0 && r.leakCount === 0 && r.count >= MIN_PER_SKIN ? '[PASSED]' : '[FAILED]';
    console.log(`${status} ${r.skinId.padEnd(12)} ${String(r.count).padStart(3)} elementer` + (r.invalidCount ? `, ${r.invalidCount} ugyldige` : '') + (r.leakCount ? `, ${r.leakCount} polaritets-lækager` : ''));
  }

  if (warnings.length) {
    console.log('\n--- Advarsler (blokerer ikke) ---');
    warnings.forEach(w => console.log('⚠️  ' + w));
  }

  if (errors.length) {
    console.log('\n--- Fejl ---');
    errors.forEach(e => console.log('❌ ' + e));
    console.log(`\n❌ [FAILED] ${errors.length} fejl fundet på tværs af ${SKINS.length} skins.`);
    process.exit(1);
  }

  console.log(`\n✅ [PASSED] Alle ${SKINS.length} skins har >= ${MIN_PER_SKIN} gyldige trivia-elementer, ingen polaritets-lækager.`);
  process.exit(0);
}

main();
