const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error('Mangler VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:brokkekassen@example.com', publicKey, privateKey);
  configured = true;
}

// web-push's VAPID JWT-signering (via ecdsa-sig-formatter) rammer sjældent
// (~1 ud af nogle hundrede) en DER-encoding-edge-case og fejler med noget i
// stil med '"ES256" signatures must be "64" bytes, saw "..."'. Det er ikke
// vores nøgle der er forkert — et nyt signeringsforsøg bruger et nyt
// tilfældigt nonce og rammer stort set aldrig samme edge-case to gange i
// træk, så vi prøver bare igen et par gange.
async function sendWithRetry(sub, json, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await webpush.sendNotification(sub, json); }
    catch (err) { lastErr = err; }
  }
  throw lastErr;
}

// Sender en push til alle medlemmer i pushSubs undtagen dem i excludeIds.
// Fejlende (fx udløbne) subscriptions fjernes stille fra state.
async function pushToMembers(state, excludeIds, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  ensureConfigured();
  const subs = state.pushSubs || {};
  const json = JSON.stringify(payload);
  const results = await Promise.allSettled(
    Object.entries(subs)
      .filter(([memberId]) => !excludeIds.includes(memberId))
      .map(([memberId, sub]) => sendWithRetry(sub, json).catch(err => { throw { memberId, err }; }))
  );
  results.forEach(r => {
    if (r.status === 'rejected' && r.reason && r.reason.memberId && (r.reason.err.statusCode === 404 || r.reason.err.statusCode === 410)) {
      delete state.pushSubs[r.reason.memberId];
    }
  });
}

module.exports = { pushToMembers };
