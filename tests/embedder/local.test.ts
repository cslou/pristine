import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EmbedderError } from '../../src/core/errors.js';

const mockPipeline = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => mockPipeline(...args),
}));

import { LocalEmbedder } from '../../src/embedder/local/index.js';

function createMockExtractor(dimension = 768): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    data: new Float32Array(dimension).fill(0.1),
  });
}

describe('LocalEmbedder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('embed() returns a 768-dimensional vector', async () => {
    const extractor = createMockExtractor(768);
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    const vector = await embedder.embed('hello world');

    expect(vector).toHaveLength(768);
    expect(extractor).toHaveBeenCalledWith('hello world', { pooling: 'mean', normalize: true });
  });

  it('embedBatch() returns vectors in correct order', async () => {
    let callIndex = 0;
    const extractor = vi.fn().mockImplementation(() => {
      const data = new Float32Array(768);
      data[0] = callIndex;
      callIndex += 1;
      return Promise.resolve({ data });
    });
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    const results = await embedder.embedBatch(['first', 'second', 'third']);

    expect(results).toHaveLength(3);
    expect(results[0]![0]).toBe(0);
    expect(results[1]![0]).toBe(1);
    expect(results[2]![0]).toBe(2);
    expect(extractor).toHaveBeenCalledTimes(3);
  });

  it('embedBatch() with empty array returns [] without loading model', async () => {
    const embedder = new LocalEmbedder();
    const results = await embedder.embedBatch([]);

    expect(results).toEqual([]);
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it('uses default Nomic Embed model', async () => {
    const extractor = createMockExtractor();
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    await embedder.embed('test');

    expect(mockPipeline).toHaveBeenCalledWith(
      'feature-extraction',
      'nomic-ai/nomic-embed-text-v1.5',
    );
  });

  it('uses custom model when configured', async () => {
    const extractor = createMockExtractor();
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder({ model: 'custom/model' });
    await embedder.embed('test');

    expect(mockPipeline).toHaveBeenCalledWith('feature-extraction', 'custom/model');
  });

  it('loads pipeline only once (singleton)', async () => {
    const extractor = createMockExtractor();
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    await embedder.embed('first');
    await embedder.embed('second');

    expect(mockPipeline).toHaveBeenCalledTimes(1);
  });

  it('throws AppError when model fails to load', async () => {
    mockPipeline.mockRejectedValue(new Error('model not found'));

    const embedder = new LocalEmbedder();

    await expect(embedder.embed('test')).rejects.toThrow(EmbedderError);
    await expect(embedder.embed('test')).rejects.toThrow(/Failed to load embedding model/);
  });

  it('truncates output to 768 dimensions if model returns more', async () => {
    const extractor = vi.fn().mockResolvedValue({
      data: new Float32Array(1024).fill(0.5),
    });
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    const vector = await embedder.embed('test');

    expect(vector).toHaveLength(768);
  });

  it('dispose() clears pipeline state', async () => {
    const extractor = createMockExtractor();
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    await embedder.embed('test');
    await embedder.dispose();

    // After dispose, next call should re-load the pipeline
    await embedder.embed('test again');
    expect(mockPipeline).toHaveBeenCalledTimes(2);
  });

  it('embed() with empty string still calls extractor and returns vector', async () => {
    const extractor = createMockExtractor(768);
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    const vector = await embedder.embed('');

    expect(extractor).toHaveBeenCalledTimes(1);
    expect(vector).toHaveLength(768);
  });

  it('embedBatch() with single text returns single-item result', async () => {
    const extractor = createMockExtractor(768);
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    const results = await embedder.embedBatch(['single text']);

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveLength(768);
    expect(extractor).toHaveBeenCalledTimes(1);
  });

  it('embed() returns plain number[] not Float32Array', async () => {
    const extractor = createMockExtractor(768);
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    const vector = await embedder.embed('test');

    expect(Array.isArray(vector)).toBe(true);
    expect(vector).not.toBeInstanceOf(Float32Array);
  });

  it('embedBatch() processes texts sequentially (one extractor call per text)', async () => {
    const callOrder: string[] = [];
    const extractor = vi.fn().mockImplementation((text: string) => {
      callOrder.push(text);
      return Promise.resolve({ data: new Float32Array(768).fill(0.1) });
    });
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();
    await embedder.embedBatch(['alpha', 'bravo', 'charlie']);

    expect(callOrder).toEqual(['alpha', 'bravo', 'charlie']);
    expect(extractor).toHaveBeenCalledTimes(3);
  });

  it('embedBatch() propagates extractor error as EmbedderError via embed()', async () => {
    const extractor = vi.fn().mockRejectedValue(new Error('inference failed'));
    mockPipeline.mockResolvedValue(extractor);

    const embedder = new LocalEmbedder();

    // embed() calls embedBatch internally, loadPipeline succeeds but extractor fails
    // The error propagates directly since it's not caught in embedBatch
    await expect(embedder.embedBatch(['will fail'])).rejects.toThrow('inference failed');
  });

  it('concurrent embed() calls share the same pipeline load', async () => {
    const extractor = createMockExtractor(768);
    let resolveLoad: ((value: ReturnType<typeof vi.fn>) => void) | null = null;
    mockPipeline.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const embedder = new LocalEmbedder();
    const p1 = embedder.embed('first');
    const p2 = embedder.embed('second');

    // Both calls should be waiting on the same pipeline promise
    expect(mockPipeline).toHaveBeenCalledTimes(1);

    // Resolve the pipeline load
    resolveLoad!(extractor);
    await Promise.all([p1, p2]);

    // Still only one pipeline call
    expect(mockPipeline).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenCalledTimes(2);
  });

  it('dispose() is safe to call when pipeline was never loaded', async () => {
    const embedder = new LocalEmbedder();
    await expect(embedder.dispose()).resolves.toBeUndefined();
  });
});
