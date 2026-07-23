# 08 — Registro de riscos (P0 · P1 · P2 · P3)

> **Leia a coluna "Verificação" antes de agir.** Este baseline distingue rigorosamente:
>
> | Marca | Significado |
> | --- | --- |
> | ✅ **direta** | O autor do baseline abriu o arquivo / rodou o comando e confirmou pessoalmente. |
> | ⚠️ **não verificado** | Levantado por agente auxiliar de inventário. A passagem de verificação adversarial **falhou por limite de sessão** e não foi executada. Trate como *lead investigativo*, não como fato. |
>
> Nenhum risco ⚠️ deve virar decisão de engenharia sem confirmação. Ver `14-limitacoes-desta-auditoria.md`.

Critério de severidade:
- **P0** — impede operar produção com segurança, ou pode causar perda/corrupção de dado ou exposição.
- **P1** — quebra uma invariante, um gate de qualidade, ou induz o engenheiro ao erro.
- **P2** — degrada manutenção, observabilidade ou confiança.
- **P3** — ruído, dívida cosmética ou risco remoto.

---

## P0 — bloqueia produção

| # | Risco | Evidência | Verificação |
| --- | --- | --- | --- |
| **R-01** | **O checkout primário roda governança obsoleta.** `main` local estava 47 commits atrás de `origin/main`; o `CLAUDE.md` daquele branch ainda declara marca "Screen" e domínio `thescreen.media`, ambos abandonados no PR #72. Qualquer pessoa ou agente que abra o checkout primário recebe regras erradas *como se fossem autoritativas*. | `git rev-list --left-right --count main...origin/main` → `0 47`; `CLAUDE.md:9-10` em `origin/main` vs. o do checkout primário | ✅ direta |
| **R-02** | **Backup nunca foi executado nem validado.** A CI só roda `bash -n` (checagem de sintaxe) nos scripts. O próprio repositório proíbe operar sem isso: "Sem backup validado, sem sync/promote em producao." Como não há down-migration, o restore de dump é o **único** caminho de rollback de schema. | `.github/workflows/ci.yml:33-37`; `scripts/backup/README.md:13`; ausência de `*down*`/`*rollback*` em `packages/db/prisma/migrations/` | ✅ direta |
| **R-03** | **`db:validate:pgcrypto` não roda em lugar nenhum.** É o validador escrito para pegar exatamente o incidente de produção do PR #73 (`digest()` fora do schema sob `search_path` hostil). Existe, passa 10/10 quando chamado à mão — mas não está na CI nem em nenhum agregador. A regressão pode voltar sem ninguém notar. | `.github/workflows/ci.yml` (não contém `pgcrypto`); execução manual: 10/10 | ✅ direta |
| **R-04** | **Catálogo vazio + nenhum censo de produção.** O seed insere **zero** entidades de entretenimento. Não existe comando que reporte contagem de catálogo. Ninguém sabe, a partir do repositório, quanto conteúdo existe em produção. | `10-catalogo-contagens.md` §1 | ✅ direta |

---

## P1 — quebra invariante ou gate

| # | Risco | Evidência | Verificação |
| --- | --- | --- | --- |
| **R-05** | **`pnpm typecheck` não cobre `apps/**`.** O `include` do `tsconfig.json` é `packages/**`, `api-clients/**`, `services/**`, `tests/**`. `apps/web` só é checado indiretamente por `next build`; **`apps/admin` não tem nenhum gate de tipo** — a CI só builda `@screena/web`. | `tsconfig.json` `include`; `package.json:14` (`build` = `--filter @screena/web`) | ✅ direta |
| **R-06** | **`vitest` não coleta testes em `apps/**`.** O `include` cobre `tests/**`, `packages/**`, `api-clients/**`, `services/**`. Um teste criado dentro de `apps/web` ou `apps/admin` **passa a existir sem nunca rodar** — falha silenciosa, o pior modo de falha de suíte. | `vitest.config.ts:6-11` | ✅ direta |
| **R-07** | **`PUBLISHED_LOCALES` existe duas vezes com valores diferentes.** Canônico em `@screena/config` = `["pt-BR","pt"]`; duplicata hard-coded em `apps/web` = `["pt"]`. Ligar `en` no invariante canônico **não** afeta o redirect de locale raiz. | `packages/config/src/invariants.ts:164` vs `apps/web/src/lib/root-locale.ts:7` | ✅ direta |
| **R-08** | **`.env.example` documenta chaves de provider que nenhum código lê.** Ele ensina `SCREENA_RATINGS_PROVIDER_KEY` e `SCREENA_STREAMING_PROVIDER_KEY`; os clients exigem `RAPIDAPI_FILM_SHOW_RATINGS_KEY` e `RAPIDAPI_STREAMING_AVAILABILITY_KEY`. Seguir o template resulta em falha dura de configuração. | `.env.example:56,59` vs `api-clients/film_show_ratings/src/config.ts:27,36` e `api-clients/streaming_availability/src/config.ts:26,35` | ✅ direta |
| **R-09** | **`.env.example` omite as variáveis obrigatórias de auth/e-mail e do admin.** Nenhuma `BREVO_*` (runtime de auth já **wired em produção**) nem `ADMIN_BASIC_AUTH_*` (proteção obrigatória do admin) aparecem no template. | `.env.example` (ausência); `services/user-platform/src/auth-runtime/config.ts:24`; `apps/admin/src/lib/access-protection.ts:54-55` | ✅ direta |
| **R-10** | **Node do ambiente ≠ Node exigido.** O repo exige `>=22 <23`; esta auditoria rodou em v24.14.0, com aviso em todos os comandos. Tudo passou, mas nada aqui prova o comportamento sob Node 22 nesta máquina. | `package.json:10`; avisos `Unsupported engine` em toda execução | ✅ direta |
| **R-11** | **Migrations contêm 68 bytes não-ASCII, inclusive dentro de literais executáveis `RAISE EXCEPTION`** — enquanto o próprio repo documenta que um caractere fora de ASCII faz o `migrate deploy` **FALHAR** sob cliente psql em WIN1252. O teste que trava isso cobre **1 de 12** migrations. | Censo próprio: 60 `—` + acentuados; `20260717120000_.../migration.sql:453,456,466` (dentro de `RAISE EXCEPTION`); hazard documentado em `20260721140000_.../migration.sql:6-8`; guarda em `tests/governance/user-platform-persistence-foundation.test.ts:193-195` (lê só `trackingSql`) | ✅ direta |
| **R-12** | **`.claude/rules/i18n.md` ainda exige o gate anti-thin removido** (§64, §129, §146), e `.claude/rules/seo.md:174` se contradiz internamente com `seo.md:32`. Um agente que siga as regras bloqueará indexação que a política atual manda liberar. | `12-divergencias-doc-codigo.md` D-3, D-4 | ✅ direta |
| **R-13** | **Admin escreve no banco, mas a documentação diz "read-only".** As ações editoriais são reais (`prisma.*.update`) e ficam atrás de flag padrão-desligada. O risco é de *expectativa*: quem lê a doc não revisa esse caminho de escrita. | `apps/admin/src/server/editorial-actions.ts:98,103,130,210,244`; `CLAUDE.md` §5 | ✅ direta |
| **R-14** | **`CLAUDE.md` §5 omite 6 workspaces reais** (`cinerie-score`, `public-contracts`, `legal`, `user-platform`, `ratings`, `streaming`) ≈ 48 mil linhas, e lista como canônico o `seo/` da raiz, que é **código morto**. | `12-divergencias-doc-codigo.md` D-2, D-5 | ✅ direta |
| **R-15** | O guard de pureza de render usa regex de **uma linha** com denylist fechada de ~9 hosts. Uma URL quebrada em duas linhas, guardada em variável, ou apontando para host fora da lista (ex.: `api.brevo.com`, Sentry, S3) passaria. | `scripts/audit/check-render-purity.mjs` (padrões `FETCH_PATTERNS`) | ⚠️ **não verificado** |
| **R-16** | Um server component público poderia importar `@screena/user-platform` (capaz de rede) sem nenhum gate falhar: é dependência declarada de `@screena/web` e está em `transpilePackages`. | `apps/web/package.json`; `apps/web/next.config.ts:38` | ⚠️ **não verificado** |
| **R-17** | Ratings seriam **código morto no app público**: caminho de leitura governado existe, sem nenhum chamador. | agente `services-external` | ⚠️ **não verificado** |
| **R-18** | O painel público de "onde assistir" não renderizaria a atribuição/linkback exigida pelos termos do provider — risco **jurídico/licença**. | agente `services-external` | ⚠️ **não verificado** |
| **R-19** | A fila de jobs de catálogo (caminho de ingestão mais novo) não escreveria em `api_sync_logs`, violando "todo sync externo gera log". | agente `services-ingestion-sync` | ⚠️ **não verificado** |
| **R-20** | Filtragem de conteúdo adulto seria fail-closed no caminho de Daily ID Exports, mas **não** no caminho `/changes`. | agente `services-ingestion-sync` | ⚠️ **não verificado** |
| **R-21** | `projectPublicIndexability(null)` e `mergePersistedDecision(live, null)` discordariam sobre "sem decisão persistida" — e **nenhum writer de produção cria linhas de decisão**, então os dois consumidores divergiriam para toda entidade. | agente `packages-seo` | ⚠️ **não verificado** |
| **R-22** | O guia de deploy declarado ativo (EasyPanel/Nixpacks + `standalone` server.js) descreveria um mecanismo **inexistente** no repo, enquanto o real (Dockerfile + `next start`) não é citado nele. Momento de aplicar migration se contradiz em três documentos. | agente `build-deploy`; `Dockerfile:69` | ⚠️ **não verificado** |
| **R-23** | Cliente TMDB v3 colocaria a API key na **querystring**, prática que o próprio `rapidapi-core` proíbe (a URL vaza em chave de cache e em log). | agente `api-clients` | ⚠️ **não verificado** |

---

## P2 — degrada manutenção e confiança

| # | Risco | Evidência | Verificação |
| --- | --- | --- | --- |
| **R-24** | **Sem testes E2E.** Nenhum Playwright/Cypress no repositório. Nenhuma cobertura de JS de cliente, formulário de auth no navegador ou regressão visual. | `11-validacao-execucoes.md` §4 | ✅ direta |
| **R-25** | **Sem `not-found.tsx`, `error.tsx` ou `global-error.tsx`** em `apps/web` nem `apps/admin`. Um erro de render entrega a página padrão do Next, sem identidade e sem controle de `robots`. O 404 funciona, mas é o default. | `find apps/web/app apps/admin/app -name "not-found.tsx" -o -name "error.tsx"` → vazio | ✅ direta |
| **R-26** | **ESLint não carrega o plugin do Next.** O build avisa: `The Next.js plugin was not detected in your ESLint configuration`. Regras de Next (imagem, link, hooks) não são aplicadas. | saída de `pnpm build` | ✅ direta |
| **R-27** | **Sem `HEALTHCHECK` no `Dockerfile`.** O orquestrador não distingue contêiner no ar de contêiner degradado. | `Dockerfile` (69 linhas, sem `HEALTHCHECK`) | ✅ direta |
| **R-28** | **`seo/` na raiz é código morto** (224 linhas, zero importadores, fora dos aliases) e ainda assim é listado no `CLAUDE.md` como a lógica de SEO. Risco de alguém editar o arquivo errado. | `12-divergencias-doc-codigo.md` D-2 | ✅ direta |
| **R-29** | **`audit:invariants` dá falsa sensação de sincronia.** Ele valida presença de frases nos documentos e ausência de padrões proibidos no código — passa com 0 violações mesmo com as 11 divergências documentadas em `12-...`. | `scripts/audit/check-invariants.mjs`; `12-divergencias-doc-codigo.md` §3 | ✅ direta |
| **R-30** | **CI só dispara em `main`.** `on: push/pull_request → branches: [main]`. Trabalho em branch de longa duração fica sem sinal até abrir PR para `main`. | `.github/workflows/ci.yml:3-9` | ✅ direta |
| **R-31** | `tsconfig.runtime.json` seria uma *allow-list*, recuperando só ~3 das ~19 regiões excluídas — o comentário da CI ("compila exatamente essa região") superestimaria a cobertura. | agente `tests-ci`; `.github/workflows/ci.yml:52-58` | ⚠️ **não verificado** |
| **R-32** | Superfícies polimórficas (`search_documents`, `discovery_snapshot_items`) ficariam sem integridade referencial, contra a regra D1 do próprio schema; FKs compostas adicionadas em bloco condicional `IF EXISTS` podem ser silenciosamente puladas. | agente `prisma-data-map` | ⚠️ **não verificado** |
| **R-33** | `watch_availability_display_guard()` seria definida duas vezes com corpos diferentes; como `migrate deploy` compara só **nomes**, drift de corpo de função é indetectável pela tabela de migrations. | agente `prisma-migrations` | ⚠️ **não verificado** |
| **R-34** | `docs/frontend/page-map.md` — apontado pelo `CLAUDE.md` §10 como contrato de escopo de telas — omitiria 7 das 18 rotas de página e todas as 8 rotas de handler. | agente `web-routes` | ⚠️ **não verificado** |

---

## P3 — ruído e dívida menor

| # | Risco | Evidência | Verificação |
| --- | --- | --- | --- |
| **R-35** | `services/news-ingestion`, `api-clients/imdb` e `api-clients/kaso` contêm **apenas `README.md`** — sugerem capacidade inexistente. `.claude/rules/ingestion.md:5` cita `news-ingestion` como serviço ativo. | `ls` dos três diretórios | ✅ direta |
| **R-36** | `database/migrations/` está **vazio** e `database/seeds/` tem só README, embora o `CLAUDE.md` os descreva como "documentação histórica de modelagem". | `ls database/` | ✅ direta |
| **R-37** | `/dev/movie-page-preview` é publicada no build de produção. Inofensiva (`robots: {index:false,follow:false}`, sem dado simulado), mas é superfície pública sem propósito em produção. | `apps/web/app/dev/movie-page-preview/page.tsx:5` | ✅ direta |
| **R-38** | Faltam aliases de TypeScript para `@screena/public-contracts`, `@screena/cinerie-score` e `@screena/user-platform`, criando duas formas de resolver pacote interno. | `tsconfig.base.json:12-20` | ✅ direta |
| **R-39** | Validadores deixam diretórios temporários de Postgres para trás no Windows (`EBUSY`/`EPERM` no cleanup). Não afeta correção; consome disco. | saídas de `db:validate:*` | ✅ direta |
| **R-40** | 20 worktrees git ativos, vários apontando para branches já mergeadas — ruído operacional e risco de editar a árvore errada. | `git worktree list` | ✅ direta |

---

## Resumo por severidade

| Severidade | ✅ verificados | ⚠️ não verificados | Total |
| --- | ---: | ---: | ---: |
| **P0** | 4 | 0 | **4** |
| **P1** | 10 | 9 | **19** |
| **P2** | 7 | 4 | **11** |
| **P3** | 6 | 0 | **6** |
| **Total** | **27** | **13** | **40** |

### Os três primeiros passos recomendados

1. **R-01** — sincronizar o checkout primário com `origin/main` antes de qualquer trabalho novo.
   É pré-requisito de tudo: hoje se trabalha contra governança errada.
2. **R-03** + **R-05** + **R-06** — três gates que existem mas não protegem nada
   (`pgcrypto` fora da CI, typecheck sem `apps/**`, vitest sem `apps/**`). São correções de
   uma linha cada, com retorno alto e risco quase nulo.
3. **R-02** — executar um `backup.sh` + `restore-test.sh` reais antes de qualquer carga de produção.
   É a regra que o próprio repositório impõe e que nunca foi cumprida.
