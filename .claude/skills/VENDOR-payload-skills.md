# Procedencia — skills vendorizadas de `payloadcms/skills`

> **Este arquivo nao e uma skill.** E o registro de origem das duas skills
> vendorizadas (`payload/` e `cms-migration/`), para que uma atualizacao futura
> nao reverta em silencio as remocoes de governanca listadas abaixo.

## Origem

| Campo | Valor |
| --- | --- |
| Repositorio | <https://github.com/payloadcms/skills> |
| Commit | `832d5bc4258ae784f08cb7f03a3a674d6b2fa5f1` |
| Data do commit | 2026-07-07 |
| Licenca | MIT |
| Payload alvo do upstream | `^3.0.0` (peer deps em `PLUGIN-DEVELOPMENT.md`) |
| Payload deste repo | `3.86.0` (`apps/cms/package.json`) |

## Verificacao de versao

Feita porque instrucoes de uma major que nao saiu seriam piores que nenhuma
instrucao.

- Varredura por `4.0`, `v4`, `payload 4`, `version 4`, `beta`, `next major`,
  `upcoming` nos 15 arquivos: **zero ocorrencias**.
- Unico pin explicito de versao: `^3.0.0`, em `PLUGIN-DEVELOPMENT.md`.
- Verificacao pontual da API de aparencia mais recente citada nas skills —
  `slugField()` — contra o pacote publicado `payload@3.86.0`: **existe**,
  exportado de `dist/fields/baseFields/slug/`. Nao e um vazamento de 4.0.

**Conclusao: conteudo e da linha v3 e compativel com 3.86.0.**

## Alteracoes aplicadas ao conteudo upstream

Nenhuma correcao tecnica foi feita — o upstream esta correto para Payload
generico. As remocoes abaixo sao de **defaults que contradizem o contrato de
publicacao da Cinerie**, e cada uma esta marcada no arquivo com um comentario
`CINERIE:` explicando o que saiu e por que.

| # | Onde | O que foi removido | Por que |
| --- | --- | --- | --- |
| 1 | `payload/SKILL.md` (Defaults, exemplo, gotcha 6, Best Practices) e `payload/reference/COLLECTIONS.md` (l. 19, 43) | "Don't add your own `status` field, it's redundant" | `workflowStatus` tem 12 estados e e a fonte da verdade do fluxo editorial; `_status` do Payload tem 2. Coexistem de proposito — `apps/cms/src/workflow.ts`. Deles dependem o gate de publicacao, a quota e a separacao de atores do ADR 0017. |
| 2 | `payload/SKILL.md` (Defaults, Best Practices) e `payload/reference/COLLECTIONS.md` (l. 36) | "Use `slugField()` for all slugs instead of hand-rolling" | `articles.slug` e identidade publica: sai de `canonicalizeSlug` (`apps/cms/src/canonical-slug.ts`), a mesma funcao da autopublicacao, com blocklist `RESERVED_SLUGS`. O helper do core nao aplica nenhum dos dois. |
| 3 | `cms-migration/SKILL.md` (Fase 5, tabela de pitfalls) | "keep raw HTML" como opcao para corpo | O contrato recusa markup HTML por regex (`packages/editorial-contracts/src/common.ts`); o corpo e `type: 'blocks'` com `editorialBlocks`. |

Os exemplos upstream que usam `type: 'richText'` foram **mantidos** — sao
ilustrativos e corretos para Payload generico. O guardrail no topo de cada
`SKILL.md` diz que nao se aplicam a `articles.body`.

Nao ha conflito em componentes customizados de admin: o padrao upstream
(`admin.components` por caminho, `useField` de `@payloadcms/ui`) e exatamente o
ja usado em `apps/cms/src/admin/`.

## Ao atualizar do upstream

1. `git clone --depth 1 https://github.com/payloadcms/skills`
2. Diff contra estes diretorios e reaplicar as 3 remocoes acima.
3. Repetir a varredura de versao (secao "Verificacao de versao") — o proximo
   commit upstream pode ja carregar conteudo de 4.0.
4. Atualizar o commit e a data nesta tabela.
