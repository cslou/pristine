export interface OllamaEmbedderEntry {
  readonly engine: 'ollama';
  readonly model?: string;
  readonly host?: string;
  readonly dim?: number;
}

export interface LocalEmbedderEntry {
  readonly engine: 'local';
  readonly model?: string;
  readonly dim?: number;
}

export type EmbedderConfig = OllamaEmbedderEntry | LocalEmbedderEntry;
