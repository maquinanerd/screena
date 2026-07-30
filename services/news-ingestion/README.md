# services/news-ingestion (`@screena/news-ingestion`)

**Workspace ativo e real.** Plataforma editorial da Cinerie: contrato de entrada de fontes/itens,
proveniencia, deduplicacao determinista, ciclo de vida do artigo, slug/redirect, projecao de busca e
decisao de indexabilidade.

> **Correcao de documentacao (2026-07-28).** A versao anterior deste README descrevia, em tempo
> presente, um *worker Python que le feeds do RSSPRIME e agrupa itens em `news_clusters`*. Isso nunca
> existiu: nao ha worker Python funcional (`workers/rssprime_worker.py` so registra "Fase 0: nao
> implementado"), a tabela `news_clusters` **nao existe** no Prisma, e este pacote e TypeScript/Node.
> O texto abaixo descreve o que o codigo realmente faz.

---

## 1. O que este pacote e

- **Nucleo PURO** em `src/`: sem rede, sem banco, sem IO, sem `Date.now()` e sem `Math.random()` — o
  instante e sempre injetado. O nucleo nunca fala Prisma: recebe portas (`src/ports.ts`).
- **Adapters Prisma** em `src/persistence/editorial-store.ts`.
- **CLI de desenvolvimento** em `bin/editorial.ts`, com **barreira anti-producao** por padrao de
  nome/host da `DATABASE_URL`.
- **Validador contra PostgreSQL 16 efemero** em `scripts/`, executado como gate no CI.

## 2. O que este pacote NAO e

- **Nao e um leitor de RSS.** Nao consome o RSS Prime, nao faz parsing de feed, nao abre rede.
- **Nao reconstroi RSS Prime nem MN26.** Ambos sao sistemas externos — ver
  [`docs/adr/0015-editorial-boundaries.md`](../../docs/adr/0015-editorial-boundaries.md).
- **Nao e um CMS.** Nao redige, nao edita corpo, nao gerencia autores nem midia.
- **Nao publica sozinho.** Publicar e transicao editorial com gate e ator.
- **Nao roda no render** (invariantes 3 e 4). Worker-only.

## 3. Modulos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/identity.ts` | Identidade estavel de um item na fonte (hash determinista). |
| `src/dedup.ts` | Veredito determinista: `unique`, `duplicate`, `related`, `superseded`. Sem fusao semantica. |
| `src/ingest.ts` | Ingestao idempotente por fingerprint: `created`, `updated`, `unchanged`, `duplicate`. |
| `src/lifecycle.ts` | **Fonte unica** das transicoes de `review_status` + gate de publicacao. |
| `src/slug.ts` | Slug do artigo e caminho publico. |
| `src/projection.ts` | Projecao para `search_documents` e `page_indexability_decisions`. |
| `src/metrics.ts` | Metricas e sentinela da cadeia editorial. |
| `src/ports.ts` | Contratos entre o nucleo puro e a persistencia. |
| `src/persistence/editorial-store.ts` | Adapter Prisma das portas acima. |

## 4. Fonte unica do ciclo de vida

`src/lifecycle.ts` e a **unica** allowlist de transicao editorial do repositorio. Qualquer superficie
que mude `review_status` — inclusive o `apps/admin` — deve chamar `canTransition` daqui em vez de
reimplementar a tabela.

```
draft          -> needs_review, ai_generated, blocked, archived
ai_generated   -> needs_review, draft, blocked, archived
needs_review   -> human_reviewed, draft, blocked, archived
human_reviewed -> published, needs_update, draft, blocked, archived
published      -> needs_update, human_reviewed, blocked, archived
needs_update   -> needs_review, human_reviewed, blocked, archived
blocked        -> needs_review        (retratada NUNCA volta direto a published)
archived       -> needs_review
```

`scheduled` nao e um estado: materia agendada e `published` com `published_at` no futuro, e o embargo e
aplicado na leitura publica pelo gate de `@screena/seo`.

## 5. Tabelas que este pacote governa

`editorial_sources`, `source_items`, `article_source_links`, `articles`, `article_translations`,
`entity_news_links`, e a projecao em `search_documents` / `page_indexability_decisions`.

O **corpo integral de terceiro nao e persistido**: guardamos identidade, metadados, fingerprints e um
`excerpt` curto, travado por CHECK no proprio banco.

## 6. Invariantes aplicaveis

- **Zero API externa no render** (3) e **zero IA no render** (4) — este pacote e worker-only.
- **Licenca antes de exibir** (6) — fonte nasce `paused` com `use_rights = unknown`; artigo nasce
  `license_status = unknown` e `display_allowed = false`.
- **pt-BR primeiro** (7) — o idioma segue `PUBLISHED_LOCALES`.
- **Nao cria entidades** — vincula noticias a entidades ja existentes; criacao e de `services/ingestion`.
- **`provider_api` != fonte editorial** (2).

## 7. Comandos

```bash
# CLI de desenvolvimento (aborta se a DATABASE_URL parecer de producao)
pnpm --filter @screena/news-ingestion editorial help

# Validador contra PostgreSQL 16 efemero (o mesmo gate do CI)
pnpm validate:editorial-platform
```

## 8. Referencias

- [`docs/editorial/README.md`](../../docs/editorial/README.md) — arquitetura editorial detalhada, com a
  secao "O que NAO foi implementado (declarado)".
- [`docs/editorial/runbook.md`](../../docs/editorial/runbook.md) — operacao.
- [`docs/adr/0015-editorial-boundaries.md`](../../docs/adr/0015-editorial-boundaries.md) — fronteiras
  entre RSS Prime, MNScr, Payload, este pacote e o `screen-db`.
