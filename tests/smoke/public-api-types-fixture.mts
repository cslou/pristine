import { Pristine } from '../../src/index.js';
import type {
  Embedder,
  ForgetResult,
  RecalledMemory,
  SourceChunkInput,
  StoredMemory,
} from '../../src/index.js';

const embedder: Embedder = {
  dim: 768,
  async embed(): Promise<number[]> {
    return Array.from({ length: 768 }, () => 0);
  },
  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    return texts.map(() => Array.from({ length: 768 }, () => 0));
  },
};

const chunk: SourceChunkInput = {
  chunkId: 'memory-1',
  text: 'Project memory stays local.',
  sourceKind: 'fixture',
  sourceUri: 'fixture://memory',
  metadata: { durable: true },
};

const pristine = await Pristine.create({ embedder });
const stored: readonly StoredMemory[] = await pristine.store([chunk], { projectId: 'fixture' });
const recalled: readonly RecalledMemory[] = await pristine.recall('project memory', {
  projectId: 'fixture',
  limit: 1,
});
const forgotten: ForgetResult = pristine.forget([stored[0]!.chunkId], { projectId: 'fixture' });

void recalled;
void forgotten;
await pristine.dispose();
