import type { PipelineContext, PipelineStep, StepError } from './types.js';

export interface PipelineExecutionResult {
  readonly context: PipelineContext;
  readonly error?: StepError;
}

export interface PipelineRunner {
  readonly steps: readonly PipelineStep[];
  registerStep(step: PipelineStep): void;
  run(context: PipelineContext): Promise<PipelineExecutionResult>;
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
};

export const createPipelineRunner = (initialSteps: PipelineStep[] = []): PipelineRunner => {
  const steps = [...initialSteps];

  const registerStep = (step: PipelineStep): void => {
    steps.push(step);
  };

  const run = async (context: PipelineContext): Promise<PipelineExecutionResult> => {
    let current = context;

    for (const step of steps) {
      try {
        current = await step.execute(current);
      } catch (error: unknown) {
        return {
          context: current,
          error: {
            step: step.name,
            error: toErrorMessage(error),
          },
        };
      }
    }

    return { context: current };
  };

  return {
    steps,
    registerStep,
    run,
  };
};
