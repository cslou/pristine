/**
 * Embedder throughput benchmark.
 *
 * Run: npx tsx benchmarks/embedder-throughput.ts
 *
 * Downloads Nomic Embed v1.5 (~300 MB) on first run.
 * Target: >500 embeddings/sec for short texts on M-series Mac.
 */

import { LocalEmbedder } from '../src/embedder/local/index.js';

const SAMPLE_TEXTS = [
  'The user likes coffee.',
  'She works at Google in Mountain View.',
  'My favorite book is Dune by Frank Herbert.',
  'I moved to Tokyo last year.',
  'The meeting is scheduled for next Tuesday.',
  'He enjoys hiking in the mountains on weekends.',
  'My phone number starts with 090.',
  'I prefer dark mode in all my applications.',
  'The project deadline is March 15th.',
  'She has two cats named Luna and Mochi.',
];

const NUM_ITERATIONS = 100;
const TOTAL_EMBEDDINGS = SAMPLE_TEXTS.length * NUM_ITERATIONS;

async function main(): Promise<void> {
  const embedder = new LocalEmbedder();

  // Warm up (first call downloads model + initializes ONNX)
  process.stdout.write('Warming up (downloading model if needed)...\n');
  await embedder.embed(SAMPLE_TEXTS[0]!);
  process.stdout.write('Warm-up complete.\n\n');

  // Benchmark
  process.stdout.write(`Embedding ${TOTAL_EMBEDDINGS} texts (${NUM_ITERATIONS} iterations x ${SAMPLE_TEXTS.length} texts)...\n`);
  const start = performance.now();

  for (let i = 0; i < NUM_ITERATIONS; i++) {
    await embedder.embedBatch([...SAMPLE_TEXTS]);
  }

  const elapsed = performance.now() - start;
  const perSecond = (TOTAL_EMBEDDINGS / elapsed) * 1000;

  process.stdout.write(`\nResults:\n`);
  process.stdout.write(`  Total embeddings: ${TOTAL_EMBEDDINGS}\n`);
  process.stdout.write(`  Total time: ${(elapsed / 1000).toFixed(2)}s\n`);
  process.stdout.write(`  Throughput: ${perSecond.toFixed(1)} embeddings/sec\n`);
  process.stdout.write(`  Target: >500 embeddings/sec\n`);
  process.stdout.write(`  Status: ${perSecond > 500 ? 'PASS' : 'BELOW TARGET'}\n`);

  await embedder.dispose();
}

main().catch((error: unknown) => {
  process.stderr.write(`Benchmark failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exit(1);
});
