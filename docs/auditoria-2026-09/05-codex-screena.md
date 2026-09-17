<!-- FASE 2 — REVISAO CEGA do Codex (gpt-5.6-terra, reasoning=high), 2026-09-01 ~05:00.
O Codex NAO teve acesso a nenhum relatorio meu: o screena foi revisado num clone limpo de
origin/main sem docs/auditoria-2026-09; os outros tres nao contem a auditoria.
Comando: codex exec --sandbox read-only --skip-git-repo-check -C <repo> - < <prompt>
Texto integral do modelo, sem edicao de conteudo. -->

Cobertura: abri 47 de 2174 arquivos versionados (2,2%).

## 5 achados mais graves

1. **Crítico — autopublicação existe, é configurável e chega a `published`, contrariando o “NUNCA publicar conteúdo automaticamente” canônico.** [MEDIDO-CÓDIGO] `CLAUDE.md:201`; `apps/cms/src/endpoints/editorial-publications.ts:345,404,1129,1177`; `apps/cms/src/workflow.ts:105-120`.

2. **Alto — testes ratificam explicitamente a violação, e a auditoria de invariantes passa mesmo assim.** [MEDIDO-CÓDIGO] `apps/cms/src/__tests__/auto-publication.test.ts:79`; `apps/cms/src/__tests__/auto-publication.integration.test.ts:280,370`; `scripts/audit/check-invariants.mjs:9-17`. [MEDIDO-EXECUÇÃO] `pnpm audit:invariants` passou.

3. **Alto — RapidAPI, que o dono declarou aposentada, continua como caminho executável, com chaves, clients e workers.** [MEDIDO-CÓDIGO] `.env.example:101,117`; `services/ratings/bin/sync-film-show-ratings.ts:211-213`; `services/streaming/bin/sync-streaming-availability.ts:152-160`; `services/ratings/package.json:28-31`.

4. **Médio — o sinal verde de governança é estreito: ele verifica palavras em documentação e poucos padrões, não confronta a proibição de autopublicação com o fluxo executável.** [MEDIDO-CÓDIGO] `scripts/audit/check-invariants.mjs:9-17,43-80`. Consequência: CI pode declarar “invariantes intactas” enquanto o CMS contraria uma delas.

5. **Médio — metadado do admin afirma que ele nunca escreve, mas o app contém ações editoriais habilitáveis por ambiente.** [MEDIDO-CÓDIGO] `apps/admin/package.json:6`; `apps/admin/app/page.tsx:10-13`; `apps/admin/app/workflow/page.tsx:26-32`.

## D1 — Estrutura e build

É um monorepo pnpm/TypeScript com Next público, CMS Payload, admin, Prisma/PostgreSQL e workers de ingestão/editorial. Há CI extensa, mas a arquitetura declarada é maior que a cobertura desta auditoria. O deploy parece ser por Docker/VPS; não validei uma implantação real. [MEDIDO-CÓDIGO] `package.json:1-54`; `.github/workflows/ci.yml`.

- `pnpm typecheck` passou. [MEDIDO-EXECUÇÃO]
- `pnpm lint` passou. [MEDIDO-EXECUÇÃO]
- `pnpm test` não iniciou: `esbuild` falhou ao fazer `spawn` com `EPERM`; não há resultado de testes. [MEDIDO-EXECUÇÃO]
- `pnpm build` falhou porque o sandbox somente leitura bloqueou `mkdir apps/web/.next`; isso **não prova** defeito do build no repositório. [MEDIDO-EXECUÇÃO]
- O ambiente usou Node 24, enquanto o projeto exige Node 22. [MEDIDO-EXECUÇÃO] `package.json:10-13`.

## D2 — Persistência

Há dois bancos lógicos: Prisma do produto e PostgreSQL próprio do Payload CMS. Defaults de licença tendem a fail-closed (`unknown`/`false`), e `content_blocks` é versionado no caminho amostrado. [MEDIDO-CÓDIGO] `packages/db/prisma/schema.prisma:354-405`; `services/entity-writer/src/pipeline/persistence-plan.ts:45-103`.

Há migrations destrutivas versionadas: a de tema remove coluna e reconhece perda de dado. [MEDIDO-CÓDIGO] `packages/db/prisma/migrations/20260821120000_drop_user_theme_preference/migration.sql:24-32`.

NÃO DETERMINEI colunas sem escritor real, índices ineficientes ou volume/tabelas órfãs: exigiria PostgreSQL com dados e `EXPLAIN (ANALYZE, BUFFERS)`.

## D3 — APIs externas

TMDB, OMDb, Gemini e RapidAPI são configurados por variáveis de ambiente; não expus valores. [MEDIDO-CÓDIGO] `.env.example:81-89,101-138`.

- TMDB: `TMDB_READ_ACCESS_TOKEN` ou `TMDB_API_KEY`; máximo configurável de 20 RPS, 4 retries e breaker 5/30 s. [MEDIDO-CÓDIGO] `.env.example:81-91`.
- Gemini: `GEMINI_API_KEY`; o Entity Writer amostrado persiste proveniência e impede estados `published`/`human_reviewed`. [MEDIDO-CÓDIGO] `services/entity-writer/src/pipeline/run-generation.ts:80-151`; `services/entity-writer/src/pipeline/persistence-plan.ts:45-103`.
- OMDb: teto declarado de 1.000/dia; o background usa envelope de 700/dia, sendo 595 de cobertura e 105 de refresh (85/15). Custo monetário: **NÃO DETERMINADO**, pois o preço/plano não está no repositório. [MEDIDO-CÓDIGO] `packages/config/src/provider-quotas.ts:53-67`; `packages/config/src/omdb-rotation.ts:80-103`.
- RapidAPI: ainda aceita `RAPIDAPI_FILM_SHOW_RATINGS_KEY` e `RAPIDAPI_STREAMING_AVAILABILITY_KEY`, apesar da decisão do dono. [MEDIDO-CÓDIGO] `.env.example:97-126`.

## D4 — Filas e jobs

O scheduler avalia a cada 5 minutos; o limite global é 200 itens/ciclo, exceto filas como mídia de título (12.000/dia) e OMDb (700/dia). [MEDIDO-CÓDIGO] `services/sync/src/scheduler/config.ts:107-113`; `services/sync/src/scheduler/rhythms.ts:229,283-297`.

Há backlog, estados de retry/dead-letter e status baseado em logs. [MEDIDO-CÓDIGO] `services/sync/src/scheduler/runtime/runners.ts:9-14`; `services/sync/src/scheduler/status.ts:47-77,185-187`.

**A volta do universo é NÃO DETERMINADA**: a cardinalidade viva e o recorte de candidatos não foram medidos. O pior risco é interpretar “cadência diária” como cobertura diária sem dividir backlog pelo teto efetivo. Fechar com Node 22 e banco somente leitura: `corepack pnpm --filter @screena/sync exec tsx bin/ingestion-status.ts --json`.

## D5 — Saída/frontend

Há rotas públicas de catálogo, notícias, pessoas, sitemap, robots e APIs de conta. Sitemap e robots são dinâmicos; o render auditado usa banco/local cache, não API externa. [MEDIDO-CÓDIGO] `apps/web/app/robots.ts:15-38`; `apps/web/app/sitemap.xml/route.ts:2-16`; `apps/web/src/server/seo/indexability-decision.ts:7-13`.

`pnpm audit:render` passou, varrendo 333 arquivos web e 1.017 arquivos de produção. [MEDIDO-EXECUÇÃO] Contudo, é uma verificação estática; não prova cache, HTML, estados vazios ou acessibilidade em produção.

Acessibilidade ponta a ponta, cache HTTP real e comportamento de páginas vazias: **NÃO DETERMINADO**. Fechar com build gravável, Playwright e `pnpm test:styles`.

## D6 — Segurança

Segredos aparecem como nomes de env, não como valores, no material lido. O CMS restringe contas técnicas por escopo; a rota de autopublicação requer o escopo especial, mas esse escopo é justamente o problema de governança. [MEDIDO-CÓDIGO] `apps/cms/src/access.ts:66-74,153-176`; `apps/cms/src/endpoints/editorial-publications.ts:1-16`.

Não encontrei `eval` ou `new Function` na varredura dirigida. [MEDIDO-CÓDIGO] Varredura de superfícies perigosas executada.

Autenticação de **todas** as rotas, SSRF de upload/media e cabeçalhos completos: **NÃO DETERMINADO**; a rota interna e os handlers de conta não foram lidos integralmente. Fechar com revisão handler a handler e testes de integração em Node 22.

## D7 — Testes

Há 601 arquivos de teste/spec identificados. [MEDIDO-CÓDIGO] Inventário por nome de arquivo.

A suíte não rodou neste ambiente por `spawn EPERM`; portanto, não há cobertura medida nem taxa de aprovação. [MEDIDO-EXECUÇÃO]

O caso mais importante de teste que ratifica o defeito é explícito:

- O teste unitário chama um gate válido e exige `PUBLISHED`. [MEDIDO-CÓDIGO] `apps/cms/src/__tests__/auto-publication.test.ts:76-80`.
- A integração cria conta com `editorial_auto_publish` e exige resposta `PUBLISHED`. [MEDIDO-CÓDIGO] `apps/cms/src/__tests__/auto-publication.integration.test.ts:280,367-371`.

## D8 — Dívida

- Configuração declarada e não lida: Redis é documentado como roadmap e a busca não encontrou leitor de `REDIS_*` em código de produção. [MEDIDO-CÓDIGO] `.env.example:141-143`.
- Código/integração obsoleta: RapidAPI permanece em três workspaces e dois workers executáveis. [MEDIDO-CÓDIGO] `api-clients/rapidapi-core/package.json:2`; `services/ratings/package.json:28-31`; `services/streaming/package.json:22-24`.
- Comentário/documento contraditório: o próprio `CLAUDE.md` descreve autopublicação até `published`, depois a proíbe. [MEDIDO-CÓDIGO] `CLAUDE.md:157,201`.
- TODO/FIXME/HACK/XXX: 939 ocorrências textuais; esse número inclui linguagem natural e não representa 939 pendências reais. [MEDIDO-CÓDIGO]

## Achados por gravidade

| Gravidade | Achado | Evidência | Consequência |
|---|---|---|---|
| Crítica | Publicação automática permitida | `CLAUDE.md:201`; `apps/cms/src/workflow.ts:119`; `apps/cms/src/endpoints/editorial-publications.ts:1129,1177` [MEDIDO-CÓDIGO] | Conteúdo pode ir ao ar por conta técnica, sem revisão humana. |
| Alta | Teste e auditoria aceitam a violação | `apps/cms/src/__tests__/auto-publication.test.ts:79`; `scripts/audit/check-invariants.mjs:9-17` [MEDIDO-CÓDIGO]; auditoria passou [MEDIDO-EXECUÇÃO] | Falsa confiança no CI. |
| Alta | RapidAPI não removida | `.env.example:101,117`; `services/ratings/bin/sync-film-show-ratings.ts:211-213`; `services/streaming/bin/sync-streaming-availability.ts:152-160` [MEDIDO-CÓDIGO] | Caminho aposentado ainda pode gastar cota, usar chaves e reintroduzir fornecedor revogado. |
| Média | Admin declara ser somente leitura, mas escreve sob flag | `apps/admin/package.json:6`; `apps/admin/app/page.tsx:10-13` [MEDIDO-CÓDIGO] | Operador/auditor pode subestimar superfície de mutação. |
| Baixa | Migration irreversível de preferência | `packages/db/prisma/migrations/20260821120000_drop_user_theme_preference/migration.sql:24-32` [MEDIDO-CÓDIGO] | Rollback exige reconstrução de dado removido. |

## O que está morto

- Redis como configuração operacional atual: declarado, sem leitor encontrado. [MEDIDO-CÓDIGO] `.env.example:141-143`.
- RapidAPI deveria estar morta por decisão do dono, mas tecnicamente ainda está viva; portanto é “morta de produto”, não morta de código. [MEDIDO-CÓDIGO] `services/ratings/bin/sync-film-show-ratings.ts:211-213`.

## O que mente

- “Nunca publicar conteúdo automaticamente” versus endpoint, workflow e testes que publicam automaticamente. [MEDIDO-CÓDIGO] `CLAUDE.md:201`; `apps/cms/src/endpoints/editorial-publications.ts:345`; `apps/cms/src/__tests__/auto-publication.integration.test.ts:370`.
- “Admin somente leitura; não escreve” versus ações editoriais sob flag. [MEDIDO-CÓDIGO] `apps/admin/package.json:6`; `apps/admin/app/workflow/page.tsx:26-32`.
- “Invariantes intactas” no resultado da auditoria: ela passou, mas seu escopo não testa a contradição de autopublicação. [MEDIDO-EXECUÇÃO] e [MEDIDO-CÓDIGO] `scripts/audit/check-invariants.mjs:9-17`.

## O que não determinei

- Estado real de banco, cobertura de backlog, custo real de APIs e jobs rodados ontem — exige banco/credenciais de leitura e `ingestion-status --json`.
- Cobertura percentual e sucesso dos testes — `pnpm test` foi bloqueado por `EPERM` no sandbox.
- Build funcional — bloqueado por filesystem somente leitura ao criar `.next`.
- Segurança integral de cada handler, upload e cabeçalhos — exigiria leitura completa das rotas e teste de integração.

## Três perguntas extras

1. **Defeito mais grave:** o CMS possui uma rota de autopublicação que pode publicar conteúdo sem humano, em contradição direta com a regra canônica.

2. **Parece funcionar e não funciona:** `pnpm audit:invariants` passa e afirma que as invariantes estão intactas, mas não audita a proibição de autopublicação contra o fluxo executável.

3. **O que um auditor da Anthropic provavelmente não perceberia:** a contradição está escondida dentro do próprio contrato — `CLAUDE.md` autoriza autopublicação em um ponteiro (`:157`) e a proíbe depois (`:201`), enquanto testes tornam a exceção aparentemente uma garantia desejada. [INFERIDO]

## O que não abri

Não li integralmente os 2.127 arquivos restantes: a maior parte de `apps/cms`, `services/user-platform`, testes, migrations, documentação, Docker/infra, clients HTTP e componentes web. Não fiz consulta a banco, chamada externa, execução de CMS, Playwright ou validação de deploy.
