# @screena/user-platform

Camada de domínio do **produto de usuário** da Cinerie (Backend C): contas e
autenticação, tracking (watch state + progresso de episódio), diário/histórico
append-only, listas (sistema + custom), ratings e reviews de usuário,
estatísticas assíncronas, recomendações v1 explicáveis, LGPD (consentimento,
export, exclusão/anonimização) e importação (Letterboxd/Trakt/Cinerie).

- **Núcleo puro** em `src/` (sem rede, sem DB, sem IO): políticas, decisores de
  fluxo, máquinas de estado, projeções e parsers — tudo testável e
  determinístico.
- **Adapters Prisma isolados** em `src/persistence/` (export `./runtime`),
  únicos pontos com IO de banco.
- **Nunca em página pública indexável**: superfícies de usuário são privadas e
  `noindex` por construção; nada daqui entra em sitemap (invariante 5, caso
  técnico). Zero API externa, zero Gemini (invariantes 3/4).
- **Nota de usuário ≠ nota externa**: `user_ratings` não tem relação com
  `external_ratings`; nenhuma média de usuários vira `AggregateRating`
  (invariantes 1/2 + "sem AggregateRating falsa").
- Segredos nunca persistem em claro: sessões/tokens guardam apenas hash;
  IP bruto nunca é gravado; senha nunca aparece em log.

Decisões de produto: [`docs/product/user-product-decisions.md`](../../docs/product/user-product-decisions.md).
ADR: [`docs/adr/0014-user-product-platform.md`](../../docs/adr/0014-user-product-platform.md).

## Validação

```bash
pnpm validate:user-product-platform   # PostgreSQL 16 efêmero (embedded), descartável
pnpm test                             # testes puros (vitest, a partir da raiz)
```
