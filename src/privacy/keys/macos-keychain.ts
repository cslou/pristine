import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
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
  readonly rotationId?: string;
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
  readonly helperDir?: string;
}

const DEFAULT_SERVICE_NAME = 'dev.pristine.rsa.private-key';
const SWIFT_BINARY = '/usr/bin/swift';
const DEFAULT_HELPER_DIR = join(homedir(), '.pristine', 'runtime');

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
  let rotationId: String?
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

func secMessage(_ status: OSStatus, _ fallback: String) -> String {
  if let message = SecCopyErrorMessageString(status, nil) as String? {
    return message
  }
  return fallback
}

func keyTagData(service: String, account: String, version: String, kind: String) -> Data {
  Data("pristine:\(service):\(account):\(version):\(kind)".utf8)
}

func keyQuery(tag: Data, keyClass: CFString) -> [String: Any] {
  [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag,
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecAttrKeyClass as String: keyClass,
  ]
}

func genericPasswordQuery(service: String, account: String) -> [String: Any] {
  [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
  ]
}

func findKey(service: String, account: String, version: String, keyClass: CFString) throws -> SecKey? {
  var query = keyQuery(tag: keyTagData(service: service, account: account, version: version, kind: keyClass == kSecAttrKeyClassPrivate ? "private" : "public"), keyClass: keyClass)
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

func deleteKey(service: String, account: String, version: String, keyClass: CFString) throws {
  let status = SecItemDelete(
    keyQuery(
      tag: keyTagData(service: service, account: account, version: version, kind: keyClass == kSecAttrKeyClassPrivate ? "private" : "public"),
      keyClass: keyClass
    ) as CFDictionary
  )
  if status == errSecSuccess || status == errSecItemNotFound {
    return
  }
  throw HelperError.message(secMessage(status, "SecItemDelete failed with status \(status)"))
}

func readGenericPassword(service: String, account: String) throws -> String? {
  var query = genericPasswordQuery(service: service, account: account)
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne

  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  if status == errSecItemNotFound {
    return nil
  }
  guard status == errSecSuccess else {
    throw HelperError.message(secMessage(status, "SecItemCopyMatching failed with status \(status)"))
  }
  guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
    throw HelperError.message("Keychain generic password item was not valid UTF-8")
  }
  return value
}

func writeGenericPassword(service: String, account: String, label: String, value: String) throws {
  let data = Data(value.utf8)
  let query = genericPasswordQuery(service: service, account: account)
  let attributes: [String: Any] = [
    kSecValueData as String: data,
    kSecAttrLabel as String: label,
  ]

  let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
  if updateStatus == errSecSuccess {
    return
  }
  if updateStatus != errSecItemNotFound {
    throw HelperError.message(secMessage(updateStatus, "SecItemUpdate failed with status \(updateStatus)"))
  }

  let addStatus = SecItemAdd(
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrLabel as String: label,
      kSecValueData as String: data,
    ] as CFDictionary,
    nil
  )
  guard addStatus == errSecSuccess else {
    throw HelperError.message(secMessage(addStatus, "SecItemAdd failed with status \(addStatus)"))
  }
}

func deleteGenericPassword(service: String, account: String) throws {
  let status = SecItemDelete(genericPasswordQuery(service: service, account: account) as CFDictionary)
  if status == errSecSuccess || status == errSecItemNotFound {
    return
  }
  throw HelperError.message(secMessage(status, "SecItemDelete failed with status \(status)"))
}

func activeVersionService(_ service: String) -> String {
  "\(service).active-version"
}

func versionsService(_ service: String) -> String {
  "\(service).versions"
}

func readVersions(service: String, account: String) throws -> [String] {
  guard let raw = try readGenericPassword(service: versionsService(service), account: account) else {
    return []
  }
  guard let data = raw.data(using: .utf8), let parsed = try JSONSerialization.jsonObject(with: data) as? [String] else {
    throw HelperError.message("Stored Keychain version registry was invalid JSON")
  }
  return parsed
}

func writeVersions(service: String, account: String, versions: [String]) throws {
  let data = try JSONSerialization.data(withJSONObject: versions)
  guard let raw = String(data: data, encoding: .utf8) else {
    throw HelperError.message("Failed to encode Keychain version registry")
  }
  try writeGenericPassword(
    service: versionsService(service),
    account: account,
    label: "Pristine RSA Key Versions (\(service)/\(account))",
    value: raw,
  )
}

func readActiveVersion(service: String, account: String) throws -> String? {
  try readGenericPassword(service: activeVersionService(service), account: account)
}

func writeActiveVersion(service: String, account: String, version: String) throws {
  try writeGenericPassword(
    service: activeVersionService(service),
    account: account,
    label: "Pristine RSA Active Key Version (\(service)/\(account))",
    value: version,
  )
}

func appendVersion(service: String, account: String, version: String) throws {
  var versions = try readVersions(service: service, account: account)
  if !versions.contains(version) {
    versions.append(version)
    try writeVersions(service: service, account: account, versions: versions)
  }
}

func removeVersion(service: String, account: String, version: String) throws {
  let versions = try readVersions(service: service, account: account).filter { $0 != version }
  if versions.isEmpty {
    try deleteGenericPassword(service: versionsService(service), account: account)
  } else {
    try writeVersions(service: service, account: account, versions: versions)
  }
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

func generateKeyPair(service: String, account: String, version: String) throws -> SecKey {
  let privateAttrs: [String: Any] = [
    kSecAttrIsPermanent as String: true,
    kSecAttrApplicationTag as String: keyTagData(service: service, account: account, version: version, kind: "private"),
    kSecAttrLabel as String: "Pristine RSA Private Key (\(service)/\(account)/\(version))",
  ]
  let publicAttrs: [String: Any] = [
    kSecAttrIsPermanent as String: true,
    kSecAttrApplicationTag as String: keyTagData(service: service, account: account, version: version, kind: "public"),
    kSecAttrLabel as String: "Pristine RSA Public Key (\(service)/\(account)/\(version))",
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
  return privateKey
}

func publicKeyForVersion(service: String, account: String, version: String) throws -> SecKey {
  if let existing = try findKey(service: service, account: account, version: version, keyClass: kSecAttrKeyClassPublic) {
    return existing
  }
  guard let privateKey = try findKey(service: service, account: account, version: version, keyClass: kSecAttrKeyClassPrivate) else {
    throw HelperError.message("RSA key pair not found for version \(version)")
  }
  guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
    throw HelperError.message("Stored RSA private key did not expose a public key")
  }
  return publicKey
}

func privateKeyForVersion(service: String, account: String, version: String) throws -> SecKey {
  guard let privateKey = try findKey(service: service, account: account, version: version, keyClass: kSecAttrKeyClassPrivate) else {
    throw HelperError.message("RSA private key not found for version \(version)")
  }
  return privateKey
}

func createInitialVersion(service: String, account: String) throws -> (String, SecKey) {
  let version = UUID().uuidString.lowercased()
  let privateKey = try generateKeyPair(service: service, account: account, version: version)
  try appendVersion(service: service, account: account, version: version)
  try writeActiveVersion(service: service, account: account, version: version)
  return (version, privateKey)
}

func resolveOrCreateActiveVersion(service: String, account: String) throws -> (String, Bool) {
  if let activeVersion = try readActiveVersion(service: service, account: account) {
    do {
      _ = try publicKeyForVersion(service: service, account: account, version: activeVersion)
      return (activeVersion, false)
    } catch {
      // Try recovering from the version registry below.
    }
  }

  let versions = try readVersions(service: service, account: account)
  if let recovered = versions.reversed().first(where: {
    (try? publicKeyForVersion(service: service, account: account, version: $0)) != nil
  }) {
    try writeActiveVersion(service: service, account: account, version: recovered)
    return (recovered, false)
  }

  let (createdVersion, _) = try createInitialVersion(service: service, account: account)
  return (createdVersion, true)
}

func candidateVersions(service: String, account: String) throws -> [String] {
  let activeVersion = try readActiveVersion(service: service, account: account)
  let versions = try readVersions(service: service, account: account)
  var ordered: [String] = []
  if let activeVersion {
    ordered.append(activeVersion)
  }
  for version in versions.reversed() where !ordered.contains(version) {
    ordered.append(version)
  }
  return ordered
}

func getOrCreatePublicKey(service: String, account: String) throws {
  let (version, created) = try resolveOrCreateActiveVersion(service: service, account: account)
  let publicKey = try publicKeyForVersion(service: service, account: account, version: version)
  try emit(SuccessResponse(publicKey: try exportPublicKeyPem(publicKey), created: created, plaintextBase64: nil, rotationId: nil))
}

func unwrap(service: String, account: String, wrappedValueBase64: String) throws {
  guard let ciphertext = Data(base64Encoded: wrappedValueBase64) else {
    throw HelperError.message("Wrapped RSA value must be base64")
  }

  let algorithm = SecKeyAlgorithm.rsaEncryptionOAEPSHA256
  var lastError: String?

  for version in try candidateVersions(service: service, account: account) {
    let privateKey = try privateKeyForVersion(service: service, account: account, version: version)
    guard SecKeyIsAlgorithmSupported(privateKey, .decrypt, algorithm) else {
      continue
    }

    var error: Unmanaged<CFError>?
    if let plaintext = SecKeyCreateDecryptedData(privateKey, algorithm, ciphertext as CFData, &error) as Data? {
      let activeVersion = try readActiveVersion(service: service, account: account)
      if version != activeVersion {
        try? writeActiveVersion(service: service, account: account, version: version)
      }
      try emit(SuccessResponse(publicKey: nil, created: nil, plaintextBase64: plaintext.base64EncodedString(), rotationId: nil))
      return
    }

    lastError = error?.takeRetainedValue().localizedDescription ?? "unknown RSA decrypt error"
  }

  throw HelperError.message("Failed to unwrap RSA value with Keychain private key: \(lastError ?? "no candidate key could decrypt the ciphertext")")
}

func prepareRotation(service: String, account: String) throws {
  let version = UUID().uuidString.lowercased()
  let privateKey = try generateKeyPair(service: service, account: account, version: version)
  try appendVersion(service: service, account: account, version: version)
  guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
    throw HelperError.message("Generated RSA private key did not expose a public key")
  }
  try emit(SuccessResponse(publicKey: try exportPublicKeyPem(publicKey), created: true, plaintextBase64: nil, rotationId: version))
}

func commitRotation(service: String, account: String, version: String) throws {
  _ = try publicKeyForVersion(service: service, account: account, version: version)
  try appendVersion(service: service, account: account, version: version)
  try writeActiveVersion(service: service, account: account, version: version)
  try emit(SuccessResponse(publicKey: nil, created: nil, plaintextBase64: nil, rotationId: version))
}

func rollbackRotation(service: String, account: String, version: String) throws {
  if try readActiveVersion(service: service, account: account) == version {
    try emit(SuccessResponse(publicKey: nil, created: nil, plaintextBase64: nil, rotationId: version))
    return
  }

  try deleteKey(service: service, account: account, version: version, keyClass: kSecAttrKeyClassPrivate)
  try deleteKey(service: service, account: account, version: version, keyClass: kSecAttrKeyClassPublic)
  try removeVersion(service: service, account: account, version: version)
  try emit(SuccessResponse(publicKey: nil, created: nil, plaintextBase64: nil, rotationId: version))
}

func deleteKeyPair(service: String, account: String) throws {
  for version in try readVersions(service: service, account: account) {
    try deleteKey(service: service, account: account, version: version, keyClass: kSecAttrKeyClassPrivate)
    try deleteKey(service: service, account: account, version: version, keyClass: kSecAttrKeyClassPublic)
  }
  try deleteGenericPassword(service: versionsService(service), account: account)
  try deleteGenericPassword(service: activeVersionService(service), account: account)
  try emit(SuccessResponse(publicKey: nil, created: nil, plaintextBase64: nil, rotationId: nil))
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
  case "prepare-rotation":
    try prepareRotation(service: service, account: account)
  case "commit-rotation":
    guard arguments.count >= 5 else {
      fail("commit-rotation requires a rotationId argument")
    }
    try commitRotation(service: service, account: account, version: arguments[4])
  case "rollback-rotation":
    guard arguments.count >= 5 else {
      fail("rollback-rotation requires a rotationId argument")
    }
    try rollbackRotation(service: service, account: account, version: arguments[4])
  case "delete-keypair":
    try deleteKeyPair(service: service, account: account)
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

const validateHelperDirectory = (dirPath: string): void => {
  if (process.platform === 'win32') {
    return;
  }

  const stats = statSync(dirPath);
  const mode = stats.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new KeyManagerError(
      `Permissions 0${mode.toString(8)} for '${dirPath}' are too open. Run: chmod 700 ${dirPath}`,
    );
  }

  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new KeyManagerError(`Helper directory '${dirPath}' is not owned by the current user.`);
  }
};

const ensureSwiftRuntimeAvailable = (): void => {
  if (!existsSync(SWIFT_BINARY)) {
    throw new KeyManagerError(
      `macOS Keychain support requires ${SWIFT_BINARY} to be available for the bundled helper runtime. ` +
        `Provide an explicit filesystem key manager via keysDir/keyManager if this dependency is unavailable.`,
    );
  }
};

const helperScriptPath = (helperDir: string): string => {
  mkdirSync(helperDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    chmodSync(helperDir, 0o700);
  }
  validateHelperDirectory(helperDir);

  const hash = createHash('sha256').update(SWIFT_HELPER_SOURCE).digest('hex').slice(0, 16);
  const filePath = join(helperDir, `helper-${hash}.swift`);
  if (!existsSync(filePath)) {
    const tmpPath = join(helperDir, `helper-${hash}.${process.pid}.tmp`);
    try {
      writeFileSync(tmpPath, SWIFT_HELPER_SOURCE, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      writeFileSync(filePath, SWIFT_HELPER_SOURCE, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
    } catch (error: unknown) {
      if (!existsSync(filePath)) {
        const message = error instanceof Error ? error.message : String(error);
        throw new KeyManagerError(`Failed to install macOS Keychain helper source: ${message}`);
      }
    } finally {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    }
  }

  return filePath;
};

const createDefaultRunner = (helperDir: string): MacOsKeychainHelperRunner => {
  let cachedHelperPath: string | null = null;

  return async (args: readonly string[]): Promise<HelperCommandResult> => {
    ensureSwiftRuntimeAvailable();
    const helperPath = cachedHelperPath ?? helperScriptPath(helperDir);
    cachedHelperPath = helperPath;

    return await new Promise((resolve, reject) => {
      const child = spawn(SWIFT_BINARY, [helperPath, ...args]);

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

      child.on('error', (error: Error) => {
        reject(new KeyManagerError(`Failed to execute macOS Keychain helper: ${error.message}`));
      });

      child.on('close', (exitCode: number | null) => {
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });
    });
  };
};

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
  } catch (error: unknown) {
    void error;
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
    this.runner = options.runner ?? createDefaultRunner(options.helperDir ?? DEFAULT_HELPER_DIR);
    this.platform = options.platform ?? process.platform;
  }

  public async getOrCreatePublicKey(userId: string): Promise<PublicKeyWithStatus> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);

    const cached = this.cache.get(userId);
    if (cached) {
      return { ...cached, created: false };
    }

    const response = parseHelperResponse(
      await this.runner(['get-or-create-public-key', this.serviceName, this.itemAccount(userId)]),
      'public-key lookup',
      this.itemReference(userId),
    );

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

    const response = parseHelperResponse(
      await this.runner([
        'unwrap',
        this.serviceName,
        this.itemAccount(userId),
        wrappedValue.toString('base64'),
      ]),
      'unwrap',
      this.itemReference(userId),
    );

    if (typeof response.plaintextBase64 !== 'string') {
      throw new KeyManagerError(
        `macOS Keychain unwrap returned an invalid response for ${this.itemReference(userId)}.`,
      );
    }

    this.cache.delete(userId);
    return Buffer.from(response.plaintextBase64, 'base64');
  }

  public async prepareKeyPairRotation(userId: string): Promise<{
    readonly publicKey: string;
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);

    const response = parseHelperResponse(
      await this.runner(['prepare-rotation', this.serviceName, this.itemAccount(userId)]),
      'rotation prepare',
      this.itemReference(userId),
    );

    if (typeof response.publicKey !== 'string' || typeof response.rotationId !== 'string') {
      throw new KeyManagerError(
        `macOS Keychain rotation prepare returned an invalid response for ${this.itemReference(userId)}.`,
      );
    }

    validatePublicKey(response.publicKey);
    const rotationId = response.rotationId;

    const publicKey = response.publicKey;

    return {
      publicKey,
      commit: async () => {
        parseHelperResponse(
          await this.runner([
            'commit-rotation',
            this.serviceName,
            this.itemAccount(userId),
            rotationId,
          ]),
          'rotation commit',
          this.itemReference(userId),
        );
        this.cache.set(userId, { publicKey });
      },
      rollback: async () => {
        parseHelperResponse(
          await this.runner([
            'rollback-rotation',
            this.serviceName,
            this.itemAccount(userId),
            rotationId,
          ]),
          'rotation rollback',
          this.itemReference(userId),
        );
      },
    };
  }

  public async rotateKeyPair(userId: string): Promise<PublicKeyWithStatus> {
    const prepared = await this.prepareKeyPairRotation(userId);
    await prepared.commit();
    return { publicKey: prepared.publicKey, created: true };
  }

  public async deleteKeyPair(userId: string): Promise<void> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);
    parseHelperResponse(
      await this.runner(['delete-keypair', this.serviceName, this.itemAccount(userId)]),
      'delete-keypair',
      this.itemReference(userId),
    );
    this.cache.delete(userId);
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
