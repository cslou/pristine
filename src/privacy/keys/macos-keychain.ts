import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyManagerError } from '../../core/errors.js';
import type { KeyManager } from '../../core/interfaces.js';
import type { PublicKeyWithStatus } from '../../core/types.js';
import { validatePublicKey } from '../vault/asymmetric-crypto.js';
import { encodeKeyUserId, validateKeyUserId } from './shared.js';

interface HelperCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface HelperSuccessResponse {
  readonly ok: true;
  readonly publicKey?: string;
  readonly created?: boolean;
  readonly plaintextBase64?: string;
}

interface HelperErrorResponse {
  readonly ok: false;
  readonly error: string;
}

type HelperResponse = HelperSuccessResponse | HelperErrorResponse;

export type MacOsKeychainHelperRunner = (args: readonly string[]) => Promise<HelperCommandResult>;

export interface MacOsKeychainKeyManagerOptions {
  readonly serviceName?: string;
  readonly runner?: MacOsKeychainHelperRunner;
  readonly platform?: NodeJS.Platform;
}

const DEFAULT_SERVICE_NAME = 'dev.pristine.rsa.private-key';
const HELPER_DIR = join(tmpdir(), 'pristine-macos-keychain');

const SWIFT_HELPER_SOURCE = String.raw`import Foundation
import Security

enum HelperError: Error {
  case message(String)
}

struct SuccessResponse: Encodable {
  let ok = true
  let publicKey: String?
  let created: Bool?
  let plaintextBase64: String?
}

struct ErrorResponse: Encodable {
  let ok = false
  let error: String
}

func emit<T: Encodable>(_ value: T) throws {
  let data = try JSONEncoder().encode(value)
  FileHandle.standardOutput.write(data)
}

func fail(_ message: String) -> Never {
  let response = ErrorResponse(error: message)
  let data = try! JSONEncoder().encode(response)
  FileHandle.standardOutput.write(data)
  exit(1)
}

func tagData(service: String, account: String, kind: String) -> Data {
  Data("pristine:\(service):\(account):\(kind)".utf8)
}

func keyQuery(tag: Data, keyClass: CFString) -> [String: Any] {
  [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag,
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecAttrKeyClass as String: keyClass,
  ]
}

func secMessage(_ status: OSStatus, _ fallback: String) -> String {
  if let message = SecCopyErrorMessageString(status, nil) as String? {
    return message
  }
  return fallback
}

func findKey(tag: Data, keyClass: CFString) throws -> SecKey? {
  var query = keyQuery(tag: tag, keyClass: keyClass)
  query[kSecReturnRef as String] = true

  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  if status == errSecItemNotFound {
    return nil
  }
  guard status == errSecSuccess else {
    throw HelperError.message(secMessage(status, "SecItemCopyMatching failed with status \(status)"))
  }
  guard let key = item else {
    throw HelperError.message("Keychain returned success without a key reference")
  }
  return (key as! SecKey)
}

func deleteKey(tag: Data, keyClass: CFString) throws {
  let status = SecItemDelete(keyQuery(tag: tag, keyClass: keyClass) as CFDictionary)
  if status == errSecSuccess || status == errSecItemNotFound {
    return
  }
  throw HelperError.message(secMessage(status, "SecItemDelete failed with status \(status)"))
}

func exportPublicKeyPem(_ publicKey: SecKey) throws -> String {
  var error: Unmanaged<CFError>?
  guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
    let message = error?.takeRetainedValue().localizedDescription ?? "unknown public key export error"
    throw HelperError.message("Failed to export RSA public key: \(message)")
  }

  let body = data
    .base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
    .trimmingCharacters(in: .whitespacesAndNewlines)
  return "-----BEGIN RSA PUBLIC KEY-----\n\(body)\n-----END RSA PUBLIC KEY-----\n"
}

func generateKeyPair(service: String, account: String) throws -> (SecKey, SecKey) {
  let privateTag = tagData(service: service, account: account, kind: "private")
  let publicTag = tagData(service: service, account: account, kind: "public")

  let privateAttrs: [String: Any] = [
    kSecAttrIsPermanent as String: true,
    kSecAttrApplicationTag as String: privateTag,
    kSecAttrLabel as String: "Pristine RSA Private Key (\(service)/\(account))",
  ]
  let publicAttrs: [String: Any] = [
    kSecAttrIsPermanent as String: true,
    kSecAttrApplicationTag as String: publicTag,
    kSecAttrLabel as String: "Pristine RSA Public Key (\(service)/\(account))",
  ]

  let attributes: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecAttrKeySizeInBits as String: 4096,
    kSecPrivateKeyAttrs as String: privateAttrs,
    kSecPublicKeyAttrs as String: publicAttrs,
  ]

  var error: Unmanaged<CFError>?
  guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
    let message = error?.takeRetainedValue().localizedDescription ?? "unknown key generation error"
    throw HelperError.message("Failed to generate RSA key pair in Keychain: \(message)")
  }
  guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
    throw HelperError.message("Generated RSA private key did not expose a public key")
  }
  return (privateKey, publicKey)
}

func resolveKeyPair(service: String, account: String, createIfMissing: Bool) throws -> (SecKey, SecKey, Bool) {
  let privateTag = tagData(service: service, account: account, kind: "private")
  let publicTag = tagData(service: service, account: account, kind: "public")

  let privateKey = try findKey(tag: privateTag, keyClass: kSecAttrKeyClassPrivate)
  let publicKey = try findKey(tag: publicTag, keyClass: kSecAttrKeyClassPublic)

  if let privateKey, let publicKey {
    return (privateKey, publicKey, false)
  }

  if privateKey != nil || publicKey != nil {
    try deleteKey(tag: privateTag, keyClass: kSecAttrKeyClassPrivate)
    try deleteKey(tag: publicTag, keyClass: kSecAttrKeyClassPublic)
  }

  if !createIfMissing {
    throw HelperError.message("RSA key pair not found in macOS Keychain")
  }

  let generated = try generateKeyPair(service: service, account: account)
  return (generated.0, generated.1, true)
}

func getOrCreatePublicKey(service: String, account: String) throws {
  let (_, publicKey, created) = try resolveKeyPair(service: service, account: account, createIfMissing: true)
  try emit(SuccessResponse(publicKey: try exportPublicKeyPem(publicKey), created: created, plaintextBase64: nil))
}

func unwrap(service: String, account: String, wrappedValueBase64: String) throws {
  let (privateKey, _, _) = try resolveKeyPair(service: service, account: account, createIfMissing: false)
  guard let ciphertext = Data(base64Encoded: wrappedValueBase64) else {
    throw HelperError.message("Wrapped RSA value must be base64")
  }

  let algorithm = SecKeyAlgorithm.rsaEncryptionOAEPSHA256
  guard SecKeyIsAlgorithmSupported(privateKey, .decrypt, algorithm) else {
    throw HelperError.message("RSA private key does not support OAEP-SHA256 decrypt")
  }

  var error: Unmanaged<CFError>?
  guard let plaintext = SecKeyCreateDecryptedData(privateKey, algorithm, ciphertext as CFData, &error) as Data? else {
    let message = error?.takeRetainedValue().localizedDescription ?? "unknown RSA decrypt error"
    throw HelperError.message("Failed to unwrap RSA value with Keychain private key: \(message)")
  }

  try emit(SuccessResponse(publicKey: nil, created: nil, plaintextBase64: plaintext.base64EncodedString()))
}

func rotateKeyPair(service: String, account: String) throws {
  let privateTag = tagData(service: service, account: account, kind: "private")
  let publicTag = tagData(service: service, account: account, kind: "public")
  try deleteKey(tag: privateTag, keyClass: kSecAttrKeyClassPrivate)
  try deleteKey(tag: publicTag, keyClass: kSecAttrKeyClassPublic)
  let (_, publicKey) = try generateKeyPair(service: service, account: account)
  try emit(SuccessResponse(publicKey: try exportPublicKeyPem(publicKey), created: true, plaintextBase64: nil))
}

do {
  let arguments = CommandLine.arguments
  guard arguments.count >= 4 else {
    fail("Usage: helper.swift <command> <service> <account> [value]")
  }

  let command = arguments[1]
  let service = arguments[2]
  let account = arguments[3]

  switch command {
  case "get-or-create-public-key":
    try getOrCreatePublicKey(service: service, account: account)
  case "unwrap":
    guard arguments.count >= 5 else {
      fail("unwrap requires a base64 ciphertext argument")
    }
    try unwrap(service: service, account: account, wrappedValueBase64: arguments[4])
  case "rotate-keypair":
    try rotateKeyPair(service: service, account: account)
  default:
    fail("Unknown command: \(command)")
  }
} catch let error as HelperError {
  switch error {
  case let .message(message):
    fail(message)
  }
} catch {
  fail(error.localizedDescription)
}
`;

const helperScriptPath = (): string => {
  mkdirSync(HELPER_DIR, { recursive: true });
  const hash = createHash('sha256').update(SWIFT_HELPER_SOURCE).digest('hex').slice(0, 16);
  const filePath = join(HELPER_DIR, `helper-${hash}.swift`);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, SWIFT_HELPER_SOURCE, 'utf8');
  }
  return filePath;
};

const defaultRunner: MacOsKeychainHelperRunner = async (
  args: readonly string[],
): Promise<HelperCommandResult> =>
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/swift', [helperScriptPath(), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(new KeyManagerError(`Failed to execute macOS Keychain helper: ${error.message}`));
    });

    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });

const parseHelperResponse = (
  result: HelperCommandResult,
  operation: string,
  itemReference: string,
): HelperSuccessResponse => {
  if (result.exitCode !== 0) {
    throw new KeyManagerError(
      `macOS Keychain ${operation} failed for ${itemReference}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
    );
  }

  let parsed: HelperResponse;
  try {
    parsed = JSON.parse(result.stdout) as HelperResponse;
  } catch {
    throw new KeyManagerError(
      `macOS Keychain ${operation} returned invalid JSON for ${itemReference}.`,
    );
  }

  if (!parsed.ok) {
    throw new KeyManagerError(
      `macOS Keychain ${operation} failed for ${itemReference}: ${parsed.error}`,
    );
  }

  return parsed;
};

export class MacOsKeychainKeyManager implements KeyManager {
  private readonly serviceName: string;
  private readonly runner: MacOsKeychainHelperRunner;
  private readonly platform: NodeJS.Platform;
  private readonly cache = new Map<string, { publicKey: string }>();

  public constructor(options: MacOsKeychainKeyManagerOptions = {}) {
    this.serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
    this.runner = options.runner ?? defaultRunner;
    this.platform = options.platform ?? process.platform;
  }

  public async getOrCreatePublicKey(userId: string): Promise<PublicKeyWithStatus> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);

    const cached = this.cache.get(userId);
    if (cached) {
      return { ...cached, created: false };
    }

    const result = await this.runner([
      'get-or-create-public-key',
      this.serviceName,
      this.itemAccount(userId),
    ]);
    const response = parseHelperResponse(result, 'public-key lookup', this.itemReference(userId));

    if (typeof response.publicKey !== 'string' || typeof response.created !== 'boolean') {
      throw new KeyManagerError(
        `macOS Keychain public-key lookup returned an invalid response for ${this.itemReference(userId)}.`,
      );
    }

    validatePublicKey(response.publicKey);
    this.cache.set(userId, { publicKey: response.publicKey });
    return { publicKey: response.publicKey, created: response.created };
  }

  public async unwrap(userId: string, wrappedValue: Buffer): Promise<Buffer> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);

    const result = await this.runner([
      'unwrap',
      this.serviceName,
      this.itemAccount(userId),
      wrappedValue.toString('base64'),
    ]);
    const response = parseHelperResponse(result, 'unwrap', this.itemReference(userId));

    if (typeof response.plaintextBase64 !== 'string') {
      throw new KeyManagerError(
        `macOS Keychain unwrap returned an invalid response for ${this.itemReference(userId)}.`,
      );
    }

    return Buffer.from(response.plaintextBase64, 'base64');
  }

  public async rotateKeyPair(userId: string): Promise<PublicKeyWithStatus> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);

    const result = await this.runner([
      'rotate-keypair',
      this.serviceName,
      this.itemAccount(userId),
    ]);
    const response = parseHelperResponse(result, 'key rotation', this.itemReference(userId));

    if (typeof response.publicKey !== 'string') {
      throw new KeyManagerError(
        `macOS Keychain key rotation returned an invalid response for ${this.itemReference(userId)}.`,
      );
    }

    validatePublicKey(response.publicKey);
    this.cache.set(userId, { publicKey: response.publicKey });
    return { publicKey: response.publicKey, created: true };
  }

  private assertSupportedPlatform(): void {
    if (this.platform !== 'darwin') {
      throw new KeyManagerError('MacOsKeychainKeyManager is only supported on macOS.');
    }
  }

  private itemAccount(userId: string): string {
    return encodeKeyUserId(userId);
  }

  private itemReference(userId: string): string {
    return `${this.serviceName}/${this.itemAccount(userId)}`;
  }
}
