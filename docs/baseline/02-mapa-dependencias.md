# 02 — Mapa de dependências

> Grafo real de dependências internas do monorepo, extraído dos `package.json` de cada workspace
> (`dependencies` + `devDependencies` com `workspace:*`). SHA `73c58e9`.

---

## 1. Workspaces declarados

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'api-clients/*'
  - 'services/*'
```

**22 workspaces com `package.json`** + 3 diretórios que casam com o glob mas **não têm**
`package.json` (ver §4).

---

## 2. Grafo de dependências internas

| Workspace | Nome do pacote | Depende de |
| --- | --- | --- |
| `packages/config` | `@screena/config` | *(raiz — nenhuma)* |
| `packages/types` | `@screena/types` | *(raiz — nenhuma)* |
| `api-clients/rapidapi-core` | `@screena/rapidapi-core` | *(raiz — nenhuma)* |
| `api-clients/tmdb` | `@screena/tmdb-client` | *(raiz — nenhuma)* |
| `packages/db` | `@screena/db` | `config` |
| `packages/schemas` | `@screena/schemas` | `config` |
| `packages/seo` | `@screena/seo` | `config` |
| `packages/ui` | `@screena/ui` | `config` |
| `packages/cinerie-score` | `@screena/cinerie-score` | `config` |
| `packages/public-contracts` | `@screena/public-contracts` | `config` |
| `api-clients/film_show_ratings` | `@screena/film-show-ratings-client` | `rapidapi-core` |
| `api-clients/streaming_availability` | `@screena/streaming-availability-client` | `rapidapi-core` |
| `services/legal` | `@screena/legal` | `config`, `db` |
| `services/user-platform` | `@screena/user-platform` | `config`, `db` |
| `services/entity-writer` | `@screena/entity-writer` | `db`, `schemas` |
| `services/streaming` | `@screena/streaming` | `db`, `rapidapi-core`, `streaming-availability-client` |
| `services/ingestion` | `@screena/ingestion` | `db`, `public-contracts`, `seo`, `tmdb-client` |
| `services/sync` | `@screena/sync` | `db`, `ingestion` |
| `services/ratings` | `@screena/ratings` | `cinerie-score`, `config`, `db`, `film-show-ratings-client`, `rapidapi-core`, `schemas` |
| `apps/admin` | `@screena/admin` | `db` |
| **`apps/web`** | `@screena/web` | `db`, `public-contracts`, `seo`, `types`, `ui`, `user-platform` |

O grafo é **acíclico** e em camadas: `config`/`types` na base → pacotes puros → serviços → apps.

---

## 3. O achado mais importante: pureza de render é ESTRUTURAL

`apps/web` **não declara dependência de nenhum api-client externo nem do Entity Writer**:

```
apps/web -> @screena/db, @screena/public-contracts, @screena/seo,
            @screena/types, @screena/ui, @screena/user-platform
```

Consequência prática, verificada:

```bash
grep -rn "@screena/tmdb-client\|@screena/rapidapi-core\|@screena/entity-writer\|\
GoogleGenerativeAI\|generativelanguage" --include="*.ts" --include="*.tsx" apps/web/
# (nenhum resultado)
```

> **As invariantes 3 (zero API externa no render) e 4 (zero Gemini no render) não dependem apenas
> de disciplina ou de um linter: elas são impostas pelo grafo de dependências.** O app público não
> consegue sequer *resolver* o módulo do TMDB, do RapidAPI ou do adapter Gemini. Essa é a forma mais
> forte de garantia — falha em tempo de resolução, não em revisão de código.

O auditor `pnpm audit:render` (`scripts/audit/check-render-purity.mjs`) é a segunda camada, varrendo
91 arquivos de `apps/web` e 509 arquivos de produção repo-wide.

### 3.1 Única aresta com capacidade de rede em `apps/web`

`@screena/user-platform` é a exceção: ele fala com a **Brevo** (e-mail transacional) e lê
`BREVO_API_KEY`. Isso **não** viola a invariante 3, porque:

- é alcançado apenas pelas rotas `/api/auth/**`, que são **route handlers**, não páginas indexáveis;
- as 4 rotas de auth aparecem no build como `ƒ` (dinâmicas) e não entram em sitemap;
- `next.config.ts:30-39` declara `@screena/user-platform` em `transpilePackages` com comentário
  explícito de que é **server-only** e que "a chave da Brevo nunca entra no bundle do cliente";
- existe teste de fronteira dedicado provando o isolamento
  (`services/user-platform/src/auth-runtime/__tests__/boundary.test.ts:194,214`).

Os únicos `fetch()` de `apps/web` são **client-side para a própria origem**:

```
apps/web/app/pt/redefinir-senha/token-form.tsx:53   fetch('/api/auth/password-reset/confirm')
apps/web/app/pt/verificar-email/token-form.tsx:30   fetch('/api/auth/email-verification/confirm')
```

Nenhuma chamada externa em nenhum caminho de render.

---

## 4. Diretórios que casam com o glob mas não são pacotes

| Diretório | Conteúdo | Classificação |
| --- | --- | --- |
| `services/news-ingestion` | somente `README.md` | **ausente** |
| `api-clients/imdb` | somente `README.md` | **ausente** |
| `api-clients/kaso` | somente `README.md` | **ausente** |

Sem `package.json`, o pnpm simplesmente os ignora — não quebram o install, mas **sugerem
capacidade que não existe**. Quem lê a árvore acredita que há um client IMDb; não há.
Risco **R-11** (P3).

---

## 5. Aliases de TypeScript

`tsconfig.base.json:12-20` e `vitest.config.ts:14-22` declaram os mesmos 6 aliases:

| Alias | Destino |
| --- | --- |
| `@screena/config` | `packages/config/src/index.ts` |
| `@screena/schemas` | `packages/schemas/src/index.ts` |
| `@screena/seo` | `packages/seo/src/index.ts` |
| `@screena/ui` | `packages/ui/src/index.ts` |
| `@screena/types` | `packages/types/src/index.ts` |
| `@screena/db` | `packages/db/src/index.ts` |

⚠️ **Não há alias** para `@screena/public-contracts`, `@screena/cinerie-score` nem
`@screena/user-platform`, embora os três sejam consumidos por `apps/web`/serviços. Eles resolvem via
`node_modules` do pnpm (`main: ./src/index.ts`), o que funciona, mas cria **duas formas diferentes**
de resolver pacotes internos. Risco **R-10** (P3).

---

## 6. Tamanho de cada workspace (código TS/TSX, sem `node_modules`)

| Workspace | Arquivos | Linhas |
| --- | ---: | ---: |
| `services/user-platform` | 174 | 31.626 |
| `services/ingestion` | 182 | 28.643 |
| `apps/web` | 119 | 19.350 |
| `apps/admin` | 40 | 8.832 |
| `services/entity-writer` | 58 | 8.019 |
| `services/ratings` | 39 | 7.531 |
| `services/streaming` | 35 | 5.615 |
| `packages/db` | 8 | 2.426 |
| `api-clients/tmdb` | 14 | 2.322 |
| `packages/seo` | 18 | 2.139 |
| `packages/public-contracts` | 11 | 1.868 |
| `services/legal` | 9 | 1.852 |
| `api-clients/rapidapi-core` | 11 | 1.256 |
| `packages/schemas` | 5 | 783 |
| `api-clients/streaming_availability` | 6 | 731 |
| `api-clients/film_show_ratings` | 6 | 603 |
| `packages/cinerie-score` | 4 | 559 |
| `packages/config` | 4 | 403 |
| `packages/ui` | 3 | 277 |
| `services/sync` | 4 | 110 |
| `packages/types` | 1 | 94 |
| `services/news-ingestion` | 0 | 0 |
| `api-clients/imdb` | 0 | 0 |
| `api-clients/kaso` | 0 | 0 |
| **Total** | **750** | **125.039** |

Observação: `services/sync` tem apenas 110 linhas — é um orquestrador fino sobre `ingestion`,
não um serviço completo. `packages/ui` (277 linhas) é muito menor do que a documentação sugere.
