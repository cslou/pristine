module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'error',
  },
  overrides: [
    {
      // Sprint-018 Story 1 — public-API integration harness MUST import only
      // from the package barrel (src/index.ts). Reaching into internal modules
      // (e.g. ../../src/memory/..., ../../src/conversations/...) defeats the
      // harness contract: the file's purpose is to exercise the same surface
      // an external SDK consumer sees, so any reachthrough is a bug.
      files: ['tests/integration/public-api.test.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['../../src/**', '!../../src/index', '!../../src/index.js'],
                message:
                  'public-api.test.ts must import only from the package barrel (src/index.ts) — internal-path imports defeat the harness contract.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
};
