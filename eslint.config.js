import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'server/prisma/migrations/**',
      // shadcn output is generated; extend by wrapping instead of editing (SPEC §11).
      'client/src/components/ui/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // SPEC §13: no `any`, no `@ts-ignore`. These are errors, not warnings.
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
    },
  },

  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    files: ['server/prisma/seed.ts'],
    // The seed script reports progress to a terminal; it has no logger of its own.
    rules: { 'no-console': 'off' },
  },

  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['**/*.config.{ts,js}', '**/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
