# Entrega — Plataforma de dados externos e inteligência (Fases 9–11)

Data: 2026-07-15

## Resultado

A macrofase de Streaming Availability, Ratings e Gemini Entity Writer foi
entregue em uma única branch, sem alteração visual e sem iniciar a Fase 12.

- Branch: `feat/external-data-intelligence-platform`
- Base: `665c45ecf0f268c8f9883ba37f727bcd30493be2`
- Commit: `1cfecd2` — `feat(data): consolidate external intelligence platform`
- PR draft: https://github.com/maquinanerd/screena/pull/70
- Base da PR: `main`
- Estado: aberta como draft; nenhum merge foi realizado.

## Entregue

- Client Streaming Availability ampliado para lookup, busca por título/filtros,
  changes, countries e genres, sempre worker-only.
- Normalização de ofertas preserva `external_offer_id`, package e URL web quando
  existirem no payload; identidade, fingerprint, revisão e licença continuam
  fail-closed.
- Registro `api:coverage` atualizado e protegido contra drift reverso.
- Gemini `generateContent` usa JSON estruturado, schema fechado, system
  instruction de grounding e safety settings.
- Validador único `validate:external-intelligence-platform` adicionado à CI.
  Ele exercita clients com transports falsos, workers reais, PostgreSQL 16
  efêmero, `FakeGeminiPort`, coverage e auditoria de pureza de render.
- ADR consolidada criada em
  `docs/adr/0009-0011-external-data-intelligence-platform.md`.

## Validação

Passaram localmente:

- `pnpm api:coverage`
- `pnpm validate:external-intelligence-platform`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm audit:invariants`
- `pnpm audit:render`
- `pnpm --filter @screena/web build`
- Validadores PostgreSQL de banco, streaming, SEO, rotas, TMDB e `validate:all`
- `git diff --check`

A CI Linux da PR #70 concluiu com sucesso em 3m13s.

## Observação ambiental

No Windows, a suíte completa teve uma falha preexistente em
`tests/web/public-navigation.test.ts`: o teste compara LF literal contra um
checkout CRLF de `site-header.tsx`, arquivo que não foi alterado nesta entrega.
A CI Linux — a autoridade para esse artefato — passou integralmente.
