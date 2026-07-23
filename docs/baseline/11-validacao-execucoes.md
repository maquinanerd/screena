# 11 — Execuções de validação (saídas reais)

> Todos os comandos abaixo foram executados nesta auditoria, em ambiente limpo, no SHA
> `73c58e908986e77e49d02226c5bb1b9b4a5fca53`. As saídas são reais, não reproduções de memória.
> Ambiente: Windows 11, Node **v24.14.0** (⚠️ fora do `engines`, ver `00-estado-e-reproducao.md` §2),
> pnpm 9.15.4.

---

## 1. Quadro-resumo

| # | Etapa exigida | Comando | Resultado | Asserções |
| --- | --- | --- | --- | --- |
| 1 | Instalação limpa | `pnpm install --frozen-lockfile` | ✅ EXIT 0 | 287 pacotes resolvidos, 11.3 s |
| 2 | Geração do Prisma Client | `pnpm --filter @screena/db db:generate` | ✅ | Prisma Client v6.19.3 |
| 3 | Migrations em **banco vazio** | `db:validate:real` + smoke | ✅ | **45/45** + `All migrations have been successfully applied` |
| 4 | Migrations sobre **base existente** | `db:validate:upgrade` | ✅ | **23/23** |
| 5 | Lint | `pnpm lint` | ✅ EXIT 0 | sem violações |
| 6 | Typecheck | `pnpm typecheck` | ✅ EXIT 0 | sem erros |
| 6b | Typecheck do wiring runtime | `pnpm typecheck:catalog-runtime` | ✅ EXIT 0 | sem erros |
| 7 | Testes unitários | `pnpm test` | ✅ EXIT 0 | **282 arquivos / 3375 testes**, 42,84 s |
| 8 | Integração (PostgreSQL real) | 12 validadores | ✅ | **636** asserções (detalhe §3) |
| 9 | Contrato | `api:coverage` | ✅ EXIT 0 | 7 providers, 71 endpoints, 34 grupos de campo |
| 10 | E2E | — | ⚠️ **AUSENTE** | nenhum framework E2E no repo (§4) |
| 11 | Auditoria de invariantes | `audit:invariants` | ✅ EXIT 0 | 7 ok / 0 violações / 798 arquivos |
| 12 | Auditoria de render | `audit:render` | ✅ EXIT 0 | 2 ok / 0 violações / 91 arquivos em `apps/web` |
| 13 | Build de produção | `pnpm build` | ✅ EXIT 0 | 27 rotas, Next 15.5.19 |
| 14 | Smoke test | script descartável (§5) | ✅ | **17/17** HTTP real |
| 15 | Rollback | inspeção + idempotência | ⚠️ **PARCIAL** | ver `13-rollback.md` |

**Total de asserções verdes executadas nesta auditoria: 3375 (unitárias) + 653 (PostgreSQL real e smoke) = 4028.**

---

## 2. Saídas literais — qualidade estática

### `pnpm lint`
```
> screena@0.0.0 lint
> eslint .
```
EXIT 0 — sem saída, sem violações.

### `pnpm typecheck`
```
> screena@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit
```
EXIT 0.

> ⚠️ `tsconfig.json` **exclui** `persistence/**`, `bin/**` e `composition.ts` (dependem do Prisma
> Client gerado). Essa região é coberta pelo gate separado `typecheck:catalog-runtime`, que a CI
> roda depois do `db:generate` (`.github/workflows/ci.yml:52-58`). Ambos passaram.

### `pnpm test`
```
 Test Files  282 passed (282)
      Tests  3375 passed (3375)
   Duration  42.84s
```
EXIT 0. Nenhum teste `skipped`.

### `pnpm audit:invariants`
```
OK:
  [ok]   CLAUDE.md: todas as 11 frases-chave presentes.
  [ok]   .claude/rules/ratings.md: todas as 5 frases-chave presentes.
  [ok]   .claude/rules/seo.md: todas as 3 frases-chave presentes.
  [ok]   .claude/rules/ingestion.md: todas as 2 frases-chave presentes.
  [ok]   .claude/rules/i18n.md: todas as 2 frases-chave presentes.
  [ok]   .claude/rules/entity-writer.md: todas as 2 frases-chave presentes.
  [ok]   Varredura de padroes proibidos concluida em 798 arquivo(s).
Resumo: 7 ok, 0 aviso(s), 0 violacao(oes).
Resultado: PASSOU. Invariantes intactas.
```

> ⚠️ Este auditor valida **presença de frases nos documentos** e ausência de padrões proibidos no
> código. Ele **não** valida que os documentos estejam corretos — e não estão (ver
> `12-divergencias-doc-codigo.md`). Um `CLAUDE.md` factualmente desatualizado passa neste gate.

### `pnpm audit:render` (invariantes 3 e 4)
```
  [ok]   apps/web varrido: 91 arquivo(s) de codigo analisado(s).
  [ok]   host de imagem TMDB verificado repo-wide: 509 arquivo(s) de producao;
         literal permitido so em packages/public-contracts/src/media-url.ts.
Resumo: 2 ok, 0 aviso(s), 0 violacao(oes).
Resultado: PASSOU. Render puro de IO externo.
```

### `pnpm api:coverage`
```
  [ok]   providers.yaml: 7 provider(s) tecnico(s) catalogado(s).
  [ok]   endpoints.json: 71 endpoint(s)/capacidade(s) classificado(s).
  [ok]   fields.json: 34 grupo(s) de campo classificado(s).
  [ok]   TMDB endpoints: 6 metodo(s)-endpoint conferido(s) contra o registro.
  [ok]   TMDB catalog endpoints: 32 metodo(s)-endpoint conferido(s) contra o registro.
  [ok]   Film & Show Ratings client: 2 metodo(s)-endpoint conferido(s).
  [ok]   Streaming Availability client: 5 metodo(s)-endpoint conferido(s).
Resultado: PASSOU. Registro de cobertura consistente com o codigo.
```

---

## 3. Integração em PostgreSQL 16 real

Cada validador sobe um Postgres 16 efêmero (`embedded-postgres`), aplica as migrations, semeia e
derruba tudo. **Nenhum banco remoto é tocado.**

| Validador | Escopo | Resultado |
| --- | --- | --- |
| `@screena/db db:validate:real` | Migrations do zero + seed (Cenário A) | **45/45** |
| `@screena/db db:validate:upgrade` | Migration sobre estado anterior / backfills (Cenário B) | **23/23** |
| `@screena/db db:validate:user-persistence` | Migration C7A/C7A.1 (recomendações, tracking) | **58/58** |
| `@screena/db db:validate:pgcrypto` | pgcrypto sob `search_path` hostil | **10/10** |
| `@screena/user-platform validate:user-product` | Adapters de identidade/credencial/sessão/token | **141/141** |
| `@screena/ingestion validate:catalog-platform-complete` | Fila de jobs + busca + indexabilidade | **78/78** |
| `@screena/ingestion validate:tmdb-platform` | Catálogo/mídia/discovery TMDB | **15/15** |
| `@screena/web validate:all` | 5 validadores de página (agregado) | **118/118** |
| `@screena/web validate:seo-runtime` | SEO como fonte única, sitemap paginado | **36/36** |
| `@screena/web validate:season-episode-routes` | Rotas de temporada/episódio | **32/32** |
| `validate:external-intelligence-product` | Ratings, streaming, licenças, Cinerie Score | **51/51** |
| `validate:source-authorization-and-attribution` | Autorização de fontes e atribuição | **18/18** |
| `@screena/streaming validate:stores` | Stores de streaming governados | **11/11** |
| **Total** | | **636/636** |

Detalhe do agregado `validate:all`:
```
[PASS] validate:news-pages      19/19
[PASS] validate:entity-indexes  20/20
[PASS] validate:movie-page      27/27
[PASS] validate:series-page     26/26
[PASS] validate:person-page     26/26
Total agregado: 118/118 assercoes OK em 5 validadores.
```

### 3.1 Achado: `db:validate:pgcrypto` **não roda na CI**

`.github/workflows/ci.yml` executa `db:validate:real`, `db:validate:upgrade` e
`db:validate:user-persistence`, mas **não** `db:validate:pgcrypto`. Esse validador cobre exatamente
o incidente de produção corrigido no PR #73 (`digest()` fora do schema sob `search_path` hostil).
Foi executado manualmente aqui e passou 10/10, mas **nada impede a regressão de voltar**.
Risco **R-03** em `08-riscos.md`.

---

## 4. Testes E2E — ausentes

```bash
# nenhum framework E2E declarado em nenhum package.json do repositório
grep -rl "playwright\|cypress\|puppeteer\|@testing-library" --include=package.json .
# (sem resultados fora de node_modules)
```

Não existe suíte E2E de navegador. A cobertura de jornada do usuário é feita por:
- validadores de página que renderizam presenters contra PostgreSQL real (118 asserções);
- o smoke test HTTP desta auditoria (§5).

Isso **não** cobre JavaScript de cliente, formulários de autenticação no navegador, nem regressão
visual. Risco **R-05**.

---

## 5. Smoke test (HTTP real contra o build de produção)

Script descartável executado e **removido** após a coleta (a árvore permaneceu limpa). Fluxo:
Postgres 16 efêmero → `prisma migrate deploy` em banco **vazio** → `prisma db seed` →
`next start` (build de produção) → requisições HTTP reais.

```
[PASS]  1. PG efemero (PostgreSQL 16) iniciado
[PASS]  2. migrate deploy em banco VAZIO — All migrations have been successfully applied.
[PASS]  3. migrate deploy e idempotente (2a execucao) — No pending migrations to apply.
[PASS]  4. prisma db seed executou
[PASS]  5. `next start` respondeu (servidor de producao no ar)
[PASS]  6. GET /pt/                  status=200 bytes=13174
[PASS]  7. GET /pt/filmes/           status=200 bytes=12564
[PASS]  8. GET /pt/series/           status=200 bytes=12566
[PASS]  9. GET /pt/pessoas/          status=200 bytes=12891
[PASS] 10. GET /pt/noticias/         status=200 bytes=12542
[PASS] 11. GET /pt/busca/            status=200 bytes=11848
[PASS] 12. GET /pt/explorar/         status=200 bytes=14967
[PASS] 13. GET /robots.txt           status=200 bytes=27
[PASS] 14. GET /sitemap.xml          status=200 bytes=122
[PASS] 15. URL sem barra final -> 308 para a canonica — location=/pt/filmes/
[PASS] 16. robots.txt bloqueia indexacao em origem NAO oficial — "User-Agent: * | Disallow: /"
[PASS] 17. entidade inexistente responde 404 (nao 200 com pagina vazia)
RESUMO (smoke): 17/17 checks OK.
```

O que isto prova, concretamente:

1. O **build de produção sobe** e serve todas as rotas públicas com banco vazio, sem quebrar.
2. A **canonicalização por barra final** funciona (`trailingSlash: true`, `apps/web/next.config.ts:25`) —
   `/pt/filmes` → 308 → `/pt/filmes/`.
3. O **kill switch de indexação é fail-closed**: com origem diferente da oficial, `robots.txt`
   emite `Disallow: /`. Nenhum ambiente de preview indexa por acidente.
4. Entidade inexistente devolve **404 real**, não 200 com página vazia — coerente com "noindex só em
   caso técnico".
5. `prisma migrate deploy` é **idempotente** (base do procedimento de redeploy).

### 5.1 Ressalva honesta sobre o smoke

As páginas responderam 200 com o **catálogo vazio** (o seed não insere entidades — ver
`10-catalogo-contagens.md`). Os 12–15 KB por página são o estado vazio honesto renderizado, não
conteúdo de catálogo. O smoke prova que **a aplicação sobe e serve**, não que ela exibe catálogo.

---

## 6. Build de produção

```
▲ Next.js 15.5.19
✓ Compiled successfully in 19.9s
✓ Generating static pages (6/6)

Route (app)                                                    Size  First Load JS
┌ ○ /_not-found                                               991 B         103 kB
├ ƒ /api/auth/email-verification/confirm                      176 B         102 kB
├ ƒ /api/auth/email-verification/request                      176 B         102 kB
├ ƒ /api/auth/password-reset/confirm                          176 B         102 kB
├ ƒ /api/auth/password-reset/request                          176 B         102 kB
├ ƒ /api/seo/redirect                                         176 B         102 kB
├ ○ /dev/movie-page-preview                                   176 B         102 kB
├ ○ /filmes                                                   176 B         102 kB
├ ƒ /pt                                                       176 B         102 kB
├ ƒ /pt/busca                                                 176 B         102 kB
├ ƒ /pt/explorar                                              176 B         102 kB
├ ƒ /pt/filmes                                                176 B         102 kB
├ ƒ /pt/filmes/[slug]                                         176 B         102 kB
├ ƒ /pt/noticias                                              176 B         102 kB
├ ƒ /pt/noticias/[slug]                                       176 B         102 kB
├ ƒ /pt/pessoas                                               176 B         102 kB
├ ƒ /pt/pessoas/[slug]                                        176 B         102 kB
├ ƒ /pt/redefinir-senha                                     1.04 kB         103 kB
├ ƒ /pt/series                                                176 B         102 kB
├ ƒ /pt/series/[slug]                                         176 B         102 kB
├ ƒ /pt/series/[slug]/temporadas/[season]                     176 B         102 kB
├ ƒ /pt/series/[slug]/temporadas/[season]/episodios/[episode] 176 B         102 kB
├ ƒ /pt/verificar-email                                       752 B         103 kB
├ ƒ /robots.txt                                               176 B         102 kB
├ ○ /series                                                   176 B         102 kB
├ ƒ /sitemap.xml                                              176 B         102 kB
└ ƒ /sitemaps/[shard]                                         176 B         102 kB
+ First Load JS shared by all                                102 kB
ƒ Middleware                                                34.7 kB
```

Observações factuais:
- **27 rotas**; 23 dinâmicas (`ƒ`, server-rendered on demand), 4 estáticas (`○`).
- **5 rotas declaram ISR** (`export const revalidate = 3600`): as 5 páginas de detalhe de entidade
  (filme, série, temporada, episódio, pessoa). Elas aparecem como `ƒ` no build porque **nenhuma
  rota do app declara `generateStaticParams`** — nada é pré-renderizado em build; o HTML é gerado
  sob demanda e então cacheado pela janela de 3600 s. As outras 12 páginas são `force-dynamic`
  (sem cache). Detalhe por rota em [`04-rotas-e-apis.md`](04-rotas-e-apis.md).
- O bundle compartilhado é **102 kB** — nenhuma rota adiciona peso relevante de cliente
  (máximo 1,04 kB), coerente com uma aplicação majoritariamente RSC.
- ⚠️ Aviso emitido: `The Next.js plugin was not detected in your ESLint configuration` — o lint
  atual **não** aplica as regras específicas do Next (risco **R-09**).
- ⚠️ `/dev/movie-page-preview` é publicada no build de produção. É inofensiva
  (`robots: { index: false, follow: false }`, `apps/web/app/dev/movie-page-preview/page.tsx:5` e
  sem dado simulado), mas é superfície pública desnecessária (risco **R-12**).
