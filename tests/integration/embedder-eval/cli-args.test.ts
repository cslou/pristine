import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { confineReportsDir, DEFAULT_REPORTS_DIR, parseArgs } from './cli-args.js';

describe('parseArgs', () => {
  it('parses minimal args with --candidate', () => {
    const args = parseArgs(['--candidate', 'nomic-v1.5']);
    expect(args.candidate).toBe('nomic-v1.5');
    expect(args.baseline).toBe('nomic-v1.5');
    expect(args.reportsDir).toBe(DEFAULT_REPORTS_DIR);
  });

  it('parses --baseline override', () => {
    const args = parseArgs(['--candidate', 'gte-modernbert-base', '--baseline', 'nomic-v1.5']);
    expect(args.candidate).toBe('gte-modernbert-base');
    expect(args.baseline).toBe('nomic-v1.5');
  });

  it('parses --reports-dir override', () => {
    const args = parseArgs(['--candidate', 'nomic-v1.5', '--reports-dir', '/tmp/eval-reports']);
    expect(args.reportsDir).toBe('/tmp/eval-reports');
  });

  it('throws when --candidate is missing', () => {
    expect(() => parseArgs([])).toThrow(/Usage:/);
    expect(() => parseArgs(['--baseline', 'nomic-v1.5'])).toThrow(/Usage:/);
  });

  it('throws when --candidate has no following value', () => {
    expect(() => parseArgs(['--candidate'])).toThrow(/--candidate requires a value/);
  });

  it('throws when --baseline has no following value (no silent default)', () => {
    expect(() => parseArgs(['--candidate', 'a', '--baseline'])).toThrow(
      /--baseline requires a value/,
    );
  });

  it('throws when --reports-dir has no following value', () => {
    expect(() => parseArgs(['--candidate', 'a', '--reports-dir'])).toThrow(
      /--reports-dir requires a value/,
    );
  });
});

describe('confineReportsDir', () => {
  it('accepts a path inside the OS tmpdir', () => {
    const p = `${tmpdir()}/eval-reports`;
    expect(confineReportsDir(p)).toBe(resolve(p));
  });

  it('accepts the OS tmpdir itself', () => {
    expect(confineReportsDir(tmpdir())).toBe(resolve(tmpdir()));
  });

  it('rejects /etc/cron.d', () => {
    expect(() => confineReportsDir('/etc/cron.d')).toThrow(/must resolve under the repo tree/);
  });

  it('rejects parent-traversal escape attempts', () => {
    expect(() => confineReportsDir('/tmp/../../../etc')).toThrow(
      /must resolve under the repo tree/,
    );
  });

  it('rejects /', () => {
    expect(() => confineReportsDir('/')).toThrow(/must resolve under the repo tree/);
  });
});
