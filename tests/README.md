# tests/ — Suite de testes da Screena

Esta pasta concentra os testes do monorepo. Os testes rodam com **Vitest**
(`pnpm test`), a partir da raiz do repositorio (`process.cwd()` = raiz). Veja a
configuracao em `vitest.config.ts` (include: `tests/**/*.test.ts` e
`packages/**/*.test.ts`; aliases `@screena/*` espelhando `tsconfig.base.json`).

> Fase 0 (Fundacao): testamos contratos, utilitarios puros e **governanca**.
> Nao testamos produto real (sem banco, sem rede, sem API externa, sem render
> final). Todo utilitario de dominio deve ser puro e testavel sem IO externo.

## Categorias

| Pasta | Proposito |
| --- | --- |
| `unit/` | Testes unitarios de funcoes puras e utilitarios isolados. Sem rede, sem DB, sem IO externo. Geralmente moram junto ao codigo em `packages/**/*.test.ts`; esta pasta guarda unidades transversais que nao pertencem a um unico pacote. |
| `integration/` | Testes que combinam mais de um modulo/pacote (ex.: `@screena/schemas` + `@screena/seo`) e verificam o contrato entre eles. Ainda sem rede nem banco real na Fase 0 — apenas composicao de codigo puro. |
| `seo/` | Testes focados em indexabilidade, gate anti-thin, schema.org, sitemap e robots. Validam que paginas finas recebem `noindex` e que a diferenciacao filme/serie nunca depende so da cor. |
| `governance/` | Testes que **travam as invariantes** do projeto (as 13 Regras de Ouro do `CLAUDE.md`). Sao a rede de seguranca contra enfraquecimento das regras: se alguem reescreve o sentido de uma invariante, dilui um gate ou reintroduz API externa no render, estes testes quebram. |
| `e2e/` | Testes ponta a ponta (navegacao, paginas renderizadas). Esqueletos na Fase 0; preenchidos quando houver app real para exercitar. |

## Testes de governanca (meta)

Os testes em `governance/` sao **meta-testes**: eles defendem as invariantes
inegociaveis descritas no `CLAUDE.md`, secao 2. Diferente de um teste de unidade
comum, varios deles leem os proprios artefatos do repositorio (docs, arvore de
`apps/`) para garantir que as regras continuam presentes e nao foram violadas.

- `docs-invariants-present.test.ts` — le `CLAUDE.md` e afirma que a frase-chave de
  cada uma das 13 invariantes continua presente. Protege contra reescrita que
  enfraqueca ou apague uma regra de ouro.
- `no-render-external-api.test.ts` — varre `apps/web/app` procurando `fetch` para
  hosts externos e imports de `api-clients/` ou `@screena/db`, e afirma que nao ha
  nenhum. Protege a invariante 3 (zero API externa no render).
- `ratings.test.ts`, `indexability.test.ts`, `vertical.test.ts` e
  `entity-writer-output.test.ts` — pertencem aos pacotes de dominio
  (`@screena/schemas`, `@screena/seo`) e travam, respectivamente, integridade de
  ratings (invariantes 1, 2), gate anti-thin e indexabilidade (invariantes 3, 5,
  6), diferenciacao filme/serie (invariantes 9, 10, 11) e saida do Entity Writer
  (invariantes 12, 13).

Regra pratica: ao mexer numa invariante, o teste de governanca correspondente
deve falhar **de proposito** antes de voce ajusta-lo — e qualquer ajuste que
afrouxe uma regra precisa de revisao humana explicita.

## Convencoes

- TypeScript estrito; nada de rede/DB/IO externo nos testes da Fase 0.
- Leitura de arquivos do repo via `node:fs/promises`, com caminhos **relativos a
  `process.cwd()`** (a raiz, onde o Vitest roda).
- Nomeie arquivos `*.test.ts`. Descreva a invariante protegida no `describe`/`it`.
