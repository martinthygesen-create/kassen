const { Redis } = require('@upstash/redis');

let client = null;
function redis() {
  if (!client) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error('Mangler UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (eller KV_REST_API_URL / KV_REST_API_TOKEN) i Vercel Environment Variables.');
    }
    client = new Redis({ url, token });
  }
  return client;
}

module.exports = { redis };
