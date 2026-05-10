# Security Policy

## Supported Versions

Pristine is pre-1.0. Security fixes are applied to the latest published `0.x` release line and the `main` branch. Older pre-1.0 releases are not guaranteed to receive backports unless a maintainer explicitly documents one in the release notes.

## Reporting a Vulnerability

Please do **not** open a public issue for a suspected vulnerability, secret exposure, privacy bypass, or unsafe default.

Report vulnerabilities privately through GitHub's private vulnerability reporting / Security Advisory flow for this repository. If that flow is unavailable, contact the maintainer privately and include only the minimum information needed to reproduce the issue.

A useful report includes:

- affected version or commit SHA;
- operating system and Node.js version;
- steps to reproduce;
- expected vs. actual behavior;
- whether local files, SQLite data, key material, source chunks, or vault entries are involved;
- whether any secret, token, private key, or personal data may have been exposed.

## Disclosure Expectations

Maintainers will acknowledge valid reports as soon as practical, investigate privately, and coordinate a fix before public disclosure. Public disclosure should wait until a patched release or documented mitigation is available unless there is an active exploitation risk that requires a different response.

## Privacy-Sensitive Scope

Pristine is a local-first SDK. Security reports may involve local SQLite databases, filesystem key material, model caches, source chunk text/snippets, or privacy vault data. Do not attach real user databases, private keys, API tokens, raw transcripts, or personally sensitive source material to a report. Prefer minimal synthetic reproductions.

## Dependency Vulnerabilities

Dependency advisories that affect production installs are treated as security issues. Development-only advisories are triaged by exploitability in this repository's workflows and are fixed before release when practical.
