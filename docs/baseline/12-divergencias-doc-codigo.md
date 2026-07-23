# 12 — Divergências entre documentação e código

> Toda linha desta tabela traz **duas** citações: onde o documento afirma, e onde o código
> contradiz. SHA `73c58e908986e77e49d02226c5bb1b9b4a5fca53`.

---

## 0. Ressalva metodológica importante

O `CLAUDE.md` de `origin/main` **já está rebrandizado para Cinerie** e correto quanto à marca:

```
CLAUDE.md:1   # CLAUDE.md — Governanca canonica da Cinerie
CLAUDE.md:9   - Marca publica principal: **Cinerie**.
CLAUDE.md:10  - Dominio canonico publico: `https://cinerie.com`.
```

Isso bate com o código (`apps/web/src/lib/site.ts:48` → `OFFICIAL_SITE_URL = "https://cinerie.com"`).

⚠️ **Porém**: o `CLAUDE.md` presente no *checkout primário* (branch
`feat/data-governance-hardening`, 40 commits atrás) ainda diz "Marca publica principal: **Screen**"
e "`https://thescreen.media`". Qualquer agente ou pessoa que abra o checkout primário recebe
**governança desatualizada como se fosse autoritativa**. Esse é o risco **R-01** (P0) —
não é um erro de documentação, é um erro de *sincronia de branch*.

---

## 1. Divergências confirmadas em `origin/main`

| # | Documento afirma | Código mostra | Severidade |
| --- | --- | --- | --- |
| D-1 | `apps/admin` — "atualmente **read-only**" (`CLAUDE.md:~90`, seção 5) | Admin **escreve** no banco: `prisma.articleTranslation.update` e `prisma.contentBlock.update` (`apps/admin/src/server/editorial-actions.ts:98,103,130,210,244`), atrás da flag `ADMIN_EDITORIAL_ACTIONS_ENABLED` (`apps/admin/src/lib/editorial-action-policy.ts:76`) | **P1** |
| D-2 | `seo/` — "Logica de SEO no nivel raiz: `indexability.ts`, `sitemap.ts`, `robots.ts`" (`CLAUDE.md` seção 5) | `seo/` na raiz é **código morto**: 224 linhas, **zero importadores**, fora do `tsconfig.base.json`. O SEO real é `packages/seo` (2.139 linhas), único alvo do alias `@screena/seo` (`tsconfig.base.json:17`) | **P2** |
| D-3 | `.claude/rules/i18n.md:64,129,146` — sitemap/checklist exigem "cumpre o **gate anti-thin** (>= 2 blocos de valor proprios)" | O gate foi **removido**. `MIN_VALUE_BLOCKS = 2` (`packages/seo/src/resolver.ts:159`) alimenta apenas o sinal informativo `hasUniqueValue` (`resolver.ts:196`) e **não participa** da decisão — a precedência documentada em `resolver.ts:178-186` não o menciona | **P1** |
| D-4 | `.claude/rules/seo.md:174` — "O sitemap **nao promove** pagina fina: se o **gate anti-thin**, licenca, idioma ou revisao falhar…" | Contradiz o próprio `seo.md:32`, que declara o gate removido. Contradição **interna ao mesmo arquivo** | **P2** |
| D-5 | `CLAUDE.md` seção 5 lista os packages do monorepo | **Não menciona** `packages/cinerie-score`, `packages/public-contracts`, `services/legal`, `services/user-platform`, `services/ratings`, `services/streaming` — 6 workspaces reais, ~48.000 linhas de código | **P1** |
| D-6 | `CLAUDE.md:22` — "Ainda **nao** estao funcionais como produto: … usuarios/community, reviews/favoritos/listas/watchlist" | `services/user-platform` tem **31.626 linhas** e um runtime de autenticação **em produção**: 4 rotas `/api/auth/**` no build, 2 páginas (`/pt/redefinir-senha`, `/pt/verificar-email`), 141 asserções verdes em PostgreSQL real | **P1** |
| D-7 | `CLAUDE.md` seção 5 — `database/` "Documentacao historica de modelagem" | `database/migrations/` está **vazio** e `database/seeds/` contém só `README.md`. Não há documentação; há um diretório oco | **P3** |
| D-8 | `.env.example:20-24` documenta `THE_SCREEN_PUBLIC_SITE_URL` / `THE_SCREEN_PUBLIC_INDEXING_ENABLED` | Os nomes **canônicos** são `CINERIE_PUBLIC_SITE_URL` / `CINERIE_PUBLIC_INDEXING_ENABLED` (`apps/web/src/lib/site.ts:30,33`); os `THE_SCREEN_*` são explicitamente **legado/fallback** (`site.ts:44-45`). O template de env ensina o nome errado | **P2** |
| D-9 | `api-clients/` — "clients externos; `tmdb` e real, demais estao como contratos/roadmap" | `api-clients/imdb` e `api-clients/kaso` não são "contratos": contêm **apenas `README.md`**, sem `package.json`. Não são workspaces, não compilam, não existem | **P3** |
| D-10 | `services/` — "`ingestion`, `sync` e `entity-writer` ja tem implementacao TS/Node parcial" | `services/news-ingestion` é citado nas regras de ingestão (`.claude/rules/ingestion.md:5`) como serviço ativo, mas contém **apenas `README.md`** | **P3** |
| D-11 | `.claude/rules/seo.md` seção 3 documenta **4 níveis** de precedência de indexabilidade | O resolver implementa **8 níveis**, incluindo `explicit-exclusion`, gate de atribuição de notícia e `entity-not-published` (`packages/seo/src/resolver.ts:178-186`) — três casos que a regra não descreve | **P2** |

---

## 2. Onde documentação e código **concordam** (verificado, não presumido)

Registrado porque um baseline honesto também precisa dizer o que está certo:

| Afirmação | Código | Status |
| --- | --- | --- |
| Marca = Cinerie, domínio = `https://cinerie.com` | `apps/web/src/lib/site.ts:48` | ✅ |
| Invariante 3 — zero API externa no render | `apps/web` não depende de nenhum api-client; `audit:render` 0 violações | ✅ |
| Invariante 4 — zero Gemini no render | `apps/web` não alcança `@screena/entity-writer` nem `GoogleGenerativeAI` | ✅ |
| Invariante 5 — indexação total (gate anti-thin removido) | `packages/seo/src/resolver.ts:178-186` | ✅ |
| Invariante 6 — licença bloqueia página | `resolver.ts` passo 2 (`license-blocked`) | ✅ |
| Invariante 7 — `PUBLISHED_LOCALES` = `["pt-BR","pt"]` | `packages/config/src/invariants.ts:164` | ✅ |
| Invariantes 1 e 2 — escalas e fontes de rating | `RATING_SOURCES` (`invariants.ts:84-90`), 51 asserções verdes | ✅ |
| API keys só em env var | nenhum segredo real versionado; `NEXT_PUBLIC_ADMIN_PASS` aparece **só** num teste negativo que prova o detector de vazamento (`tests/admin/no-secret-leak.test.ts:185`) | ✅ |
| Sitemap e meta robots nunca discordam | `includeInSitemap === (decision === 'index')`, derivado da mesma resolução (`resolver.ts:190-192`) | ✅ |

---

## 3. Consequência prática

O `audit:invariants` passa com **7 ok / 0 violações** — mas ele verifica apenas se **frases-chave
existem** nos documentos e se padrões proibidos **não existem** no código
(`scripts/audit/check-invariants.mjs`). Ele **não detecta** nenhuma das 11 divergências acima,
porque nenhuma delas remove uma frase-chave.

> Um documento pode estar 100% desatualizado e ainda assim passar no `audit:invariants`.
> Esse é o risco **R-04**: o gate de governança dá uma falsa sensação de sincronia entre
> documentação e realidade.
