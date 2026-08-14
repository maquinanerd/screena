# Contrato de footer e atribuição — Cinerie

> Documento de **contrato** (pt-BR). Ele NÃO altera o visual final; define o
> **texto obrigatório** e as **regras de renderização** que o design do footer e
> os componentes de atribuição devem cumprir quando forem implementados. A
> presença da frase literal do TMDB aqui é verificada pelo validator
> `validate:source-authorization-and-attribution`.

## 1. Texto obrigatório do footer

O footer de toda página pública deve conter, legível e renderizado no HTML
(nunca só em tooltip, nunca escondido em breakpoint), o seguinte disclaimer:

> A Cinerie utiliza dados e informações de fontes terceiras autorizadas para
> reprodução mediante a preservação dos respectivos créditos e links de
> atribuição.
>
> As informações disponibilizadas possuem finalidade informativa, editorial e
> jornalística. Marcas, avaliações, opiniões, preços, disponibilidade, imagens,
> metadados e demais conteúdos de terceiros pertencem e são de responsabilidade
> de seus respectivos titulares.
>
> A presença de uma fonte, marca, produto ou serviço na Cinerie não implica
> parceria, afiliação, certificação ou endosso, salvo quando expressamente
> indicado.
>
> Os dados podem sofrer alterações. Para informações definitivas, consulte a
> fonte ou o serviço oficial correspondente.

## 2. Disclaimer literal do TMDB (não modificar)

O footer deve exibir, literalmente, a frase:

Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.

Esta frase é uma exigência dos termos do TMDB e **não pode ser modificada,
parafraseada ou traduzida** — é reproduzida exatamente como acima.

## 3. Regras de renderização (o design final deve cumprir)

> **MUDANÇA DE POLÍTICA — 13/08/2026.** Decisão do proprietário (Pablo Eduardo):
> **todo crédito de fonte sai do corpo das páginas e passa a viver no rodapé
> global.** As duas últimas regras desta seção diziam o contrário ("fonte da nota
> próxima ao rating", "atribuição do Movie of the Night próxima ao painel") e
> foram substituídas abaixo.
>
> **Motivo:** o crédito colado ao dado se espalhava por quatro superfícies com
> regras próprias — chip da nota, painel de streaming, faixa da home (onde
> trocava a cada slide) e hub de "onde assistir". Um lugar só é auditável; quatro
> não são.
>
> **O que NÃO mudou:** `requires_attribution` continua `true` para todas as
> fontes. Mudou o endereço do crédito, nunca a obrigação — e o caminho de
> escrita (`external_ratings_display_guard`,
> `watch_availability_display_guard`) segue recusando linha sem crédito.

- Exibir o disclaimer da seção 1 **no footer** de todas as páginas públicas.
- Manter o texto **legível em desktop e mobile** (sem truncamento por
  breakpoint; sem esconder em `title`/tooltip).
- **Renderizar o texto no HTML** (não injetar só via imagem ou pseudo-elemento
  inacessível a crawler/leitor de tela).
- **Preservar os links de atribuição** (linkback) exigidos por cada fonte.
- **Não esconder créditos em tooltip** nem removê-los em qualquer breakpoint.
- **O rodapé nomeia toda fonte autorizada A EXIBIR**, com o texto verbatim da
  licença — hoje as três fontes de nota servidas pela OMDb (IMDb, Rotten
  Tomatoes, Metacritic), o catálogo (TMDB) e as duas origens de disponibilidade
  (Movie of the Night e JustWatch).
  Fonte com `display_allowed = false` **não** é creditada: creditar quem não pode
  aparecer é afirmação pública sem lastro. Letterboxd e FilmAffinity estão nesse
  caso desde 13/08/2026 — ver a matriz de licenças.
- **Nenhuma superfície de conteúdo credita.** Ficha de título, painel de
  streaming, faixa da home e hub de "onde assistir" **não** carregam crédito:
  duplicá-lo desfaz a decisão em silêncio.
- **Crédito é texto, nunca logo.** `logoAllowed` é o literal `false` no tipo de
  `LicenseTarget`; marca gráfica de terceiro não vai ao ar em nenhuma superfície.

Provado por
[`apps/web/app/_components/__tests__/footer-credits.test.tsx`](../../apps/web/app/_components/__tests__/footer-credits.test.tsx),
que renderiza chrome + conteúdo e mede **texto visível** (tags removidas) — nunca
`markup.includes(...)`, que aceitaria um crédito escondido em `aria-label`.

## 4. Origem dos textos de atribuição

Os textos de crédito por fonte vêm do registro legal — o footer **não** inventa
crédito e **não** carrega string literal de fonte nenhuma.

Em runtime, a autorização vive em `source_licenses.attribution_text` /
`attribution_url` (mais as flags de licença), materializada a partir de
[`services/legal/src/authorization-spec.ts`](../../services/legal/src/authorization-spec.ts).
É desse mesmo spec que o rodapé deriva a lista pública, via
`publicSourceCredits()` em
[`services/legal/src/public-credits.ts`](../../services/legal/src/public-credits.ts).

**Consequência que é o contrato:** registrar uma fonte nova em
`authorization-spec.ts` faz o crédito dela aparecer no rodapé **sem ninguém
editar o rodapé**. Travado por `services/legal/src/__tests__/public-credits.test.ts`,
que injeta uma fonte fictícia no spec e exige que ela apareça na projeção.

A relação fonte → papel → atribuição está em
[`docs/legal/source-authorization-matrix.md`](../legal/source-authorization-matrix.md).

O disclaimer é **comunicação de atribuição, titularidade, responsabilidade e
ausência de endosso** — ele **não** é a origem técnica da autorização (essa está
registrada em [`docs/legal/source-replication-authorization.md`](../legal/source-replication-authorization.md)
e materializada em `source_licenses`/`data_usage_decisions`).
