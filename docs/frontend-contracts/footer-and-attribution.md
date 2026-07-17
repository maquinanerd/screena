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

- Exibir o disclaimer da seção 1 **no footer** de todas as páginas públicas.
- Manter o texto **legível em desktop e mobile** (sem truncamento por
  breakpoint; sem esconder em `title`/tooltip).
- **Renderizar o texto no HTML** (não injetar só via imagem ou pseudo-elemento
  inacessível a crawler/leitor de tela).
- **Preservar os links de atribuição** (linkback) exigidos por cada fonte.
- **Não esconder créditos em tooltip** nem removê-los em qualquer breakpoint.
- Exibir a **fonte da nota próxima ao rating** (ex.: "Nota fornecida por IMDb"
  junto do número, com o linkback), coerente com o `attribution_text`/
  `attribution_url` da nota exibida.
- Exibir a atribuição do **Movie of the Night próxima ao painel de streaming**
  ("Disponibilidade fornecida por Movie of the Night", com linkback), coerente
  com a licença `movie-of-the-night`.

## 4. Origem dos textos de atribuição

Os textos de crédito por fonte vêm do banco (`source_licenses.attribution_text`
/ `attribution_url` e das flags de licença) — o footer **não** inventa crédito.
A relação fonte → papel → atribuição está em
[`docs/legal/source-authorization-matrix.md`](../legal/source-authorization-matrix.md).

O disclaimer é **comunicação de atribuição, titularidade, responsabilidade e
ausência de endosso** — ele **não** é a origem técnica da autorização (essa está
registrada em [`docs/legal/source-replication-authorization.md`](../legal/source-replication-authorization.md)
e materializada em `source_licenses`/`data_usage_decisions`).
