import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `.claude` guarda worktrees — cópias INTEIRAS do repo, cada uma com o seu
  // tsconfig. O flat config do ESLint 10 não lê o .gitignore, então sem esta
  // linha o lint local morre com "multiple candidate TSConfigRootDirs" assim
  // que existir uma sessão paralela aberta (941 erros que não são do código).
  globalIgnores(['dist', 'dist-electron', 'release', 'installer-shell', '.claude']),
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
  },
])
