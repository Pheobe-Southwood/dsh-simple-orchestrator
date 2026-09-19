import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  { ignores: ['node_modules/**', '*.tgz'] },
  js.configs.recommended,
  {
    // The preset's mask row is loaded by the harness loader from inside the
    // preset directory, so it is linted like the rest of our own code even
    // though it is not part of an importable package entry.
    files: ['eslint.config.js', 'presets/**/*.js', 'test/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.nodeBuiltin,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
]);
