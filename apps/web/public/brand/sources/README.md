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
