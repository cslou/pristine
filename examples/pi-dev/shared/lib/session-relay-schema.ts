export const MEMORY_SESSIONS_TABLE = 'memory_sessions';

export const MEMORY_SESSION_COLUMNS = [
  'source_harness',
  'source_uri',
  'cwd',
  'first_message_at',
  'last_message_at',
  'visible_message_count',
  'updated_at',
] as const;

export type MemorySessionSourceHarness = 'pi' | 'codex' | 'claude';

export interface MemorySessionRow {
  readonly source_harness: MemorySessionSourceHarness;
  readonly source_uri: string;
  readonly cwd: string;
  readonly first_message_at: string;
  readonly last_message_at: string;
  readonly visible_message_count: number | bigint;
  readonly updated_at: string;
}
