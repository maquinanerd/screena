# Autorização do proprietário — 20/08/2026

> Documento canônico da decisão que destravou logos e o Cinerie Score.
> Referenciado por `services/legal/src/authorization-spec.ts`
> (`OWNER_DECISION_2026_08_20`) e gravado, em resumo, nas `notes`/`reason` de
> toda linha de `source_licenses`/`data_usage_decisions` cuja permissão nasce
> desta decisão.

## Quem decidiu, quando, e com que palavras

**Pablo Eduardo, proprietário da Cinerie, 20/08/2026**, por escrito:

> "É pra ter tudo que está pendente, incluindo as logos, é referência,
> jornalismo. Os trailers, vídeos, a mesma coisa. Estou autorizando."

> "Eu quero, faça, não me pergunte mais. Eu assumo todos os riscos. Acabou
> suas consultas. O que eu pedir, faça."

## O que foi decidido

| Alvo | Estado |
| --- | --- |
| `derivative_allowed` para o Cinerie Score (imdb, tmdb, rotten_tomatoes, metacritic) | **true** — decisão `cinerie_score_display` emitida sob a licença do IMDb |
| `logo_allowed` nas fontes de nota exibíveis (imdb, rotten_tomatoes, metacritic) | **true** |
| `logo_allowed` nos provedores de streaming registrados (33 slugs do registro canônico) | **true** |
| `logo_allowed` no JustWatch (crédito de origem do `watch/providers`) | **true** |

## Duas recusas anteriores revogadas por esta decisão

1. **A recusa de emitir `derivative_allowed`** (registrada em
   [`cinerie-score-derivative-authorization.md`](./cinerie-score-derivative-authorization.md)).
   A determinação fática daquele documento — o que os termos de cada fonte
   dizem — permanece como registro de pesquisa; a decisão de prosseguir é do
   proprietário, que assumiu o risco por escrito.
2. **O carimbo em bloco de `logo_allowed = false` nos provedores de streaming**
   ("titulares de marca distintos" como motivo único). O carimbo em bloco era o
   mesmo defeito, apontado para o lado conservador; a decisão do dono liga os
   provedores um a um (allowlist nominal em `plan.ts`), e a pesquisa por
   titular passou a decidir **qual arquivo** usar — nunca mais **se** exibe.

## A base fica gravada — e é isso que este documento existe para dizer

O registro legal grava **de onde veio a permissão**:

- `logoBasis` / `derivativeBasis` = `owner_decision` nas linhas desta decisão
  (`source_terms` continua reservado ao caso TMDB, cujos termos **exigem** o
  logo).
- `notes` da licença e `reason` da decisão carregam a nota
  (`OWNER_DECISION_NOTE`): "BASE DA PERMISSAO: decisao do proprietario (Pablo
  Eduardo, 2026-08-20) — nao os termos da fonte."
- `decided_by` = identidade humana passada no `--reviewer`;
  `decision_origin` = `owner_authorization` (coluna já existente).

O registro **nunca** afirma "a fonte permitiu" quando quem permitiu foi o
proprietário.

## O que NÃO cai com esta autorização (técnica, não ressalva)

- `imdb != rotten_tomatoes` — nota de um nunca vira símbolo do outro.
- O crédito textual continua ao lado do logo, em toda fonte.
- Nenhum logo hardcoded em página: a marca entra **declarada na licença**
  (`logoAsset`), e só vai ao ar quando o arquivo oficial estiver no
  repositório (`status: "present"`). Até lá: palavra-marca na mesma caixa e
  ausência logada (`pending_official_file`).
- Zero API externa e zero IA no render.
- O piso de duas fontes do Cinerie Score continua de pé — não por licença, por
  honestidade aritmética: com uma fonte só não existe composição.

## Regime por titular (pesquisa de 20/08/2026 — decide o arquivo, não o SE)

Fontes de nota:

| Fonte | Página oficial | Observação de placement |
| --- | --- | --- |
| IMDb | <https://brand.imdb.com/imdb> (Design Toolkit p/ download) | Statement de trademark obrigatório junto ao logo; logo isolado com clear space |
| Rotten Tomatoes | <https://www.rottentomatoes.com/help_desk/licensing> (assets após Business Proposal Form) | Ícone vinculado à FAIXA da nota: Fresh ≥ 60 %, Rotten ≤ 59 %, Certified Fresh ≥ 75 % — o arquivo escolhido tem que respeitar a faixa exibida |
| Metacritic | Sem kit público; assets via parceria de dados (Fabric/Origin) | Grafia: só o "M" maiúsculo |
| JustWatch | <https://www.justwatch.com/us/press> (logo sob pedido) | Preferência declarada: versão dourada; preto/branco aceitos |

Provedores: portais por família de marca em `PROVIDER_BRAND_PORTALS`
(`authorization-spec.ts`). Titular sem página pública (maioria dos BR): origem
do arquivo é a entrega licenciada do TMDB (`logo_path` do `watch/providers` —
"TMDB Content" nos termos da API, e a TMDB declara não reivindicar propriedade
das imagens) ou pedido direto à assessoria do titular.

## Como a decisão chega ao banco

```bash
corepack pnpm legal sources review
corepack pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="cinerie-source-auth/2026-08-v2" --confirm
```

Quem roda é o proprietário, em produção. O apply é idempotente e preserva
histórico (`supersedes_id`); a leva é `cinerie-source-auth/2026-08-v2`.
