# Declaração de autorização de reprodução de fontes

**Responsável:** Pablo Eduardo — proprietário da Cinerie
**Marca:** Cinerie
**Domínio:** https://cinerie.com
**Data:** 17 de julho de 2026

> Documento de governança (pt-BR). Registra a **decisão formal do proprietário**
> sobre a reprodução das fontes. Ele é a **origem editorial** da autorização; a
> materialização técnica vive em `source_licenses` + `data_usage_decisions`
> (registradas por `pnpm legal sources apply`) e a matriz operacional está em
> [`source-authorization-matrix.md`](./source-authorization-matrix.md).

## Texto-base

O proprietário da Cinerie declara possuir autorização aplicável para reprodução,
armazenamento e apresentação pública das informações das fontes expressamente
listadas neste documento, condicionada à identificação da fonte, à preservação
dos créditos, aos links de atribuição e aos disclaimers aplicáveis.

As informações são utilizadas com finalidade informativa, editorial e
jornalística.

Marcas, avaliações, opiniões, preços, disponibilidade, imagens, metadados e
demais conteúdos de terceiros permanecem de titularidade e responsabilidade de
seus respectivos titulares.

A presença de uma marca, fonte, produto, plataforma ou serviço na Cinerie não
implica parceria, afiliação, certificação ou endosso, salvo quando expressamente
indicado.

A autorização registrada não libera automaticamente logos, críticas integrais,
sublicenciamento, revenda de datasets, treinamento de modelos, API pública ou
criação de obras derivadas.

## Fontes e papéis

Papéis nunca colapsam (invariante 2): fornecedor **técnico** (quem transporta o
byte pela rede) ≠ fonte **editorial** (quem produz a nota) ≠ provedor de
**streaming** (a plataforma onde se assiste).

### Catálogo

| Fonte | Papel | Observação |
| --- | --- | --- |
| **TMDB** | Fornecedor de catálogo/metadados (fonte oficial) | API oficial do TMDB. Disclaimer obrigatório no footer. Imagens permanecem não exibíveis até decisão específica. |

### Ratings (fontes editoriais)

| Fonte | Papel | Chega por |
| --- | --- | --- |
| **IMDb** | Fonte editorial de nota | Film & Show Ratings API (RapidAPI) — intermediário |
| **Rotten Tomatoes** | Fonte editorial de nota | Film & Show Ratings API (RapidAPI) — intermediário |
| **Metacritic** | Fonte editorial de nota | Film & Show Ratings API (RapidAPI) — intermediário |
| **Letterboxd** | Fonte editorial de nota | Film & Show Ratings API (RapidAPI) — intermediário |
| **FilmAffinity** | Fonte editorial de nota | Film & Show Ratings API (RapidAPI) — intermediário |

### Fornecedores técnicos de ratings (nunca a fonte da nota)

| Fornecedor | Papel |
| --- | --- |
| **Film & Show Ratings API** | Fornecedor técnico agregador (RapidAPI) |
| **RapidAPI** | Marketplace/gateway técnico |

### Streaming

| Fonte | Papel |
| --- | --- |
| **Movie of the Night** | Agregador de disponibilidade (atribuição junto ao painel) |
| **Streaming Availability API** | Fornecedor técnico (RapidAPI) |
| **RapidAPI** | Marketplace/gateway técnico |

### Provedores de streaming (plataformas canônicas)

Os provedores canônicos (Netflix, Prime Video, Disney+, Max, Apple TV+ e
outros) são registrados em `watch_providers`/`watch_provider_aliases` **conforme
o onboarding real** — nunca inventados neste documento. Enquanto um provedor não
está registrado, nenhuma oferta dele é exibível. As decisões `watch_offer_display`
por provedor são preparadas por `pnpm legal sources apply` para os provedores
efetivamente registrados. Slugs são os reais do banco.

## Escopo autorizado

- Armazenamento interno e normalização.
- Exibição pública de informações e de notas atribuídas.
- Exibição de disponibilidade de streaming (por provedor registrado).
- Identificação textual da fonte, atribuição e linkback.
- Finalidade editorial, informativa e jornalística.
- Território **BR**; uso global apenas quando a decisão estiver registrada como
  global.

## Usos NÃO liberados por esta autorização

- Logos (`logo_allowed = false`).
- Reprodução integral de críticas / citações extensas (`review_quote_allowed = false`).
- Sublicenciamento; revenda de datasets.
- API pública com dados de terceiros.
- Treinamento de modelos.
- Obras derivadas (`derivative_allowed = false`).
- **Cinerie Score** — permanece `BLOCKED_BY_DECISION` (sem fórmula aprovada e
  sem decisão de exibição/derivação).

Esta declaração comunica atribuição, titularidade, responsabilidade e ausência
de endosso; ela **não** é a origem técnica da autorização. A origem técnica é o
conjunto de `source_licenses`/`data_usage_decisions` registrado sob a leva
`cinerie-source-auth/2026-07-v1`, decidido por *Pablo Eduardo — proprietário da
Cinerie*.
