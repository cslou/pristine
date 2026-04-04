export interface ModelEntry {
  readonly name: string;
  readonly filename: string;
  readonly url: string;
  readonly sha256?: string;
  readonly sizeBytes: number;
  readonly description: string;
}

const DEFAULT_LLM_MODEL: ModelEntry = {
  name: 'qwen2.5-7b-instruct-q4_k_m',
  filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf',
  // sha256 omitted — will be populated when model distribution is finalized
  sizeBytes: 4_680_000_000,
  description:
    'Qwen2.5 7B Instruct Q4_K_M — default LLM for extraction, consolidation, classification',
};

const REGISTRY: ReadonlyMap<string, ModelEntry> = new Map([
  [DEFAULT_LLM_MODEL.name, DEFAULT_LLM_MODEL],
]);

export function getModelEntry(name: string): ModelEntry | undefined {
  return REGISTRY.get(name);
}

export function getDefaultLlmModelName(): string {
  return DEFAULT_LLM_MODEL.name;
}

export function listModels(): ModelEntry[] {
  return [...REGISTRY.values()];
}
