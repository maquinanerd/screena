# 09 — Matriz requisito × implementação × teste × evidência

> Uma linha por requisito canônico (as 13 invariantes + requisitos operacionais).
> Nenhuma linha sem evidência executável ou citação de arquivo.
>
> **Legenda de cobertura:**
> ✅ implementado + testado + exercitado nesta auditoria ·
> 🟡 implementado + testado, **não exercitável** hoje (falta dado/licença) ·
> ⚠️ lacuna real

---

## 1. As 13 invariantes canônicas

| # | Requisito | Implementação | Teste | Evidência de execução | Cobertura |
| --- | --- | --- | --- | --- | --- |
| 1 | IMDb ≠ Rotten Tomatoes (fonte, escala, ícone, linguagem) | `RATING_SCALES`/`RATING_SOURCES` (`packages/config/src/invariants.ts:84-90`) + trigger SQL `RAISE EXCEPTION … invariante 1` (`migration 20260717120000:466`) | `tests/governance/ratings.test.ts`, `rating-scales-mirror.test.ts` | `validate:external-intelligence-product` **51/51** | ✅ |
| 2 | `provider_api` ≠ `rating_source` | `validateRating` + trigger SQL (`migration 20260717120000:453,456`) | `tests/governance/ratings.test.ts` | idem **51/51** | ✅ |
| 3 | Zero API externa no render | **Estrutural**: `apps/web` não depende de nenhum api-client | `scripts/audit/check-render-purity.mjs` | `audit:render` **0 violações / 91 arquivos** | ✅ |
| 4 | Zero Gemini no render | **Estrutural**: `apps/web` não alcança `@screena/entity-writer` | idem | idem | ✅ |
| 5 | Indexação total (gate anti-thin removido) | `resolvePageSeo` 8 níveis (`packages/seo/src/resolver.ts:178-186`) | `packages/seo/src/resolver.test.ts` | `validate:seo-runtime` **36/36**; `validate:catalog-platform-complete` checks 71-78 | ✅ |
| 6 | Dado sem licença não aparece em página indexável | passo 2 do resolver (`license-blocked`) + trigger `watch_availability_display_guard` | governança + validadores | `validate:source-authorization` **18/18**; `db:validate:real` **45/45** | ✅ |
| 7 | pt-BR publica primeiro; en/es via `PUBLISHED_LOCALES` | `PUBLISHED_LOCALES = ["pt-BR","pt"]` (`invariants.ts:164`); passo 4 do resolver → `draft` | `resolver.test.ts` | `validate:catalog-platform-complete` checks 76-78 | ⚠️ **R-07**: constante duplicada em `apps/web/src/lib/root-locale.ts:7` com valor `["pt"]` |
| 8 | Sem pirataria | varredura de padrões proibidos | `audit:invariants` | **798 arquivos varridos, 0 violações** | ✅ |
| 9 | Filme = acento vermelho (`--screena-movie-red`) | tokens em `packages/ui` | `tests/governance/vertical.test.ts` | `pnpm test` **3375/3375** | ✅ |
| 10 | Série = acento verde (`--screena-series-green`) | idem | idem | idem | ✅ |
| 11 | Diferenciação filme/série nunca só por cor | label + badge + breadcrumb + schema (`Movie`/`TVSeries`) + URL (`/filmes/` vs `/series/`) | `tests/governance/vertical.test.ts` | `validate:movie-page` **27/27**, `validate:series-page` **26/26** | ✅ |
| 12 | Entity Writer só escreve de payload controlado; não publica sozinho | `validateAgainstPayload`; nenhum caminho de publicação automática | 22 arquivos em `services/entity-writer` | `pnpm test`; `validate:external-intelligence-platform` | 🟡 pronto, **sem entidade** para exercitar |
| 13 | `content_blocks` versionados e revisáveis | colunas obrigatórias `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`, `review_status`, `warnings_json` | `content-block-store-sql.test.ts`, `hash.test.ts` | `db:validate:real` **45/45** | 🟡 pronto, **zero blocos** |

---

## 2. Regras complementares

| Requisito | Implementação | Evidência | Cobertura |
| --- | --- | --- | --- |
| API keys só em env var, nunca no frontend | nenhuma `NEXT_PUBLIC_*` real; `BREVO_API_KEY` server-only | `tests/admin/no-secret-leak.test.ts:185` (teste negativo); `boundary.test.ts:194,214` | ✅ |
| Todo sync externo gera log (`api_sync_logs`) | modelo `ApiSyncLog` | `validate:tmdb-platform` check 14 (**logs=22**) | ⚠️ **R-19**: fila de catálogo possivelmente não loga (não verificado) |
| Sem `AggregateRating` falsa | Cinerie Score bloqueado por licença | `validate:source-authorization` **18/18** ("Cinerie Score bloqueado") | ✅ |
| Sitemap e `<meta robots>` nunca discordam | `includeInSitemap === (decision === 'index')` (`resolver.ts:190-192`) | `validate:catalog-platform-complete` check 75 | ✅ |
| Revisão humana para publicação | par `review-`/`promote-` em `services/streaming/bin/` | `validate:stores` **11/11** | ✅ |

---

## 3. Requisitos operacionais

| Requisito | Estado | Evidência | Cobertura |
| --- | --- | --- | --- |
| Instalação limpa reproduzível | ✅ | `pnpm install --frozen-lockfile` EXIT 0 | ✅ |
| Migrations aplicam em banco vazio | ✅ | `db:validate:real` **45/45** + smoke check 2 | ✅ |
| Migrations aplicam sobre base existente | ✅ | `db:validate:upgrade` **23/23** | ✅ |
| `migrate deploy` idempotente | ✅ | smoke check 3 | ✅ |
| Build de produção sobe e serve | ✅ | smoke **17/17** HTTP real | ✅ |
| Kill switch de indexação fail-closed | ✅ | smoke check 16 (`Disallow: /`) | ✅ |
| Lint | ✅ | EXIT 0 | ⚠️ **R-26**: plugin do Next não carregado |
| Typecheck | ✅ | EXIT 0 | ⚠️ **R-05**: não cobre `apps/**`; admin sem gate |
| Testes unitários | ✅ | **3375/3375**, 0 skipped | ⚠️ **R-06**: vitest não coleta `apps/**` |
| Testes de integração (PG real) | ✅ | **636/636** | ✅ |
| Testes de contrato | ✅ | `api:coverage` 7 providers / 71 endpoints | ✅ |
| **Testes E2E** | ❌ | nenhum framework no repo | ⚠️ **R-24** |
| Auditoria de invariantes | ✅ | 7 ok / 0 violações | ⚠️ **R-29**: só checa frases, não corretude |
| Auditoria de render | ✅ | 0 violações | ⚠️ **R-15**: regex de uma linha, denylist fechada |
| **Backup validado** | ❌ | só `bash -n` na CI | ⚠️ **R-02** (P0) |
| **Rollback de schema** | ❌ | sem down-migration | ⚠️ depende de restore de dump |
| Healthcheck de contêiner | ❌ | ausente no `Dockerfile` | ⚠️ **R-27** |

---

## 4. Leitura da matriz

- **13/13 invariantes têm implementação e teste.** Nenhuma está sem cobertura.
- **11 estão plenamente exercitadas**; 2 (invariantes 12 e 13, Entity Writer) estão 🟡 —
  o código é sólido e testado, mas não há entidade no banco para exercitá-lo de ponta a ponta.
- **A única invariante com lacuna real é a 7**, por duplicação de `PUBLISHED_LOCALES` (**R-07**).
- As lacunas mais sérias **não estão nas invariantes de domínio**, e sim nos **gates de
  engenharia**: typecheck e vitest cegos para `apps/**`, ausência de E2E e de backup validado.

> Em resumo: o projeto protege muito bem as regras que inventou para si, e protege pior as
> práticas básicas de engenharia que a maioria dos projetos trata como padrão.
