import { homedir } from 'node:os';
import { join } from 'node:path';

export const PRISTINE_DB_PATH_ENV = 'PRISTINE_DB_PATH';

export interface ResolveDbPathOptions {
  readonly explicitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

export const resolvePiPristineDbPath = (options: ResolveDbPathOptions = {}): string => {
  if (options.explicitPath !== undefined && options.explicitPath.trim().length > 0) {
    return options.explicitPath;
  }

  const env = options.env ?? process.env;
  const envPath = env[PRISTINE_DB_PATH_ENV];
  if (envPath !== undefined && envPath.trim().length > 0) {
    return envPath;
  }

  return join(options.homeDir ?? homedir(), '.pi', 'pristine', 'pristine.db');
};
