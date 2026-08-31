// Kasse-motor-generalisering: skabelon-registeret Dommeren dømmer FRA (se
// KASSEMOTORPLAN.md's "Dommer-mekanisme"-afsnit: "dommeren gætter ALDRIG
// hvilken motor-skabelon et frit navn hører til — den verificerer om en
// allerede MENNESKE-VALGT kombination er internt konsistent mod
// klassifikations-tabellen"). Dette er den tabel. Kilden til sandhed for de
// KURATEREDE skins (brok/bode/sladre) — "opret din egen" arver et af disse
// registre i stedet for at have sit eget (se index.html's custom-skin-flow).
//
// mechanicTags er struktureret metadata, ikke fri prosa (planens punkt:
// "Struktureret metadata er kilden, 'med småt'-teksten er kun en visning") —
// mechanic-værdien beskriver spillets KERNEMEKANIK for krukke-hændelser:
//   'witness-confirm' — andre skal have set/hørt det, kvorum bekræfter
//   'host-judged'     — én autoritet godkender alene
// toneRegister ('playful'|'serious') bruges af formåls-tema-harnesset til at
// tjekke at Chancen-visninger/pulje-fejring/persona-tone hænger sammen med
// skabelonens alvor — se planens "Formåls-tema-harness"-afsnit.
const SKIN_REGISTRY = {
  brok: {
    confirmationModel: 'quorum', poolPolarity: 'punishment',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
  bode: {
    confirmationModel: 'quorum', poolPolarity: 'punishment',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
  sladre: {
    confirmationModel: 'quorum', poolPolarity: 'punishment',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
};

function getThemeRegistryEntry(themeId) {
  return SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
}

module.exports = { SKIN_REGISTRY, getThemeRegistryEntry };
