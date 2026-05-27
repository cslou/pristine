import type { HistoricalSession } from './types.js';
import type { RelayVisibleMessage } from './prior-session.js';

export interface RelaySummarizerInput {
  readonly prompt: string;
  readonly messages: readonly RelayVisibleMessage[];
}

export interface RelaySummarizer {
  summarize(input: RelaySummarizerInput): Promise<string>;
}

export type RelayGenerationResult =
  | {
      readonly ok: true;
      readonly content: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

const relaySections = [
  'Current task',
  'Progress',
  'Key files',
  'Decisions made',
  'Blockers/open questions',
  'Next steps',
] as const;

export const buildRelayPrompt = (session: HistoricalSession): string => `Summarize the prior ${session.sourceHarness} session into exactly these six sections:

${relaySections.map((section, index) => `${index + 1}. ${section}`).join('\n')}

Keep the handoff concise, concrete, and grounded only in the provided visible user/assistant messages. Include file paths, decisions, blockers, and next actions when present. If a section has no evidence, write "None identified."`;

const formatPriorSessionMessages = (messages: readonly RelayVisibleMessage[]): string =>
  messages.map((message) => `${message.role.toUpperCase()}: ${message.text}`).join('\n\n');

export const formatPriorSessionHandoff = (params: {
  readonly session: HistoricalSession;
  readonly summary: string;
}): string => `## Prior Session Handoff

Source: ${params.session.sourceHarness} session ${params.session.sourceUri}
Project: ${params.session.cwd}
Last message: ${params.session.lastMessageAt}

${params.summary.trim()}`;

export const generatePriorSessionHandoff = async (params: {
  readonly session: HistoricalSession;
  readonly messages: readonly RelayVisibleMessage[];
  readonly summarizer: RelaySummarizer;
}): Promise<RelayGenerationResult> => {
  try {
    const prompt = `${buildRelayPrompt(params.session)}\n\nPrior visible messages:\n${formatPriorSessionMessages(
      params.messages,
    )}`;
    const summary = await params.summarizer.summarize({
      prompt,
      messages: params.messages,
    });
    if (summary.trim().length === 0) {
      return { ok: false, error: 'Relay summarizer returned an empty summary' };
    }
    return {
      ok: true,
      content: formatPriorSessionHandoff({ session: params.session, summary }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};
