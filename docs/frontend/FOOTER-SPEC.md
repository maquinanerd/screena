# Footer Global — Cinerie
## Especificação de implementação

Versão: 1.1 · 13/08/2026 (v1.0 em 13/08/2026)
Escopo: rodapé global, presente em **todas as telas públicas** (renderizado junto
do chrome: header + footer).

> **v1.1 — o que mudou em relação à v1.0**
>
> 1. **§4 reescrita.** A v1.0 exigia a atribuição do JustWatch "incluindo nas
>    fichas de título, não só no rodapé". Por decisão do proprietário
>    (Pablo Eduardo, 13/08/2026), **todo crédito de fonte saiu do corpo das
>    páginas e passou a viver só no rodapé global**. Ver §4.
> 2. **§10 nova**, registrando as divergências entre esta spec e o que foi
>    implementado — com o motivo de cada uma. Documento que descreve algo que o
>    código não faz é armadilha para o próximo.
>
> **Sobre a autoridade desta spec.** A v1.0 dizia "autoridade:
> `Screen Screens v4.dc.html`". Isso **não confere**: o rodapé daquele arquivo
> (bloco `<!-- footer · Screen -->`, linha 2253) é claro (`#E2E2E2`), tem 4
> colunas, logo preta, sem créditos de dados e sem "Dados por". A spec descreve
> um rodapé escuro de 5 colunas que **não existe no repositório**. Esta é a
> especificação vigente; o `.dc.html` do handoff é um estado anterior.

---

## 1. Visão geral

Rodapé escuro de largura total, dividido em **5 faixas horizontais** empilhadas,
todas dentro de um container centralizado de `max-width: 1280px` com `padding`
horizontal de `80px`:

1. **Topo** — wordmark + redes sociais
2. **Colunas** — 5 colunas de navegação editorial
3. **Newsletter** — captura de e-mail
4. **Legal + Créditos de fonte** — links jurídicos à esquerda, créditos à direita
5. **Base** — copyright + disclaimer obrigatório + wordmark reduzida

---

## 2. Tokens usados

| Token | Valor | Uso |
|---|---|---|
| `--footer-bg` | `#1C1C1C` | fundo do rodapé inteiro |
| `--footer-text-primary` | `#FFFFFF` | títulos de coluna, título da newsletter |
| `--footer-text-secondary` | `rgba(255,255,255,0.68)` | links de navegação e legais |
| `--footer-text-tertiary` | `rgba(255,255,255,0.62)` | subtítulo da newsletter, copyright |
| `--footer-text-quaternary` | `rgba(255,255,255,0.50)` | disclaimer, rótulo "Dados por" |
| `--footer-rule` | `rgba(255,255,255,0.12)` | divisores horizontais |
| `--footer-border-control` | `rgba(255,255,255,0.14)` | borda do bloco de newsletter |
| `--footer-border-icon` | `rgba(255,255,255,0.28)` | borda dos círculos de rede social |
| `--footer-surface-subtle` | `rgba(255,255,255,0.04)` | fundo do bloco de newsletter |
| `--c-accent-movie` | `#F0443E` | sublinhado da coluna **Filmes** |
| `--c-accent-series` | `#7FA56F` | sublinhado da coluna **Séries e TV** |
| `--footer-accent-neutral` | `rgba(255,255,255,0.32)` | sublinhado das demais colunas |

Os tokens do rodapé são **locais** (declarados em `.footer`), não globais: a faixa
escura é uma ilha de tema e não deve poluir o `:root` claro do resto do site.

**Tipografia:** Montserrat (fonte única do sistema).

**Contraste:** validado em WCAG 2.2 AA sobre `#1C1C1C`. `rgba(255,255,255,0.50)`
a 11px é o piso — qualquer valor menor reprova AA.

**Raios:** apenas `50%` nos círculos de rede social. Todo o resto tem canto reto.

---

## 3. Estrutura, faixa por faixa

### 3.1 Topo — marca + redes

- Container: `padding-top: 56px`, `flex`, `space-between`, `gap:32px`, wrap.
- **Wordmark:** `<a>` com `/brand/cinerie-wordmark-white.svg`, `150×46`,
  `aria-label="Cinerie"`, apontando para a home. É **arquivo SVG**, nunca texto
  desenhado em CSS.
- **Redes:** 4 links circulares (YouTube, Instagram, X, Facebook), `36×36`,
  `border-radius:50%`, ícone SVG com `aria-hidden="true"` e `aria-label` no link.
  Alvo de toque de 44px vem de `padding` (com `margin` negativa devolvendo o
  ritmo), nunca de aumentar o círculo.
  **A faixa só renderiza quando há perfil real cadastrado** em
  `FOOTER_SOCIAL_LINKS` — ver §10.

### 3.2 Colunas de navegação

- Container: `padding-top: 44px`, `grid-template-columns:repeat(5,1fr)`, `gap:32px`.
- **Título:** `14px/700/#FFFFFF`, `display:inline-block`, `padding-bottom:10px`,
  `border-bottom:2px solid <accent>`. O `inline-block` é essencial: o sublinhado
  acompanha a largura do **texto**, não da coluna.
- **Links:** coluna flex, `gap:12px`, `margin-top:16px`, `13px`. Cada item é
  `<a href>` real — nunca `<span>` clicável.
- **Acento por vertical:** Filmes = vermelho, Séries e TV = verde, demais =
  neutro. A cor é **apoio**: a diferenciação filme/série continua vindo de
  label + badge + breadcrumb + schema + URL (invariante 11).

O conteúdo das colunas está em `apps/web/src/config/footer.ts` — ver §6 e §10.

### 3.3 Newsletter

- Bloco com `border`, `background` sutil, `padding:24px 28px`, flex, `gap:28px`.
- Esquerda: título `17px/700` "Receba a newsletter da Cinerie" + subtítulo `13px`
  "Sem spam. Só o que importa em cinema e séries."
- Direita: `<form>` real com `<label>` visualmente oculto, `<input type="email">`
  (`required`, `autocomplete="email"`) e `<button type="submit">` branco,
  `12px/700`, uppercase, rótulo "Assinar".
- Estados: `loading` (botão desabilitado), `sucesso` (mensagem **substitui** o
  campo), `erro` (mensagem em `--c-accent-movie` abaixo do campo). Região de
  status com `aria-live="polite"` **sempre presente no DOM** — um `aria-live` que
  nasce junto da mensagem costuma não ser anunciado.

### 3.4 Legal + Créditos de fonte

- Linha com `border-top`, `padding:26px 0`, flex, `space-between`, wrap.
- **Esquerda:** Termos e Condições · Política de Privacidade · Créditos de dados
  · Índice do site — `12px`, `gap:24px`. "Créditos de dados" aponta para
  `/pt/creditos-de-dados/` (§5).
- **Direita:** rótulo `Dados por` (`10px/700`, `letter-spacing:0.16em`,
  uppercase) seguido dos créditos, **em texto**: o `attribution_text` verbatim da
  licença mais o papel da fonte.

  **Sem logo de terceiro** — ver §4 e §10. **Sem placa, sem cartão, sem fundo
  claro.** E **nenhum `filter: invert()`/`brightness()`** em marca alheia.

### 3.5 Base

- Linha com `border-top`, `padding-top:22px`, flex, `align-items:flex-start`.
- **Esquerda** (`max-width:92ch`): copyright `11px` com ano **dinâmico**, e
  abaixo o disclaimer `11px`, `line-height:1.6` (§4).
- **Direita:** wordmark branca reduzida `120×30`, `opacity:0.55`, decorativa
  (sem link, `aria-hidden`). Oculta no mobile.

---

## 4. Créditos de fonte — o rodapé é o ÚNICO endereço _(13/08/2026)_

> **DECISÃO DO PROPRIETÁRIO (Pablo Eduardo), 13/08/2026.**
> **Todo crédito de fonte sai do corpo das páginas e passa a viver no rodapé
> global.**
>
> A v1.0 desta spec dizia, sobre o JustWatch: *"atribuição visível obrigatória
> sempre que dados de disponibilidade forem exibidos, incluindo nas fichas de
> título, não só no rodapé."* **Essa frase foi removida** — ela descreve a
> política anterior.
>
> **Motivo:** o crédito colado ao dado se espalhava por quatro superfícies com
> regras próprias (chip da nota, painel de streaming, faixa da home — onde
> trocava a cada slide — e hub de "onde assistir"). Um lugar só é auditável;
> quatro não são.
>
> **O que NÃO mudou:** `requires_attribution` continua `true` para todas as
> fontes. Mudou o **endereço** do crédito, nunca a obrigação.

### O rodapé nomeia toda fonte, e não sabe o nome de nenhuma

Os textos de crédito **não são escritos no componente**. Eles vêm de
`publicSourceCredits()` em
[`services/legal/src/public-credits.ts`](../../services/legal/src/public-credits.ts),
derivado de
[`authorization-spec.ts`](../../services/legal/src/authorization-spec.ts) — o
mesmo registro que materializa `source_licenses`.

**Consequência que é o contrato:** registrar uma fonte nova na licença faz o
crédito dela aparecer no rodapé **sem ninguém editar o rodapé**. Travado por
`services/legal/src/__tests__/public-credits.test.ts`, que injeta uma fonte
fictícia no spec e exige que ela apareça na projeção.

As fontes creditadas hoje, com o papel de cada uma:

| Crédito (verbatim da licença) | Papel |
|---|---|
| Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB. | Catálogo, elenco, imagens e ficha técnica |
| Nota fornecida por IMDb | Notas |
| Nota fornecida por Rotten Tomatoes | Notas |
| Nota fornecida por Metacritic | Notas |
| Disponibilidade fornecida por Movie of the Night | Disponibilidade (onde assistir) |
| Disponibilidade fornecida por JustWatch | Disponibilidade (onde assistir) |

O critério é **autorizada a exibir** (`display_allowed` na licença), não "tem
dado no ar hoje". Um critério de dado seria dinâmico, e o rodapé não tem acesso a
ele — o layout raiz não lê banco; pior, uma fonte autorizada que acabasse de
receber a primeira linha ficaria sem crédito até alguém perceber. Um critério de
licença é estático, derivável e conservador na direção certa: **o que pode
aparecer, aparece creditado**.

**Letterboxd e FilmAffinity não estão na lista** porque tiveram a exibição
**revogada** em 13/08/2026 (decisão do proprietário) — ver
[`docs/legal/source-authorization-matrix.md`](../legal/source-authorization-matrix.md).
As licenças delas continuam declaradas no spec, com `display_allowed: false`:
apagá-las deixaria uma licença órfã e vigente no banco, porque
`planAuthorization` só visita o que está no spec.

### A prova mudou junto

Antes, a prova era a proximidade. Agora são duas metades, e nenhuma basta sozinha:

1. o rodapé nomeia toda fonte autorizada (acima);
2. o rodapé está em toda página que exibe dado licenciado — é o layout raiz.

Aferido em
[`apps/web/app/_components/__tests__/footer-credits.test.tsx`](../../apps/web/app/_components/__tests__/footer-credits.test.tsx),
medindo **texto visível** (tags removidas). Medir markup cru aceitaria um crédito
escondido em `aria-label` — foi exatamente esse o defeito da PR #165.

### O que continua no caminho de escrita

Nada foi afrouxado ali. `external_ratings_display_guard` e
`watch_availability_display_guard` continuam recusando linha sem licença e sem
crédito. A procedência segue gravada na linha; mudou só onde ela aparece na tela.

---

## 5. Página "Créditos de dados"

Rota: `/pt/creditos-de-dados/`. Conteúdo:

- Uma linha por fonte: o crédito verbatim da licença e o que ela fornece.
- O disclaimer de não-endosso do TMDB repetido em destaque.
- Aviso de que a disponibilidade varia por região e pode estar defasada.
- Aviso de que a Cinerie não reproduz marca gráfica de terceiro.

Destino do link "Créditos de dados" do rodapé. A lista vem da mesma projeção do
rodapé — a página não pode divergir dele.

---

## 6. Modelo de dados

```ts
type FooterAccent = 'movies' | 'series' | 'neutral'

type FooterColumn = {
  title: string
  accent: FooterAccent
  links: { label: string; href: string }[]
}

type FooterSocialLink = {
  network: 'youtube' | 'instagram' | 'x' | 'facebook'
  label: string
  href: string
}

// Vem de @screena/legal/public-credits — NUNCA escrito à mão.
type PublicSourceCredit = {
  creditKey: string
  text: string        // attribution_text verbatim
  roleLabel: string
  role: SourceRole
}
```

Colunas e redes vêm de `apps/web/src/config/footer.ts`; os créditos vêm de
`services/legal`. Nenhum dos dois é hard-coded no JSX.

---

## 7. Responsivo

| Faixa | ≥1280px | 1024–1279px | 768–1023px | <768px |
|---|---|---|---|---|
| Padding horizontal | 80px | 56px | 40px | 20px |
| Colunas | 5 | 5 | 3 | 2 |
| Topo (marca/redes) | mesma linha | mesma linha | mesma linha | empilhado |
| Newsletter | lado a lado | lado a lado | empilhado | empilhado, botão 100% |
| Legal + créditos | mesma linha | mesma linha | empilhado | empilhado |
| Base | 2 colunas | 2 colunas | empilhado | empilhado, wordmark oculta |

No mobile o `padding-top` do topo cai de `56px` para `40px` e o `gap` das colunas
de `32px` para `28px`.

**Nenhum breakpoint pode esconder `.footer__credits`.** A wordmark decorativa da
base sai no mobile; o crédito, nunca.

---

## 8. Semântica e acessibilidade

- Raiz: `<footer role="contentinfo">`. Cada grupo de links em `<nav aria-label>`
  com `<ul>/<li>`.
- **Navegação sempre `<a href>`; ação sempre `<button>`.** Nenhum `<span>` ou
  `<div>` clicável.
- Ícones SVG decorativos: `aria-hidden="true"`; o nome acessível vem do
  `aria-label` do link.
- Foco visível em todo interativo: `outline: 2px solid #FFFFFF`,
  `outline-offset:2px`. Sobre `#1C1C1C` é o único sinal de foco que sobrevive.
- Títulos de coluna são `<p>` com peso 700, **não** `<h2>`: o rodapé não pode
  competir com a hierarquia de títulos da página.
- O `<label>` da newsletter é visualmente oculto por CSS, **nunca**
  `display:none` (some do leitor de tela). Placeholder não é rótulo.

---

## 9. Checklist de aceite

- [x] Fundo `#1C1C1C`, sem gradiente, 100% da largura.
- [x] Container 1280px, padding 80px, alinhado com o header.
- [x] Wordmark via SVG; wordmark da base com `opacity:0.55`.
- [x] 5 colunas; Filmes com `--c-accent-movie`, Séries e TV com `--c-accent-series`.
- [x] Sublinhado do título acompanha a largura do texto.
- [x] Newsletter: `<form>`, `<input type="email">`, `<button type="submit">`,
      três estados, `aria-live`.
- [x] Créditos em **texto**, direto sobre o fundo escuro — nenhuma placa branca,
      nenhum logo de terceiro, nenhum `filter`.
- [x] Disclaimer do TMDB presente, literal, vindo da licença.
- [x] "Créditos de dados" resolve para `/pt/creditos-de-dados/`.
- [x] Ano do copyright dinâmico.
- [x] Nenhum `<span>`/`<div>` clicável; foco visível em tudo.
- [x] Zero ocorrências de "Screena", "The Screen" ou "thescreen.media" em
      superfície visível.
- [x] Nenhum `border-radius` além do `50%` dos círculos.

---

## 10. Divergências entre esta spec e a implementação _(13/08/2026)_

Registradas aqui porque silenciá-las é pior que tê-las.

### 10.1 Sem logos das fontes de dados — **duas causas independentes**

A v1.0 (§3.4) pedia os logos de TMDB, OMDb, JustWatch e Wikidata, `height:24px`,
`opacity:0.72`. Não foram implementados:

1. **Os arquivos não existem.** `assets/data-credits/tmdb.svg`, `omdb.svg`,
   `justwatch.svg` e `wikidata.svg` não estão no repositório — nem em
   `docs/design-handoff/`, nem em `apps/web/public/`. O repositório inteiro tem
   8 SVGs, todos da marca Cinerie.
2. **A licença proíbe.** `logoAllowed` é o literal `false` **no tipo** de
   `LicenseTarget` ("Liberar logo ou citação exige decisão humana e mudança de
   tipo"), e a nota de cada licença diz "Logo e citacao integral de critica NAO
   autorizados".

A segunda causa sozinha já bastaria: mesmo com os arquivos em mãos, exibi-los
violaria a matriz de licença. O crédito é **textual** — que é, aliás, o que
`requiresAttribution` de fato exige.

### 10.2 Wordmark: variante diferente da pedida

A spec pede `uploads/5f-logo-branca-sublinhado-branco.svg`. Esse arquivo — e o
diretório `uploads/` inteiro — não existe no repositório. Foi usada
`/brand/cinerie-wordmark-white.svg`, a variante branca aprovada para fundo
escuro. Ela **não tem o sublinhado**: esse dispositivo pertencia ao logo antigo
("Screen"), e `apps/web/public/brand/README.md` registra o wordmark atual como
provisório, à espera de design.

### 10.3 Wikidata não é creditada

Não há licença de Wikidata em `authorization-spec.ts`. Creditar uma fonte que o
registro legal não conhece seria inventar procedência. Registre a licença e o
crédito aparece sozinho (§4).

### 10.4 Colunas: estrutura da spec, conteúdo real

A spec lista 24 links ("Top 250", "Mais vistos", "Mais premiados", "Nascidos
hoje", "Imprensa", "Vagas"...). A maioria dessas rotas **não existe**.

O rodapé anterior tinha exatamente esses rótulos, e eles foram removidos de
propósito: `docs/SCREEN_MASTER_PROJECT_AUDIT_AND_PRODUCT_ROADMAP.md` registra
"12 âncoras com texto distinto apontando para 3 URLs — para o usuário é uma
armadilha; para o crawler é diluição de sinal de anchor text".

Então: **estrutura** da spec (5 colunas, acentos), **conteúdo** só com destino
que existe. Travado por `tests/web/public-navigation.test.ts`, que exige que todo
href do rodapé resolva para um arquivo de rota e que nenhum href se repita.

### 10.5 Redes sociais: componente pronto, lista vazia

Os 4 ícones oficiais e toda a acessibilidade estão implementados, mas
`FOOTER_SOCIAL_LINKS` está **vazio**: não há perfil oficial da marca registrado
no projeto, e inventar URL seria fabricar. Com a lista vazia a faixa não
renderiza — um círculo que leva a lugar nenhum é pior que a ausência dele.
Preencher a constante liga a faixa inteira, sem tocar no componente.

### 10.6 Newsletter: a faixa não renderiza, e diz por quê _(atualizado 13/08/2026)_

Não há tabela de inscrição no schema, e criar uma é tarefa de banco aprovada
(CLAUDE.md §10).

A primeira versão desta mudança deixou a faixa no ar com a rota respondendo
`503` honesto. **Decisão do proprietário: esconder a faixa.** Recusar o `200 OK`
mentiroso estava certo, mas um formulário que nunca consegue ter sucesso é pior
que ausência — o leitor digita o e-mail, aperta, e recebe erro. O gesto foi gasto
à toa.

Então a faixa fica **atrás da flag `CINERIE_NEWSLETTER_ENABLED`** (fail-closed,
desligada por default). O `<form>`, os três estados, o `aria-live` e os testes
**continuam existindo** — é trabalho feito e testado, e vai ao ar ligando a flag
no dia em que a tabela existir. A rota também fica, com o `503`: quem chegar nela
por outro caminho continua recebendo a verdade.

A ausência não é muda. O `SectionBoundary` emite
`{"section":"newsletter","reason":"newsletter_storage_unavailable","surface":"footer","actionable":true}`
— **uma vez por processo**, não por request (o rodapé renderiza em toda página).

O que exatamente destrava a flag — a tabela e o que ela precisa carregar — está
em [`newsletter.md`](./newsletter.md).

### 10.7 Página de créditos sem link de site/termos por fonte

A §5 da v1.0 pedia, por fonte, o link do site e o link dos termos. O registro
legal não os tem: `LicenseTarget` guarda `attributionText`, e `apply.ts` não
escreve `terms_url`. Escrever ali uma URL que a licença não declara seria
inventar procedência. O **linkback**, quando exigido, viaja com o próprio dado
(`attribution_url`) e é gate de exibição — não depende dessa página.
