# Marca gráfica das fontes — o regime de cada uma

> Decisão de **20/08/2026**. Pesquisa e redação: agente; **decisão: Pablo Eduardo,
> proprietário da Cinerie**. Fonte executável:
> [`authorization-spec.ts`](../../services/legal/src/authorization-spec.ts)
> (`logoAllowed` + `logoRationale` + `logoAsset`). Em divergência, o código vence
> e este documento é que está errado.

## O que mudou, e por quê

Até aqui `logoAllowed` era o literal `false` no **tipo** de `LicenseTarget`, com a
justificativa *"liberar logo exige autorização específica que não existe"*.

A leitura dos termos, **fonte por fonte**, mostrou que a frase estava certa para
cinco e **errada para uma**:

> "You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs, or
> TMDB Content."
> — Termos de uso da API do TMDB, seção 3 (*Attribution*)

O TMDB não *permite* o logo: ele **exige**. O `false` global não era excesso de
zelo — era **descumprimento** de uma fonte e zelo com cinco. E, com `false` no
tipo, o repositório não tinha como sair disso sem mudar o tipo.

Por isso `logoAllowed` virou `boolean`. **Não é relaxamento de política:** cinco
das seis fontes continuam `false`, agora com o motivo escrito, e a guarda de
runtime (`assertNoBlockedGrants`) passou de *"nenhum logo"* para uma **allowlist
nominal** — liberar qualquer fonte fora dela derruba o `apply` antes de escrever.

## O regime de cada fonte

| Fonte | `logo_allowed` | Regra real |
|---|---|---|
| **TMDB** | ✅ `true` | **Exigido.** Seção 3 dos termos da API. Deve ser *menos proeminente* que a marca do próprio produto e não pode sugerir endosso. O disclaimer textual continua obrigatório **junto** — os termos pedem os dois. Arquivo oficial: <https://www.themoviedb.org/about/logos-attribution> |
| **IMDb** | ❌ `false` | Exige **autorização por escrito** (pedido a `trademarks@amazon.com`, com mockup do uso pretendido). Não temos. Some-se a isso: o dado chega pela **OMDb**, e nenhum intermediário sublicencia marca alheia. |
| **Rotten Tomatoes** | ❌ `false` | **Duas barreiras independentes.** (1) Uso de marca exige aprovação prévia pelo *Business Proposal Form*, que libera os assets. (2) Mesmo aprovado, o ícone é **vinculado à faixa da nota**: Fresh/Hot Popcorn só com ≥ 60%, Rotten Splat/Stale Popcorn só com ≤ 59%, sempre à esquerda do número e sem alteração. Exibir o ícone errado para a faixa é pior que não exibir. |
| **Metacritic** | ❌ `false` | **A mais próxima de virar `true`.** As diretrizes preveem exibir o Metascore com logo e wordmark em site de terceiro — mas não são públicas o bastante para derivar o regime completo (quais arquivos, que autorização prévia, que placement), e não há arquivo oficial em mãos. Fica bloqueado até a diretriz escrita estar disponível. |
| **Letterboxd / FilmAffinity** | ❌ `false` | Sem dado e sem exibição no produto. Bloqueado por **ausência de licença**, não por análise concluída. |
| **OMDb** (prêmios) | ❌ `false` | Os termos não concedem marca — nem a própria. A **seção 11** exclui expressamente sites de terceiros do acordo: a OMDb não pode sublicenciar IMDb, Rotten Tomatoes nem Metacritic. |
| **JustWatch** | ❌ `false` | Exige **atribuição nominal**, não logo: *"In order to use this data you must attribute the source of the data as JustWatch"* (termos do `watch/providers`). Crédito textual **já cumpre** — e já está no rodapé. |
| **Movie of the Night** | ❌ `false` | O agregador não concede uso de marca. |
| **24 plataformas de streaming** (Netflix, Globoplay, Paramount+, Claro, MGM+, …) | ❌ `false` | Cada uma é marca de **titular diferente**, com programa próprio. O `logo_path` que o TMDB serve identifica o arquivo; **não concede uso**. Uma regra única que liberasse as 24 é exatamente a classe de erro que pôs o crédito de "Movie of the Night" em dado do TMDB. Liberar exige o programa de marca de cada titular, um de cada vez. |

## O que a autorização do dono não faz

**Autorização do dono não cria direito que a fonte não deu.** O dono pode
autorizar *usar* o que foi concedido; ele não pode conceder, em nome do IMDb, um
direito que o IMDb condiciona a pedido por escrito.

## Estado hoje

`logo_allowed = true` para as três licenças do TMDB (`other`, `image`, `video`) —
mesma fonte, três `content_type`, **um único crédito** no rodapé.

O **arquivo ainda não está no repositório**. Enquanto não estiver, a licença fica
em `pending_official_file`, o crédito sai textual e a ausência é **registrada**
(`section_absent` / `source_logo_asset_missing`, `actionable: true`) em vez de
muda. Desenhar uma aproximação de marca registrada seria pior que a ausência.

Instruções para colocar o arquivo:
[`apps/web/public/brand/sources/README.md`](../../apps/web/public/brand/sources/README.md).

## Invariantes que isto não toca

- **IMDb ≠ Rotten Tomatoes.** Nota de um nunca vira símbolo do outro.
- **Tomatometer e Popcornmeter** pertencem só ao Rotten Tomatoes.
- **O crédito textual permanece** ao lado do logo. Logo não substitui atribuição.
- **Nenhum logo entra sem estar declarado na licença.** Nenhum SVG de terceiro é
  escrito dentro de componente.
