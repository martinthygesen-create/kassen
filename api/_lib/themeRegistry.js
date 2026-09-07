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
  // Godkendelseskasse-motoren (se planen: Kollegakassen — magt-asymmetri i
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
  // Kendekassen (Opus-review, kvalitet/sjov/repeat-ness-plan): venne+hjaelper
  // slået sammen til ÉT skin med to kreds-varianter, valgt ved oprettelse —
  // "man KENDER dem" (Martins navn/begrundelse), ikke "kassen kender noget".
  // Implementeret som to ADSKILTE themeId'er (kende_venner/kende_kolleger),
  // ikke et nyt tag-lag ovenpå det eksisterende system — genbruger dermed
  // 100% af den velafprøvede getThemeContent(themeId)-mønster resten af
  // kodebasen allerede bruger, i stedet for at true et parallelt
  // opslags-lag ind i syv filer. venne/hjaelper som RÅ themeId'er lever
  // uændret videre (eksisterende rum, se index.html's hiddenFromPicker).
  kende_venner: {
    confirmationModel: 'quorum', poolPolarity: 'punishment',
    mechanic: 'witness-confirm', toneRegister: 'playful',
    allowedGames: ['spil', 'mrbrok', 'complainer'],
  },
  // kolleger-varianten får (modsat det gamle hjaelper-skin) LOV til at
  // spille Brokspillet — men kun de rundetyper der ikke kræver at man
  // roaster en navngiven person (quiplash/rose udelukkes specifikt for
  // dette skin, se EXCLUDED_ROUND_TYPES_BY_THEME i _lib/game.js). MrBrok
  // holdes stadig udelukket — magt-asymmetri-begrundelsen for det står
  // uændret ved magt, se hjaelper ovenfor.
  kende_kolleger: {
    confirmationModel: 'host-approval', poolPolarity: 'punishment',
    mechanic: 'host-judged', toneRegister: 'serious',
    allowedGames: ['spil', 'complainer'],
  },
};

function getThemeRegistryEntry(themeId) {
  return SKIN_REGISTRY[themeId] || SKIN_REGISTRY.brok;
}

module.exports = { SKIN_REGISTRY, getThemeRegistryEntry };
