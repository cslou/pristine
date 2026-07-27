export class AppError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class EmbedderError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'EmbedderError';
  }
}

export class ConfigError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class InvalidArgumentError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}
