/**
 * Semantic search (suggestion #20). One small quantized sentence model
 * (all-MiniLM-L6-v2, ~23MB), loaded lazily on first use. Everything
 * degrades: if the library or model cannot load, every caller falls back
 * to FULLTEXT and the pool behaves exactly as before.
 *
 * HARD-LEARNED (the 1.14.0 crashloop, ~15min downtime): the library is
 * imported DYNAMICALLY inside the try/catch below, never at module level.
 * @xenova/transformers requires onnxruntime-node on import, and a native
 * binding that cannot load on the runtime platform must cost us semantic
 * ranking, not the process.
 */

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIM = 384;

type Embedder = (text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array }>;

let embedderPromise: Promise<Embedder | null> | null = null;
let failedAt = 0;

async function loadEmbedder(): Promise<Embedder | null> {
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = false;
  // Stateless container: the cache re-downloads (~23MB) per deploy, in the
  // background; search stays lexical until it lands.
  env.cacheDir = process.env.TRANSFORMERS_CACHE ?? '/tmp/transformers-cache';
  return (await pipeline('feature-extraction', EMBED_MODEL, { quantized: true })) as unknown as Embedder;
}

async function getEmbedder(): Promise<Embedder | null> {
  if (process.env.EMBEDDINGS === '0') return null;
  // After a failure (musl runtime, no egress, HF hiccup) retry at most every 10 min.
  if (embedderPromise === null || (failedAt > 0 && Date.now() - failedAt > 600_000)) {
    failedAt = 0;
    embedderPromise = loadEmbedder()
      .then((p) => { console.error(`embed: ${EMBED_MODEL} ready`); return p; })
      .catch((e: Error) => {
        failedAt = Date.now();
        console.error(`embed: unavailable (${e.message}) — search stays lexical, retry in 10m`);
        return null;
      });
  }
  return embedderPromise;
}

/** null = embeddings unavailable right now; caller falls back to FULLTEXT. */
export async function embed(text: string): Promise<Float32Array | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  try {
    const out = await embedder(text.slice(0, 4000), { pooling: 'mean', normalize: true });
    return new Float32Array(out.data);
  } catch {
    return null;
  }
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function fromBlob(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

/** Vectors are normalized, so cosine = dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
