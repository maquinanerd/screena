# Marcas de fonte (`/brand/sources/`)

Arquivos de **marca de terceiros**, servidos como atribuição.

> Nada aqui é decorativo. Um arquivo só entra neste diretório quando a licença
> correspondente em [`authorization-spec.ts`](../../../../../services/legal/src/authorization-spec.ts)
> declara `logoAllowed: true` **e** aponta para ele em `logoAsset.path`.

## Regra

1. **O arquivo tem de ser o oficial do detentor**, baixado da página que ele
   publica para atribuição. Nunca um espelho de terceiro, nunca um redesenho,
   nunca uma aproximação. Marca distorcida é violação, não cortesia — por isso o
   render é *fail-closed*: sem arquivo, o crédito sai só em texto e a ausência é
   registrada (`section_absent` / `source_logo_asset_missing`), nunca preenchida.
2. **O logo nunca substitui o crédito textual.** Os termos do TMDB pedem os dois
   (marca **e** disclaimer de não-endosso), e um crédito que virasse só imagem
   sumiria para leitor de tela e para quem bloqueia imagem.
3. **Nenhum SVG inline em componente.** A página lê `logoAsset.path`; ela não
   desenha marca de ninguém.

## Pendências

| Arquivo | Fonte | Situação | Onde baixar |
|---|---|---|---|
| `tmdb-primary.svg` | TMDB | **Faltando.** A licença exige (`status: "pending_official_file"`) | <https://www.themoviedb.org/about/logos-attribution> |

O TMDB **exige** o logo dele: *"You must use the TMDB logo to identify Your use
of TMDB, the TMDB APIs, or TMDB Content"* (termos da API, seção 3). Os mesmos
termos impõem o limite: ele deve ser **menos proeminente** que a marca do próprio
produto e não pode sugerir endosso — por isso `displayHeightPx: 18`, contra 28px
do wordmark da Cinerie no rodapé.

Depois de colocar o arquivo, mude `status` para `"present"` em
`TMDB_LOGO_ASSET`. Nenhum componente precisa ser tocado.

## Fontes cujo logo NÃO entra

IMDb, Rotten Tomatoes, Metacritic, OMDb, Movie of the Night, JustWatch e as 24
plataformas de streaming. O motivo de **cada uma** está escrito em
`logoRationale`, na própria licença. Resumo: nenhuma delas concedeu o direito, e
autorização do dono não cria direito que a fonte não deu.

---

## Os três arquivos baixados em 2026-08-21 — leia antes de usar

Eles têm extensão `.svg`. **Nenhum dos três é SVG.** Cabeçalho
`RIFF....WEBPVP8L`: são **WEBP raster** renomeados.

| Arquivo | Formato real | Dimensão | Situação |
| --- | --- | --- | --- |
| `imdb.svg` | **WEBP** | 960 × 484 | Palavra-marca correta. Entra como **`imdb.webp`**. |
| `metacritic.svg` | **WEBP** | 250 × 57 | Palavra-marca correta. Resolução justa — confira 2x antes de promover. Entra como **`metacritic.webp`**. |
| `rottentomatoes.svg` | **WEBP** | 250 × 255 | **ARQUIVO ERRADO. NÃO USE.** |

### Por que o do Rotten Tomatoes não entra

Não é a marca do Rotten Tomatoes: é o **ícone do tomate fresco**, o indicador de
estado *Fresh* do Tomatometer.

Isso viola a **invariante 1**. O tomate fresco não é logo neutro — ele **afirma
que o título é Fresh**. Ao lado de um Tomatometer de 40%, diz ao leitor o
contrário do número que está do lado. É a mesma família de "nota IMDb virar
tomates": a marca carregando um juízo que o dado não sustenta.

> **Regra que entra e fica: ícone de estado nunca é marca.** Fresh, Rotten,
> Certified Fresh e Popcornmeter são indicadores de **resultado**. Se um dia
> forem exibidos, é **derivado do valor real da nota** — nunca fixo, nunca como
> logotipo. O logotipo do Rotten Tomatoes é a palavra-marca.

Até a palavra-marca existir, a fonte é creditada em **texto**, na mesma caixa e
na mesma âncora dos logos — a linha não pode ficar torta com dois arquivos e um
texto misturados.

### O que o registro exige de cada arquivo

`LicenseLogoAsset` (em `services/legal/src/authorization-spec.ts`) declara
`format`, `kind`, `displayHeightPx` e `displayConditions`. Dois testes de
governança conferem, em `tests/governance/brand-asset-format.test.ts`:

- **o `format` declarado é comparado com o CABEÇALHO dos bytes** — extensão é
  palpite do sistema de arquivos, os bytes são o fato. Raster declarado como
  vetor é a mesma classe de defeito do `COLOR_TOKENS`: campo que mente porque
  nada o confere;
- **`kind: "state_icon"` é recusado no slot de logotipo.**

### Condição gravada na licença — IMDb

O IMDb exige, em **qualquer** material que exiba a marca:

> IMDb, IMDb.COM, and the IMDb logo are trademarks of IMDb.com, Inc. or its
> affiliates.

Ela vive em `displayConditions` do asset, não em copy de componente.
**Condição não satisfeita = logo não acende.** Usos fora das diretrizes
publicadas exigem permissão por escrito.

### Regras que valem para qualquer marca de terceiro

- **Nenhum SVG desenhado à mão.** Arquivo oficial ou palavra-marca; nunca
  aproximação — marca distorcida é violação, não cortesia.
- **Altura e proporção respeitadas.** Nada de marca de terceiro esticada.
- **O crédito textual permanece.** Logo não substitui atribuição.
