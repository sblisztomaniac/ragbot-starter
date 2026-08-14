/**
 * Discriminating test for the Upstash Vector knowledge base.
 *
 * Fires real /query-data queries (raw text -> built-in embedding -> search) with NO score
 * filter, and prints score + title + preview for each hit. Use the printed scores to choose
 * a sensible UPSTASH_SCORE_THRESHOLD (set it just below the score of results you judge relevant).
 *
 * Run: node scripts/testUpstash.js
 */
require('dotenv').config();
const fetch = require('node-fetch');

const URL = process.env.UPSTASH_VECTOR_REST_URL;
const TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN;
const NS = process.env.UPSTASH_NAMESPACE || '';

if (!URL || !TOKEN) {
  console.error('❌ Missing UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN in .env');
  process.exit(1);
}

const QUERIES = [
  'what does Lao Tzu say about relinquishing power',
  'meditation and consciousness',
  'who am I / self-inquiry',
  'flibbertigibbet quantum toaster', // deliberate nonsense — shows the noise-floor score
];

function queryPath() {
  return NS ? `/query-data/${encodeURIComponent(NS)}` : '/query-data';
}

async function run(q) {
  const res = await fetch(`${URL}${queryPath()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ data: q, topK: 5, includeMetadata: true, includeData: true }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.log(`\n❓ "${q}"\n   ❌ HTTP ${res.status}: ${body}`);
    return;
  }
  const json = JSON.parse(body);
  const results = json.result || [];
  console.log(`\n❓ "${q}"  -> ${results.length} hits`);
  results.forEach((r, i) => {
    const title = r.metadata?.title || '(no title)';
    const preview = (r.data || '').replace(/\s+/g, ' ').slice(0, 90);
    console.log(`   ${i + 1}. score=${(r.score ?? 0).toFixed(4)}  ${title}`);
    console.log(`      ${preview}...`);
  });
}

(async () => {
  console.log(`🔎 Testing Upstash namespace "${NS || '(default)'}"`);
  for (const q of QUERIES) await run(q);
  console.log('\n💡 Set UPSTASH_SCORE_THRESHOLD just below the score of relevant hits,');
  console.log('   and above the nonsense-query score.');
})();
