export class AppError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class LlmClassificationError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'LlmClassificationError';
  }
}

export class ResolveApprovalError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'ResolveApprovalError';
  }
}

export class ResolveApprovalTimeoutError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'ResolveApprovalTimeoutError';
  }
}

export class EmbedderError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'EmbedderError';
  }
}

export class VaultEncodingError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'VaultEncodingError';
  }
}

export class AsymmetricCryptoError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'AsymmetricCryptoError';
  }
}

export class VaultEntryContractError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'VaultEntryContractError';
  }
}

export class KeyManagerError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'KeyManagerError';
  }
}

export class KekManagerError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'KekManagerError';
  }
}

export class PrivacyPipelineError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'PrivacyPipelineError';
  }
}

export class ConfigError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class IngestQueueError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'IngestQueueError';
  }
}

export class ConversationNotFoundError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'ConversationNotFoundError';
  }
}

export class InvalidArgumentError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

export class QueryTimeoutError extends AppError {
  public constructor(message: string) {
    super(message);
    this.name = 'QueryTimeoutError';
  }
}
