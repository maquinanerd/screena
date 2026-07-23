# Baseline técnico definitivo — Etapa 00

**Ref auditada:** `origin/main` @ `73c58e908986e77e49d02226c5bb1b9b4a5fca53`
**Data:** 2026-07-23 · **Branch:** `chore/baseline-00-technical-baseline`

> Baseline verificável do estado do sistema **antes de qualquer feature nova**.
> Regra editorial: **nenhuma afirmação sem referência** a arquivo, teste, migration ou saída de
> comando. O que não foi medido está declarado como não medido.

---

## Resumo executivo

O repositório é uma **plataforma de dados madura sem produto público de conteúdo**.

A fundação técnica é sólida e provada: **4.028 asserções verdes** foram executadas nesta auditoria
(3.375 testes unitários + 636 asserções contra PostgreSQL 16 real + 17 checks de smoke HTTP contra
o build de produção). Lint, typecheck, build, auditorias de invariantes, de pureza de render e de
cobertura de API passam todos com zero violações. As migrations aplicam tanto em banco vazio
quanto sobre estado anterior, e `migrate deploy` é idempotente.

As invariantes 3 e 4 (zero API externa e zero Gemini no render) não dependem de disciplina: são
**estruturais**. `apps/web` não declara dependência de nenhum client externo nem do Entity Writer,
de modo que o app público não consegue sequer resolver esses módulos.

**O que falta não é código — é dado e decisão humana.** O catálogo está **vazio**: o seed insere
apenas 5 tabelas de referência e **zero** filmes, séries ou pessoas. Ratings e Cinerie Score estão
prontos e testados, porém **bloqueados por licença**. O Entity Writer está completo, mas não há
entidade sobre a qual escrever.

Os riscos mais graves não estão nas regras de domínio — que o projeto protege muito bem — e sim em
**gates de engenharia que existem mas não protegem nada**:

- `pnpm typecheck` **não cobre `apps/**`**; `apps/admin` não tem gate de tipo algum.
- `vitest` **não coleta testes em `apps/**`** — um teste ali criado nunca roda, em silêncio.
- `db:validate:pgcrypto`, escrito para pegar um incidente real de produção, **não está na CI**.
- O **backup nunca foi executado nem validado**, e não há down-migration: o restore de dump é o
  único caminho de rollback de schema.
- O **checkout primário estava 47 commits atrás** de `origin/main`, servindo governança obsoleta
  (marca e domínio antigos) como se fosse autoritativa.

**40 riscos** mapeados (4 P0 · 19 P1 · 11 P2 · 6 P3), dos quais **27 verificados diretamente** e
13 marcados como leads não verificados — porque a etapa de verificação adversarial
**falhou por limite de sessão** (ver [`14`](14-limitacoes-desta-auditoria.md)).

### Três primeiros passos recomendados

1. **Sincronizar o checkout primário** com `origin/main` (**R-01**) — hoje se trabalha contra
   regras erradas; é pré-requisito de tudo.
2. **Fechar os três gates cegos** (**R-03**, **R-05**, **R-06**) — correções de uma linha cada,
   retorno alto, risco quase nulo.
3. **Executar um backup + restore-test reais** (**R-02**) — é a regra que o próprio repositório
   impõe e que nunca foi cumprida.

---

## Índice

| Documento | Conteúdo |
| --- | --- |
| [`00-estado-e-reproducao.md`](00-estado-e-reproducao.md) | SHA, branch, runtime, banco esperado, comandos reproduzíveis, o que o baseline **não** prova |
| [`01-arquitetura.md`](01-arquitetura.md) | Arquitetura atual, camadas, decisões estruturais, fluxos |
| [`02-mapa-dependencias.md`](02-mapa-dependencias.md) | Grafo de workspaces, aliases, tamanho de cada pacote |
| [`03-mapa-dados.md`](03-mapa-dados.md) | 75 modelos, 42 enums, 12 migrations, extensões |
| [`04-rotas-e-apis.md`](04-rotas-e-apis.md) | 27 rotas, estratégia de render, JSON-LD, handlers, middleware |
| [`05-jobs-e-fluxos.md`](05-jobs-e-fluxos.md) | 20 CLIs offline, fila de jobs, resiliência, idempotência |
| [`06-ambiente-flags-e-bloqueios.md`](06-ambiente-flags-e-bloqueios.md) | Env vars, feature flags, **todos** os pontos de `noindex`, bloqueios de produção |
| [`07-subsistemas-classificacao.md`](07-subsistemas-classificacao.md) | Cada subsistema: pronto / parcial / ausente / bloqueado / legado |
| [`08-riscos.md`](08-riscos.md) | Registro de 40 riscos P0–P3, com marca de verificação |
| [`09-matriz-...md`](09-matriz-requisito-implementacao-teste-evidencia.md) | Matriz requisito × implementação × teste × evidência |
| [`10-catalogo-contagens.md`](10-catalogo-contagens.md) | Contagens reais do catálogo + SQL para censo em produção |
| [`11-validacao-execucoes.md`](11-validacao-execucoes.md) | Saídas reais de **todos** os comandos executados |
| [`12-divergencias-doc-codigo.md`](12-divergencias-doc-codigo.md) | 11 divergências documentação × código, com dupla citação |
| [`13-rollback.md`](13-rollback.md) | Rollback desta etapa e estado real da capacidade de rollback |
| [`14-limitacoes-desta-auditoria.md`](14-limitacoes-desta-auditoria.md) | **Leia antes de confiar**: o que não foi verificado e por quê |

---

## Números de referência

| Dimensão | Valor |
| --- | ---: |
| Workspaces com `package.json` | 22 |
| Linhas de TypeScript | 125.039 (750 arquivos) |
| Modelos Prisma · enums | 75 · 42 |
| Migrations | 12 (178.123 bytes) |
| Rotas no build | 27 |
| Arquivos de teste · testes | 282 · 3.375 |
| Asserções em PostgreSQL 16 real | 636 |
| Checks de smoke HTTP | 17 |
| **Total de asserções verdes** | **4.028** |
| Riscos mapeados | 40 (27 verificados) |
| Divergências doc × código | 11 |

---

## Como validar este baseline

```bash
git clone https://github.com/maquinanerd/screena.git && cd screena
git checkout 73c58e908986e77e49d02226c5bb1b9b4a5fca53
corepack enable && corepack prepare pnpm@9.15.4 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @screena/db db:generate
```

A bateria completa está em [`00-estado-e-reproducao.md`](00-estado-e-reproducao.md) §4.1.
Nenhum comando exige credencial externa: os validadores sobem PostgreSQL 16 efêmero sozinhos.

> Use **Node 22** (o repo exige `>=22 <23`). Esta auditoria rodou em Node v24.14.0 e tudo passou,
> mas com aviso `Unsupported engine` — o baseline não prova o comportamento sob Node 22.
