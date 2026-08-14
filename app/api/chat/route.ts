// Using node-fetch for Meta Llama API calls (avoiding OpenAI SDK undici timeout issues)
import nodeFetch from 'node-fetch';

// Note: Using node-fetch directly instead of OpenAI SDK to avoid undici timeout issues
// Note: Using ZeroDB's embedding API instead of loading transformers locally (to avoid Netlify timeout)

// Upstash Vector — serverless vector DB with built-in embeddings (BAAI/bge-small-en-v1.5).
// We send raw text via the /query-data endpoint and Upstash embeds it for us.
const UPSTASH_VECTOR_REST_URL = process.env.UPSTASH_VECTOR_REST_URL!;
const UPSTASH_VECTOR_REST_TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN!;
const UPSTASH_NAMESPACE = process.env.UPSTASH_NAMESPACE || ''; // '' = default namespace
const UPSTASH_TOP_K = parseInt(process.env.UPSTASH_TOP_K || '5');
// Min normalized similarity score (0-1). 0 = no filtering. Tune after seeding.
const UPSTASH_SCORE_THRESHOLD = parseFloat(process.env.UPSTASH_SCORE_THRESHOLD || '0');

export async function POST(req: Request) {
  try {
    const {messages, useRag, llm, similarityMetric} = await req.json();

    const latestMessage = messages[messages?.length - 1]?.content;

    // Server is authoritative about the model. Honor the client's dropdown choice only
    // if it's a model our provider (Groq) actually serves; otherwise fall back to
    // META_MODEL. This prevents stale browser localStorage (old Meta model names) from
    // sending an invalid model and breaking chat.
    const ALLOWED_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    const model = (typeof llm === 'string' && ALLOWED_MODELS.includes(llm))
      ? llm
      : (process.env.META_MODEL || 'llama-3.3-70b-versatile');

    let docContext = '';
    let sources: string[] = [];
    if (useRag) {
      console.log('🔍 Searching Upstash Vector knowledge base...');
      // /query-data embeds the raw text with the index's built-in model, then searches.
      // Namespace is part of the path; omit it to hit the default namespace.
      const nsPath = UPSTASH_NAMESPACE ? `/query-data/${UPSTASH_NAMESPACE}` : '/query-data';
      const searchResponse = await nodeFetch(`${UPSTASH_VECTOR_REST_URL}${nsPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${UPSTASH_VECTOR_REST_TOKEN}`,
        },
        body: JSON.stringify({
          data: latestMessage,
          topK: UPSTASH_TOP_K,
          includeMetadata: true, // default is false — required for source citations
          includeData: true,     // default is false — required or docContext is empty
        })
      });

      if (!searchResponse.ok) {
        const error = await searchResponse.text();
        // Vector store is unreachable / misconfigured — a real outage, not "no results".
        console.error(`❌ Upstash Vector unreachable: ${searchResponse.status} - ${error}`);
        return new Response(
          JSON.stringify({
            error: 'Knowledge base unavailable. I can only answer questions based on spiritual wisdom teachings from my knowledge base. Please try again in a moment.'
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      const searchResults = await searchResponse.json();
      let documents = (searchResults.result || []) as any[];

      // Upstash returns topK results sorted by score (0-1, higher = more similar).
      // Optionally drop weak matches below the configured threshold.
      if (UPSTASH_SCORE_THRESHOLD > 0) {
        documents = documents.filter((doc: any) => (doc.score ?? 0) >= UPSTASH_SCORE_THRESHOLD);
      }
      console.log(`✅ Retrieved ${documents.length} chunks (topK=${UPSTASH_TOP_K}, threshold=${UPSTASH_SCORE_THRESHOLD})`);

      if (documents.length > 0) {
        console.log('Top match score:', documents[0].score, 'title:', documents[0].metadata?.title);
      }

      if (documents.length === 0) {
        // Store reachable but nothing relevant — a legitimate empty result, not an outage.
        return new Response(
          "I apologize, but I couldn't find any relevant teachings in my knowledge base to answer your question. My responses are based solely on the spiritual wisdom teachings I have access to. Please try rephrasing your question or ask about topics related to meditation, self-inquiry, consciousness, or spiritual practice.",
          {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          }
        );
      }

      // Extract sources - show top 3-5 most relevant (titles from metadata)
      sources = documents.slice(0, 5).map((doc: any, idx: number) => {
        const md = doc.metadata || {};
        const metadataTitle = md.title || md.source || md.url;
        if (metadataTitle) return metadataTitle;

        const text = doc.data || '';
        const lines = text.split('\n').filter((l: string) => l.trim().length > 0);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 15 && trimmed !== '---' && !trimmed.startsWith('http')) {
            return trimmed.length > 50 ? trimmed.substring(0, 50) + '...' : trimmed;
          }
        }
        return `Source ${idx + 1}`;
      });

      docContext = `
        START CONTEXT
        ${documents.map((doc: any) => doc.data || '').join("\n\n---\n\n")}
        END CONTEXT
      `;
    }

    const ragPrompt = [
      {
        role: 'system',
        content: `You are a wise spiritual guide helping seekers explore ancient wisdom and enlightenment teachings. Format responses using markdown where applicable.

        CRITICAL INSTRUCTION: You MUST ONLY use the wisdom provided in the context below. DO NOT use any knowledge outside of the provided context. Your responses must be based exclusively on the teachings contained between START CONTEXT and END CONTEXT.

        ${docContext}

        Guidelines for Responses:
        - Base ALL responses on the provided context only - this is non-negotiable
        - Feel free to paraphrase, synthesize, and present the teachings in your own words
        - Combine insights from multiple sources in the context to create comprehensive answers
        - Draw connections between related teachings to provide deeper understanding
        - Use a compassionate, contemplative tone that honors these spiritual traditions
        - Format responses with markdown for clarity and readability
        - Make each response unique by presenting the wisdom in different ways while staying true to the source material
        - If appropriate, use metaphors or examples that are already present in the context
        - You can present the same teaching in different ways depending on how the question is asked

        IMPORTANT: Paraphrasing and synthesis are encouraged, but you must NEVER introduce concepts, ideas, or knowledge that don't exist in the context above. Every insight you share must be traceable back to the provided teachings.
      `,
      },
    ]

    // Clean messages - only keep role and content, remove any extra properties
    const cleanMessages = [...ragPrompt, ...messages].map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    console.log('Sending to Groq:', JSON.stringify({
      model,
      messageCount: cleanMessages.length,
      messages: cleanMessages
    }, null, 2));

    // Use node-fetch with AbortController for reliable timeout handling
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const apiResponse = await nodeFetch(`${process.env.META_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.META_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: cleanMessages,
        max_tokens: 1000,
      }),
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      throw new Error(`Meta Llama API error: ${apiResponse.status} - ${errorText}`);
    }

    const data = await apiResponse.json();
    let content = data.choices[0]?.message?.content || '';

    // Append sources if RAG was used - using special delimiter for frontend parsing
    if (useRag && sources.length > 0) {
      const uniqueSources = Array.from(new Set(sources)); // Remove duplicates
      console.log('Unique sources:', uniqueSources);

      if (uniqueSources.length > 0) {
        // Add sources as JSON after a special delimiter
        content += `\n\n___SOURCES___\n${JSON.stringify(uniqueSources.slice(0, 5))}`;
      }
    }

    return new Response(content, {
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (e: any) {
    console.error('API Error:', e);
    return new Response(
      JSON.stringify({
        error: e.message || 'Internal server error',
        details: e.toString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
