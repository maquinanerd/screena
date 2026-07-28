import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/**
 * Globais de runtime Node/Web usados nos workers, scripts e libs.
 * Declarados manualmente para nao depender do pacote `globals`.
 */
const runtimeGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  structuredClone: 'readonly',
  globalThis: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
}

export default tseslint.config(
  {
    // Globs recursivos: ignorar build output em QUALQUER nivel (ex.: o
    // `apps/web/.next` gerado por `next build`), nao so na raiz.
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.vitest/**',
      // Arquivo gerado pelo Next (triple-slash refs; "should not be edited").
      '**/next-env.d.ts',
      // Migrations do Payload sao GERADAS por `payload migrate:create` e
      // reescritas a cada geracao. Editar a mao para satisfazer o lint seria
      // desfeito na proxima migration — e o arquivo e um artefato de schema,
      // nao codigo de produto.
      'apps/cms/src/migrations/**',
      // Tipos gerados por `payload generate:types`.
      'apps/cms/src/payload-types.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: runtimeGlobals,
    },
    rules: {
      // Underscore-prefixados sao intencionalmente nao usados (assinaturas/stubs).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Em TypeScript o proprio compilador checa simbolos indefinidos; `no-undef`
    // e redundante e gera falso-positivo com tipos/globais (recomendacao oficial
    // do typescript-eslint).
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-undef': 'off',
    },
  },
  prettier,
)
