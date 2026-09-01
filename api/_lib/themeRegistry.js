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
  venne: {
    confirmationModel: 'quorum', poolPolarity: 'punishment',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
  rose: {
    confirmationModel: 'quorum', poolPolarity: 'reward',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
  drik: {
    confirmationModel: 'quorum', poolPolarity: 'punishment',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
  // Konkurrencekasse-motoren (se planen: "Konkurrencekassen var fejlagtigt
  // puttet ind som navne-preset på Gruppekasse-motoren... løbende ranking er
  // naturligt reward-polaritet"). Eneste kurateret skin med
  // poolPolarity:'reward' — dækker den kombination Dommeren ellers aldrig
  // ville se afprøvet i praksis, se scripts/test_pool_polarity.js.
  konkurrence: {
    confirmationModel: 'quorum', poolPolarity: 'reward',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
  // Løgnerkasse-motoren (se KASSEMOTORPLAN.md's klassifikations-tabel):
  // Brokspillet ('spil') UDELUKKES bevidst — quiplash/rose kræver "roast en
  // navngiven person", som ikke passer et løgner-domæne. MrBrok/Det Store
  // Brokkeris "afslør hvem der ikke passer ind"-mekanik er derimod en
  // BEDRE match her end til original brok.
  logn: {
    confirmationModel: 'quorum', poolPolarity: 'punishment',
    mechanic: 'suspicion-vote', toneRegister: 'playful',
    allowedGames: ['mrbrok', 'complainer'],
  },
  // Godkendelseskasse-motoren (se planen: Hjælperkassen — magt-asymmetri i
  // et ansættelsesforhold gør "udpeg en skyldig i gruppen" (MrBrok)
  // socialt farligt, og Brokspillets person-roast passer heller ikke.
  // KUN Det Store Brokkeri, og kun i dæmpet arketype-form (ren arbejdsstil,
  // aldrig en navngiven reel person som skurk, se complainer.js's
  // COMPLAINER_ARCHETYPES_HJAELPER). host-approval matcher at én leder
  // typisk godkender krukke-hændelser i et sådant forhold.
  hjaelper: {
    confirmationModel: 'host-approval', poolPolarity: 'punishment',
    mechanic: 'host-judged', toneRegister: 'serious',
    allowedGames: ['complainer'],
  },
};

function getThemeRegistryEntry(themeId) {
  return SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
}

module.exports = { SKIN_REGISTRY, getThemeRegistryEntry };
