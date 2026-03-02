import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Catch blocks and API response handlers use `any` pervasively;
      // switching to `unknown` would require extensive type guards with
      // minimal safety benefit in this UI-only codebase.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Several effects intentionally call setState for toast/fetch-on-mount
      // patterns that are idiomatic in this codebase.
      'react-hooks/set-state-in-effect': 'warn',
      // Context + hook files export both components and non-components.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
