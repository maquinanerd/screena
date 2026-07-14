# PR #60 — relatório detalhado da correção de marca pública para cinerie

> Relatório operacional e de rastreabilidade da correção aplicada na branch
> `feat/public-frontend-final-polish` do repositório `maquinanerd/screena`.

## 1. Resultado

A PR #60 foi corrigida para usar **cinerie** como marca pública, sempre em
minúsculas. O frontend mantém **Montserrat** como fonte global da interface e
passa a usar os SVGs oficiais fornecidos no arquivo
`Cinerie logo system SVG.zip`.

O logo não foi redesenhado em JSX, CSS ou `<text>`. Os arquivos recebidos são
compostos por paths/outlines e tiveram o conteúdo vetorial preservado. O patch
acrescenta apenas um LF terminal aos arquivos que no ZIP terminavam em
`</svg>` sem quebra de linha.
Gilroy não foi baixada, não foi adicionada ao repositório e não foi configurada
por `@font-face`; sua forma tipográfica existe somente nas curvas do logo.

Esta correção permanece limitada ao frontend público, ao pacote de apresentação
compartilhado, aos testes correspondentes e à documentação da PR.

## 2. Identificação

| Campo | Valor |
| --- | --- |
| Repositório | `maquinanerd/screena` |
| Pull request | [#60](https://github.com/maquinanerd/screena/pull/60) |
| Branch | `feat/public-frontend-final-polish` |
| Estado esperado da PR | aberta e draft |
| Marca pública vigente | `cinerie` |
| Capitalização pública | sempre minúscula |
| Fonte da interface | Montserrat self-hosted |
| Fonte especial do logo | incorporada apenas como curvas nos SVGs |
| Origem dos assets | `C:\Users\pablo\Downloads\Cinerie logo system SVG.zip` |
| Diretório público | `apps/web/public/brand/cinerie/` |
| Domínio técnico/canônico preservado | `https://thescreen.media` |
| Data da correção | 14 de julho de 2026 |
| Fuso | America/Sao_Paulo |

## 3. Decisão de marca aplicada

| Tema | Decisão |
| --- | --- |
| Nome público | `cinerie` |
| Forma permitida | minúscula |
| Nomes anteriores | removidos da UI, metadata, acessibilidade e assets públicos |
| Wordmark | SVG oficial em outline/path |
| Montserrat | mantida para body, navegação, cards, títulos e textos |
| Gilroy | não adicionada como webfont e não baixada |
| Dependência de fonte no logo | nenhuma |
| Dependência externa | nenhuma |
| Recriação com `<text>` | proibida e inexistente |

Montserrat é a fonte da **interface**, não a fonte usada para reconstruir o
wordmark. A identidade tipográfica exclusiva da cinerie fica isolada no desenho
vetorial entregue.

## 4. Assets oficiais instalados

Foram copiados 17 SVGs da pasta `svg/final/` do ZIP para
`apps/web/public/brand/cinerie/`, preservando nomes e a subpasta de variantes.
O arquivo auxiliar `cinerie-logo-prompt.md` do ZIP não foi publicado porque não
é um asset de runtime.

### 4.1 Wordmarks e favicons

| Arquivo instalado | Origem no ZIP | Uso |
| --- | --- | --- |
| `logo.svg` | `svg/final/logo.svg` | logo canônico no JSON-LD da organização |
| `logo-cinema.svg` | `svg/final/logo-cinema.svg` | wordmark contextual de cinema |
| `logo-serie.svg` | `svg/final/logo-serie.svg` | wordmark contextual de séries |
| `logo-pessoas.svg` | `svg/final/logo-pessoas.svg` | wordmark contextual de pessoas |
| `logo-noticias.svg` | `svg/final/logo-noticias.svg` | wordmark contextual de notícias |
| `favicon-movie.svg` | `svg/final/favicon-movie.svg` | favicon das rotas de filmes |
| `favicon-series.svg` | `svg/final/favicon-series.svg` | favicon das rotas de séries |

### 4.2 Variantes prontas

| Arquivo instalado | Superfície | Acento |
| --- | --- | --- |
| `variantes/5a-logo-preta-sublinhado-preto.svg` | clara | neutro |
| `variantes/5b-logo-preta-sublinhado-cinema.svg` | clara | cinema |
| `variantes/5c-logo-preta-sublinhado-serie.svg` | clara | série |
| `variantes/5d-logo-preta-sublinhado-pessoas.svg` | clara | pessoas |
| `variantes/5e-logo-preta-sublinhado-noticias.svg` | clara | notícias |
| `variantes/5f-logo-branca-sublinhado-branco.svg` | escura | neutro |
| `variantes/5g-logo-branca-sublinhado-cinema.svg` | escura | cinema |
| `variantes/5h-logo-branca-sublinhado-serie.svg` | escura | série |
| `variantes/5i-logo-branca-sublinhado-pessoas.svg` | escura | pessoas |
| `variantes/5j-logo-branca-sublinhado-noticias.svg` | escura | notícias |

### 4.3 Propriedades verificadas nos SVGs

- XML válido;
- somente elementos `<svg>` e `<path>`;
- ao menos um `<path>` em cada arquivo;
- zero `<text>`;
- zero `font-family`;
- zero `@font-face`;
- zero script, imagem embutida, `href`, `use` ou recurso remoto;
- `aria-label="cinerie"`;
- wordmarks com `viewBox="18 -742 2978 922"`;
- favicons com `viewBox="1315.5 -514.0 528.0 528.0"`.

## 5. Integração do logo

### 5.1 Componente `CinerieLogo`

Foi criado `apps/web/app/_components/cinerie-logo.tsx`. O componente:

- usa somente arquivos locais;
- expõe as variantes `neutral`, `movie`, `series`, `people` e `news`;
- expõe os tons `dark` e `light`;
- mantém `alt="cinerie"`;
- declara as dimensões intrínsecas oficiais `2978 × 922`;
- não usa `dangerouslySetInnerHTML`;
- não recria o wordmark;
- não importa fonte.

### 5.2 Header

`apps/web/app/_components/site-header.tsx` passou a:

- usar `CinerieLogo`;
- exibir a variante branca neutra sobre o hero escuro da home;
- usar a variante preta neutra nas superfícies claras sem vertical;
- usar o sublinhado de cinema em filmes;
- usar o sublinhado de séries em séries;
- usar o sublinhado de pessoas em pessoas;
- usar o sublinhado de notícias em notícias;
- manter o destino real `/pt/`;
- expor `aria-label="cinerie — início"`.

### 5.3 Footer

`apps/web/app/_components/site-footer.tsx` passou a usar o wordmark neutro
oficial, com `alt` e `aria-label` da cinerie. O copyright também foi atualizado.

### 5.4 Favicons

Foram criados layouts de metadata estritamente front-end:

- `apps/web/app/pt/filmes/layout.tsx` usa `favicon-movie.svg`;
- `apps/web/app/pt/series/layout.tsx` usa `favicon-series.svg`.

Não foi inventado um favicon neutro porque o ZIP não forneceu essa variante.

### 5.5 JSON-LD

O `Organization.logo` da home aponta para `/brand/cinerie/logo.svg`. Os nomes
de `Organization` e `WebSite` também foram atualizados para `cinerie`.

## 6. Locais públicos corrigidos

### 6.1 Metadata e identidade

- `apps/web/app/layout.tsx`
  - título padrão;
  - template de título;
  - `openGraph.siteName`.
- `apps/web/app/pt/page.tsx`
  - título;
  - descrição;
  - H1 institucional;
  - nomes em JSON-LD;
  - URL do logo em JSON-LD.

### 6.2 Header, footer e acessibilidade

- `apps/web/app/_components/site-header.tsx`;
- `apps/web/app/_components/site-footer.tsx`;
- `apps/web/app/_components/cinerie-logo.tsx`;
- `apps/web/app/_components/hero-carousel.tsx`;
- `apps/web/app/_components/rating-stars.tsx`.

Foram atualizados `alt`, `aria-label`, copyright e autoria editorial.

### 6.3 Copy pública

- `apps/web/app/pt/page.tsx`;
- `apps/web/app/pt/explorar/page.tsx`;
- `apps/web/app/pt/filmes/page.tsx`;
- `apps/web/app/pt/series/page.tsx`;
- `apps/web/app/pt/pessoas/page.tsx`;
- `apps/web/app/pt/noticias/page.tsx`;
- `apps/web/app/pt/noticias/[slug]/page.tsx`;
- `apps/web/app/_components/news-card.tsx`.

As preposições foram ajustadas para formas naturais como “na cinerie”, “da
cinerie”, “pela cinerie” e “Redação cinerie”.

### 6.4 Identidade neutra compartilhada

`packages/ui/src/vertical.ts` agora retorna `cinerie` nos labels e badges
neutros. Isso evita que componentes futuros voltem a exibir a marca anterior
quando resolvem as verticais `home` e `mixed`.

### 6.5 Documentação de frontend

- `apps/web/README.md`;
- `apps/web/package.json`;
- `apps/web/public/brand/README.md`;
- `packages/ui/README.md`;
- `packages/ui/package.json`;
- `docs/PUBLIC_FRONTEND_FINAL_POLISH_REPORT.md`;
- este relatório.

## 7. Assets públicos anteriores removidos

Os seis SVGs antigos foram excluídos para não continuarem acessíveis em
`public/`:

- `apps/web/public/brand/screen-logo-black.svg`;
- `apps/web/public/brand/screen-logo-white.svg`;
- `apps/web/public/brand/screen-logo-cinema.svg`;
- `apps/web/public/brand/screen-logo-cinema-white.svg`;
- `apps/web/public/brand/screen-logo-series.svg`;
- `apps/web/public/brand/screen-logo-series-white.svg`.

## 8. Montserrat preservada

Evidências:

- `apps/web/app/globals.css` mantém o `@font-face` de Montserrat;
- a origem continua sendo `/fonts/montserrat-latin-variable.woff2`;
- `--font-sans` continua começando por Montserrat;
- `body` continua usando `var(--font-sans)`;
- `apps/web/public/fonts/montserrat-latin-variable.woff2` existe e não foi removido;
- `apps/web/public/fonts/OFL.txt` existe e não foi removido;
- nenhum import remoto de fonte foi incluído.

## 9. Gilroy não adicionada

Não há:

- arquivo de fonte Gilroy;
- download de fonte;
- dependência nova;
- `@font-face` Gilroy;
- import externo para Gilroy;
- substituição da pilha Montserrat.

O nome pode aparecer neste relatório exclusivamente para registrar a decisão
negativa. Ele não aparece em CSS, metadata, JSX ou configuração de fonte.

## 10. Testes atualizados e adicionados

Expectativas antigas foram atualizadas em:

- `tests/web/public-navigation.test.ts`;
- `tests/governance/home-seo-identity.test.ts`;
- `tests/governance/vertical.test.ts`;
- `tests/governance/schema-safe-defaults.test.ts`;
- `tests/web/home-hero-presenter.test.ts`.

Foi adicionado `tests/governance/cinerie-public-brand.test.ts`, com cinco gates:

1. inventário exato dos 17 SVGs;
2. SVG somente com `svg/path`, sem texto ou fonte;
3. marca pública e metadata em minúsculas;
4. Montserrat self-hosted presente e Gilroy ausente como webfont;
5. seis logos públicos anteriores realmente removidos.

Pré-validação dirigida:

```text
5 arquivos de teste passaram
40 testes passaram
```

## 11. Grep público

O escopo público validado é:

- `apps/web/app/**`;
- `apps/web/public/**`;
- `apps/web/src/**`;
- `packages/ui/**`.

Resultado obtido e protegido por teste: **zero ocorrência literal das marcas
anteriores nesse escopo público**. Identificadores técnicos como `screen_score`,
`SCREEN_SCORE_SCALE`, `@screena/*`, tokens `--screena-*` e o domínio
`thescreen.media` não são tratados como marca pública e foram preservados.

## 12. Ocorrências restantes fora do frontend público

O grep no conjunto versionado ainda encontra as marcas anteriores nos arquivos
abaixo. Todos estão fora do frontend público alterado e foram preservados porque
são documentação/governança preexistente, contexto histórico, identidade do
admin interno ou identificadores técnicos em áreas expressamente proibidas pela
task.

Os números abaixo contam **linhas com match** de `rg -n`; uma mesma linha pode
conter mais de uma repetição da marca anterior.

O relatório visual anterior e este relatório também citam as marcas antigas
somente para documentar a substituição; por serem artefatos da própria auditoria,
não entram na tabela.

Ocorrência documental adicional e exata:

- `docs/PUBLIC_FRONTEND_FINAL_POLISH_REPORT.md:405` — uma linha cita as duas
  marcas anteriores exclusivamente para registrar sua remoção do copyright.
- este relatório — zero ocorrência literal dessas marcas; usa “marca anterior”
  para descrever a auditoria.

Ocorrências técnicas intencionais nos testes:

- `tests/governance/cinerie-public-brand.test.ts:86` — regex negativa que impede
  a volta das marcas anteriores ao runtime público;
- `tests/web/robots.test.ts:37,40` — nome e asserção negativa que impedem a
  volta da forma expandida anterior ao `robots.txt`.

| Arquivo | Linhas com match | Classificação/motivo |
| --- | ---: | --- |
| `.claude/agents/entity-writer-reviewer.md` | 1 | instrução documental preexistente |
| `.claude/agents/researcher.md` | 2 | instrução documental preexistente |
| `.claude/agents/security-reviewer.md` | 2 | instrução documental preexistente |
| `.claude/agents/seo-reviewer.md` | 3 | instrução documental preexistente |
| `.claude/rules/entity-writer.md` | 4 | regra documental fora do frontend |
| `.claude/rules/i18n.md` | 3 | regra documental fora do frontend |
| `.claude/rules/ingestion.md` | 2 | ingestão fora do escopo |
| `.claude/rules/ratings.md` | 3 | ratings fora do escopo |
| `.claude/rules/seo.md` | 6 | regra documental preexistente |
| `.claude/skills/add-entity/SKILL.md` | 2 | skill de ingestão fora do escopo |
| `.claude/skills/new-api-client/SKILL.md` | 1 | API client fora do escopo |
| `.claude/skills/schema-validate/SKILL.md` | 7 | skill técnica preexistente |
| `.claude/skills/seo-audit/SKILL.md` | 4 | skill técnica preexistente |
| `.claude/skills/validate-entity-writer-output/SKILL.md` | 2 | skill técnica preexistente |
| `.env.example` | 1 | comentário/configuração técnica |
| `AGENTS.md` | 5 | governança preexistente do repositório |
| `apps/admin/app/layout.tsx` | 1 | título do admin interno, fora do app público |
| `apps/admin/package.json` | 1 | descrição do pacote interno |
| `apps/admin/README.md` | 2 | documentação do admin interno |
| `apps/admin/scripts/public-demo-seed.ts` | 1 | seed proibido nesta task |
| `apps/admin/scripts/staging-seed.ts` | 1 | seed proibido nesta task |
| `apps/admin/src/lib/access-protection.ts` | 2 | realm do admin interno |
| `apps/admin/src/lib/content-qa.ts` | 1 | texto técnico do admin |
| `apps/admin/src/lib/public-readiness.ts` | 1 | texto técnico do admin |
| `CLAUDE.md` | 6 | governança canônica preexistente |
| `database/schema.md` | 2 | documentação de schema proibido |
| `database/seeds/README.md` | 1 | documentação de dados/seeds |
| `docs/API_SOURCES.md` | 2 | documentação preexistente de APIs |
| `docs/BUILD_PLAN.md` | 4 | plano documental preexistente |
| `docs/CLOUDPANEL_DEPLOY.md` | 7 | documentação de deploy |
| `docs/EASYPANEL_DEPLOY.md` | 2 | documentação de deploy |
| `docs/ENTITY_WRITER.md` | 6 | documentação do Entity Writer |
| `docs/frontend/page-map.md` | 2 | referência a artefato visual legado |
| `docs/PHASE_1_DATABASE_PLAN.md` | 2 | plano histórico de banco |
| `docs/PHASE_2_TMDB_PLAN.md` | 2 | plano histórico de ingestão |
| `docs/RATING_ATTRIBUTION.md` | 10 | documentação de ratings |
| `docs/SCREEN_MASTER_PROJECT_AUDIT_AND_PRODUCT_ROADMAP.md` | 163 | auditoria/roadmap histórico |
| `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md` | 14 | relatório histórico |
| `docs/SEO_PROGRAMMATIC.md` | 5 | documentação SEO preexistente |
| `docs/SPEC.md` | 11 | especificação preexistente |
| `docs/THE_SCREEN_CURRENT_STATE_AUDIT.md` | 16 | auditoria histórica |
| `package.json` | 1 | descrição técnica do monorepo |
| `packages/config/package.json` | 1 | descrição de pacote técnico |
| `packages/config/README.md` | 1 | documentação de pacote técnico |
| `packages/db/package.json` | 1 | descrição de pacote proibido |
| `packages/db/prisma/migrations/20260706120000_add_certification_screen_score/migration.sql` | 2 | migration histórica/`screen_score` |
| `packages/db/prisma/schema.prisma` | 2 | `screen_score`; schema proibido |
| `packages/db/README.md` | 2 | documentação do banco |
| `packages/schemas/package.json` | 1 | descrição de pacote técnico |
| `packages/schemas/README.md` | 1 | documentação de schemas |
| `packages/seo/package.json` | 1 | descrição de pacote técnico |
| `packages/seo/README.md` | 1 | documentação de pacote técnico |
| `packages/types/package.json` | 1 | descrição de pacote técnico |
| `packages/types/README.md` | 1 | documentação de pacote técnico |
| `README.md` | 9 | documentação raiz preexistente |
| `scripts/backup/backup.sh` | 1 | nome técnico de backup |
| `scripts/backup/README.md` | 2 | documentação operacional |
| `scripts/deploy/README.md` | 1 | documentação operacional |
| `seo/sitemap.ts` | 3 | módulo SEO técnico fora do app público |
| `seo/templates/README.md` | 7 | documentação técnica/histórica |
| `services/entity-writer/README.md` | 1 | serviço fora do escopo |
| `services/ingestion/bin/discover-ids.ts` | 1 | ingestão proibida |
| `services/ingestion/bin/ingest-public-catalog.ts` | 1 | ingestão proibida |
| `services/ingestion/bin/promote-tmdb-raw.ts` | 1 | promoção proibida |
| `services/ingestion/bin/sync-tmdb-raw.ts` | 1 | sync proibido |
| `services/ingestion/README.md` | 2 | documentação de ingestão |
| `services/ingestion/src/raw-promote/report.ts` | 1 | relatório técnico de ingestão |
| `services/ingestion/src/raw-sync/report.ts` | 1 | relatório técnico de ingestão |
| `services/news-ingestion/README.md` | 1 | serviço fora do escopo |
| `services/ratings/bin/sync-film-show-ratings.ts` | 1 | ratings proibidos |
| `services/ratings/README.md` | 1 | documentação de ratings |
| `tests/admin/access-protection.test.ts` | 4 | testes do realm do admin interno |
| `THE_SCREEN.md` | 15 | documento histórico |
| `workers/README.md` | 2 | workers fora do escopo |

Essa lista é deliberadamente explícita: nenhuma dessas ocorrências é renderizada
como marca final pelo app público da PR #60. Uma migração documental global
exigiria uma task própria porque alcançaria governança, admin, banco, services e
workers, todos fora do escopo ou proibidos neste trabalho.

## 13. Escopo proibido confirmado como intocado

A correção não altera:

- backend;
- Prisma;
- schema;
- migrations;
- banco ou dados;
- workers;
- `services/streaming`;
- `services/ratings`;
- ingestão;
- `api-clients`;
- `display_allowed`;
- `screen_score`;
- `external_ratings`;
- regras de licença;
- promoção de streaming.

Também não foram executados RapidAPI, TMDB, Gemini, `--sample`, `--apply` ou
qualquer fluxo de promoção.

## 14. Validações obrigatórias

| Validação | Resultado |
| --- | --- |
| grep público de marca | PASSOU — zero ocorrência literal no app/pacote público |
| grep de Montserrat | PASSOU — `@font-face`, WOFF2, stack e body confirmados |
| grep de Gilroy/`@font-face` | PASSOU — zero ocorrência em código/CSS público |
| import externo de fonte | PASSOU — zero `@import`, host remoto ou helper de download |
| estrutura dos 17 SVGs | PASSOU — XML válido, somente `svg/path`, sem `text` |
| integridade ZIP ↔ arquivos instalados | PASSOU — 17/17 conteúdos iguais, ignorando apenas LF terminal |
| `corepack pnpm typecheck` | PASSOU |
| `corepack pnpm test` | PASSOU — 155 arquivos, 1.662 testes |
| `corepack pnpm audit:invariants` | PASSOU — 7 ok, 0 violações |
| `corepack pnpm audit:render` | PASSOU — 77 arquivos, 0 violações |
| `corepack pnpm --filter @screena/web build` | PASSOU — compilação e 7 páginas estáticas concluídas |
| lint dos arquivos versionados alterados | PASSOU — 32 TS/TSX alterados + 1 teste legado relacionado, zero warning |
| `git diff --cached --check` | PASSOU — zero erro de whitespace |

Os arquivos de fonte preservados têm 37.956 bytes
(`montserrat-latin-variable.woff2`) e 4.400 bytes (`OFL.txt`), sem diff em
`apps/web/public/fonts/`.

Os comandos pnpm emitiram apenas o aviso ambiental já conhecido: o projeto pede
Node 22 LTS e a máquina local está em Node 24.14.0. O build também repetiu o aviso
preexistente de que o plugin Next não foi detectado na configuração ESLint; não
houve erro de lint, tipo, teste ou build.

## 15. Git e publicação

Regras desta entrega:

- commit normal na branch existente da PR #60;
- push normal, sem `--force`;
- nenhuma criação de branch paralela;
- nenhuma abertura de PR substituta;
- PR mantida em draft;
- nenhum merge.

Antes do push, a consulta da PR confirmou: `OPEN`, `DRAFT`, `MERGEABLE` e
`CLEAN`, com base `main` e head `feat/public-frontend-final-polish`.

Arquivos não versionados preexistentes no workspace, incluindo skills locais e
bundles de design, ficam fora do stage e do commit.

## 16. Pendência humana

A pendência final é a inspeção visual humana em staging. Conferir:

- logo branco no topo da home;
- transição para o logo preto após scroll;
- variantes de cinema, séries, pessoas e notícias em rotas internas;
- legibilidade do wordmark em 390, 768, 1280 e 1440 px;
- alinhamento no header e footer;
- favicons de filmes e séries;
- contraste;
- ausência de overflow ou salto de layout.

Essa inspeção é visual e não substitui os gates automatizados; ela deve ocorrer
antes de retirar a PR do modo draft ou autorizar merge.
