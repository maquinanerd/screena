# AGENTS.md — Guia para agentes autônomos (Codex)

> **Para agentes de codificação autônomos (Codex e similares).**
> Este documento é o contrato operacional para automação. O contexto canônico e a fonte da verdade das invariantes continuam sendo o **`CLAUDE.md`** e as regras em **`.claude/rules/`**. Em caso de conflito, `CLAUDE.md` prevalece.

---

## Contexto curto do projeto

A marca pública principal é **Screen**, no domínio canônico **`https://thescreen.media`**. **The Screen** pode aparecer apenas como referência histórica, explicativa ou nome expandido não-principal. **Screena** permanece como namespace técnico/legado interno (`@screena/*`, tokens `--screena-*`, nomes antigos de scripts/services), não como marca pública. **screena.media** é legado histórico e não deve aparecer como domínio canônico público ativo. **The Nerd News** é legado antigo e não deve voltar como identidade do produto.

**Screen** é uma **base global de entretenimento _entity-first_** (filmes, séries, temporadas, episódios, pessoas, ratings externos, onde assistir, reviews e notícias) com **camada editorial própria**.

- As **APIs fornecem os dados**; **Screen escreve a camada editorial**. Fornecedores externos (TMDB, provedores de rating via RapidAPI) nunca são a voz editorial.
- **Zero API externa no render. Zero Gemini no render.** Toda página pública indexável lê **apenas PostgreSQL/cache local**. A IA (Gemini) só gera `content_blocks` **offline**, salvos, validados e revisados.
- O MVP publica em **pt-BR**; `en`/`es` nascem em **draft/`noindex`** até revisão humana.
- **Estado atual: fundação avançada / vertical slice técnica.** O repositório não é mais Fase 0 pura: já existem Prisma/PostgreSQL, migrations/seeds, client TMDB real em TypeScript, ingestão TMDB, sync/stale policy, Entity Writer offline em TypeScript, adapter Gemini separado do render, rotas públicas para filmes/séries/pessoas/notícias, presenters puros, gates anti-thin, testes de governança e CI.
- Ainda **não** estão funcionais como produto: ratings, streaming/onde assistir, RSSPRIME/MN26, admin editorial completo e usuários/community. Não implemente essas features neste commit de alinhamento.

Monorepo **pnpm** com workspaces `apps/*`, `packages/*`, `api-clients/*` e `services/*`. Stack: Next.js App Router, TypeScript **strict**, React Server Components, Tailwind, PostgreSQL + Prisma, workers Python **3.12** como roadmap/shim futuro, Node **22 LTS**. TMDB e Entity Writer rodam hoje em TypeScript/Node + Prisma; não reimplemente TMDB do zero em Python por causa de documentação antiga.

---

## Comandos

| Comando          | O que faz                                                                 |
| ---------------- | ------------------------------------------------------------------------- |
| `pnpm install`   | Instala as dependências do monorepo.                                      |
| `pnpm dev`       | Servidor de desenvolvimento do app público quando as dependências estiverem instaladas. |
| `pnpm test`      | Roda os testes (Vitest): invariantes e utilitários puros.                 |
| `pnpm lint`      | Roda o ESLint em todo o repositório.                                      |
| `pnpm typecheck` | Checagem de tipos (`tsc --noEmit`).                                       |
| `pnpm audit:invariants`     | Audita as invariantes do projeto (ex.: pureza de render, atribuição de ratings). |
| `pnpm audit:render`         | Audita pureza de render do app público.                                  |

**Antes de abrir qualquer PR, o agente deve rodar e deixar verdes:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:invariants` e `pnpm audit:render`. Mudança que quebra uma invariante **não** vira PR sem revisão humana explícita.

---

## Convenções de código e estrutura

- **Idioma:** docs, READMEs, regras e prompts em **pt-BR**; **código e identificadores em inglês** (comentários podem ser em pt-BR).
- **TypeScript estrito e puro:** utilitários sem rede/DB/IO externo, funções puras e testáveis. Use sempre `export` **nomeado** (evite `export default` em utilitários).
- **Pacotes (`packages/*`):** `@screena/config`, `@screena/schemas`, `@screena/seo`, `@screena/ui`, `@screena/types`, `@screena/db`. Cada pacote tem `package.json` (`"main": "./src/index.ts"`, `"type": "module"`), `tsconfig.json` (estende `../../tsconfig.base.json`), `README.md` e `src/index.ts`.
- **Apps (`apps/*`):** `@screena/web` (site público Screen) e `@screena/admin` (painel editorial planejado).
- **Aliases** (devem bater entre `vitest.config.ts` e `tsconfig.base.json`):

  | Alias              | Caminho                          |
  | ------------------ | -------------------------------- |
  | `@screena/config`  | `packages/config/src/index.ts`   |
  | `@screena/schemas` | `packages/schemas/src/index.ts`  |
  | `@screena/seo`     | `packages/seo/src/index.ts`      |
  | `@screena/ui`      | `packages/ui/src/index.ts`       |
  | `@screena/types`   | `packages/types/src/index.ts`    |
  | `@screena/db`      | `packages/db/src/index.ts`       |

- **Render puro:** páginas/componentes do servidor leem apenas PostgreSQL/cache local — nunca TMDB, provedor de rating ou Gemini no caminho de renderização.
- **Chaves de API** apenas em variáveis de ambiente, **nunca** no frontend. Todo sync externo gera log.
- **Tokens de cor:** `--screena-movie-red` (`#FF3B30`) para filmes, `--screena-series-green` (`#7AA66D`) para séries; home/busca/misto/institucional usam neutro. A diferenciação filme/série **nunca** depende só da cor — sempre **label + badge + breadcrumb + schema + URL**.
- **Testes:** acompanham a mudança (Vitest). Toda nova função pura precisa de teste; toda invariante tocada precisa de cobertura.

---

## O que o Codex PODE fazer

Tarefas de baixo risco e bem delimitadas, desde que cobertas por testes e passando em `pnpm typecheck`/`pnpm lint`/`pnpm test`/`pnpm audit:invariants`:

- **Implementar issues pequenas e bem especificadas**, com escopo claro.
- **Criar e atualizar testes** (Vitest) para utilitários puros e invariantes.
- **Escrever migrations** (quando a fase permitir), mantendo-as reversíveis e revisáveis.
- **Refatorar módulos isolados** sem alterar contrato público nem comportamento observável.
- **Implementar `api-clients`** (contratos, tipos, parsing) respeitando `provider_api ≠ rating_source` e mantendo chaves em env vars.
- **Corrigir bugs** com teste de regressão que reproduz a falha.
- **Abrir PRs** descritivos, vinculados à issue, com checklist de invariantes.

---

## O que o Codex NÃO PODE fazer sem revisão humana

Estas ações exigem **aprovação humana explícita** antes de qualquer merge:

- **Decidir licença de API** ou alterar `source_licenses`/flags (`display_allowed`, `score_allowed`, `requires_attribution`, etc.).
- **Decidir indexação em massa** ou mudar decisões de `page_indexability_decisions` em lote.
- **Alterar regra editorial crítica** ou qualquer uma das 13 invariantes.
- **Publicar automaticamente** (qualquer transição para `published` sem revisão humana).
- **Mudar o schema de rating** (escalas, fontes, atribuição) sem teste cobrindo a mudança.
- **Relaxar a validação do Entity Writer** (anti-alucinação, payload controlado, versionamento de `content_blocks`).
- **Remover ou enfraquecer o gate anti-thin** (`≥ 2` blocos de valor próprios para indexar).

Em todos esses casos o agente deve **parar, descrever o impacto na PR e solicitar revisão humana** — nunca contornar.

---

## As 13 invariantes (resumo)

A íntegra está em `CLAUDE.md` e em `.claude/rules/`.

1. **IMDb ≠ Rotten Tomatoes** — nunca misturar fontes, escalas, ícones ou linguagem.
2. **provider_api ≠ rating_source** — o fornecedor técnico (ex.: RapidAPI) nunca é a fonte editorial.
3. **Zero API externa no render** — páginas indexáveis leem apenas PostgreSQL/cache local.
4. **Zero Gemini no render** — a IA só gera `content_blocks` offline, salvos e validados.
5. **Página fina recebe `noindex`** — sem ao menos 2 blocos de valor próprios além do dado cru, não indexa.
6. **Sem licença clara, não aparece** — `license_status` `unknown`/`blocked` ou `display_allowed=false` ⇒ fora de página indexável.
7. **pt-BR publica primeiro** — `en`/`es` nascem em draft/`noindex` até revisão humana.
8. **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed pirata.
9. **Filmes usam acento vermelho** (`--screena-movie-red`).
10. **Séries usam acento verde** (`--screena-series-green`).
11. **Filme vs. série nunca depende só da cor** — sempre label + badge + breadcrumb + schema + URL.
12. **Entity Writer só escreve com payload controlado** do PostgreSQL — não inventa fatos, não cria entidades, não chama APIs externas, não publica sozinho.
13. **`content_blocks` são versionados e revisáveis** — `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name` e `review_status` obrigatórios.

---

## Fluxo de trabalho

O ciclo padrão para qualquer contribuição autônoma:

1. **Issue** — partir de uma issue pequena e bem especificada, com escopo e critério de aceite claros.
2. **Branch** — criar branch dedicada a partir de `main` (ex.: `feat/...`, `fix/...`, `refactor/...`). Nunca commitar direto em `main`.
3. **Implementa** — fazer a mudança mínima e isolada, respeitando convenções e invariantes; sem tocar arquivos fora do escopo.
4. **Testes** — adicionar/atualizar testes e deixar verdes `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm audit:invariants`.
5. **Revisão Claude Code** — submeter a mudança à revisão (incluindo o checklist de invariantes e dos itens que exigem aprovação humana).
6. **PR** — abrir PR descritivo, vinculado à issue, com resumo do impacto e confirmação das invariantes.
7. **Staging** — validar em staging antes de qualquer publicação.
8. **Main** — merge em `main` somente após revisão aprovada e staging validado.

> Regra de ouro: na dúvida sobre licença, indexação, schema de rating, validação do Entity Writer ou gate anti-thin, **pare e peça revisão humana**. É sempre preferível abrir uma pergunta a relaxar uma invariante.
