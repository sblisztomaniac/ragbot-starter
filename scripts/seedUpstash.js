/**
 * Seed Upstash Vector with the Transmutes knowledge base.
 *
 * Reads scripts/sample_data.json (53 docs), chunks each doc (~1000 chars, 200 overlap
 * to respect the bge-small-en-v1.5 ~512-token window), and upserts raw text to Upstash
 * via /upsert-data. Upstash embeds each chunk with the index's built-in model.
 *
 * Prereqs in .env:
 *   UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN
 *   UPSTASH_NAMESPACE (optional; blank = default namespace)
 * The Upstash index MUST be created with embedding model BAAI/bge-small-en-v1.5.
 *
 * Run: node scripts/seedUpstash.js
 */
require('dotenv').config();
const fetch = require('node-fetch');
const sampleData = require('./sample_data.json');

const URL = process.env.UPSTASH_VECTOR_REST_URL;
const TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN;
const NS = process.env.UPSTASH_NAMESPACE || '';

if (!URL || !TOKEN) {
  console.error('❌ Missing UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN in .env');
  process.exit(1);
}

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 25; // records per /upsert-data request

// Lightweight recursive-ish splitter: break near paragraph/newline/sentence/space
// boundaries, with overlap. Mirrors the repo's original 1000/200 splitter config.
function chunkText(text) {
  const clean = String(text).replace(/\r\n/g, '\n').trim();
  if (clean.length <= CHUNK_SIZE) return clean ? [clean] : [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const brk = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' ')
      );
      if (brk > CHUNK_SIZE - 300) end = start + brk + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function upsertPath() {
  return NS ? `/upsert-data/${encodeURIComponent(NS)}` : '/upsert-data';
}

async function upsertBatch(records) {
  const res = await fetch(`${URL}${upsertPath()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(records),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`upsert ${res.status}: ${body}`);
  return body;
}

async function main() {
  console.log('🚀 Seeding Upstash Vector');
  console.log(`   URL: ${URL}`);
  console.log(`   Namespace: ${NS || '(default)'}`);
  console.log(`   Docs: ${sampleData.length}\n`);

  // Build all chunk records
  const records = [];
  sampleData.forEach((doc, docIdx) => {
    const chunks = chunkText(doc.content || '');
    chunks.forEach((chunk, chunkIdx) => {
      records.push({
        id: `transmutes_${docIdx}_${chunkIdx}`,
        data: chunk,
        metadata: {
          title: (doc.title || '').trim() || `Document ${docIdx + 1}`,
          url: doc.url || '',
          source: 'transmutes_rag',
        },
      });
    });
  });

  console.log(`📦 Prepared ${records.length} chunks from ${sampleData.length} docs\n`);

  let stored = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    try {
      await upsertBatch(batch);
      stored += batch.length;
      console.log(`   ✅ Batch ${batchNum}: stored ${batch.length} (total ${stored}/${records.length})`);
    } catch (e) {
      console.error(`   ❌ Batch ${batchNum} failed: ${e.message}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n🎉 Done. Stored ${stored} chunks in Upstash namespace "${NS || '(default)'}".`);
  console.log('   Next: node scripts/testUpstash.js  (verify retrieval + pick a threshold)');
}

main().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
