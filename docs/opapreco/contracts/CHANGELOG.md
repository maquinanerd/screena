# Contracts changelog

Toda mudança em offer.schema.json ou ad-response.schema.json entra aqui, com data, autor (agente/pessoa) e impacto em frontend/backend.

## v1.0.0 — 2026-10-30
- Versão inicial congelada a partir do design system OpaPreço Ads v1.

## Pendente — ids de slot do publisher Cinerie (2026-10-30)
- `ad-response.schema.json` restringe `slot` a 5 valores (posições da matéria). A Cinerie pede anúncio para 26 posições (`apps/web/src/lib/opapreco/slots.ts`, `OPAPRECO-SLOT-MAP.md`). Backend: aceitar esses ids (ou trocar o enum por string) antes de ligar `OPAPRECO_AD_SERVER_URL` na Cinerie. Frontend: já confere só que `slot` da resposta é o pedido.
- O pedido da Cinerie leva, além de `slot`/`url`/`viewport`/`containerWidth`, as tags `vertical`, `entity`, `category` e `genres` (lista separada por vírgula). Campos vazios não são enviados.
