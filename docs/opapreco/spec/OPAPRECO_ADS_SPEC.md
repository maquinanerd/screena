# OpaPreço Ads — Especificação de produção v1

Fonte visual: `OpaPreço Ads - Pranchas.dc.html` (pranchas) e `OpaPreço Ads - Especificação.dc.html` (documentação).
Referência de implementação: os arquivos `product_*.dc.html`, `price_drop_v1.dc.html` e `contextual_recommendation_v1.dc.html` contêm a marcação e a lógica de campos opcionais de cada componente. Tokens: `handoff/tokens.json`.

Inventário v1: somente ofertas Shopee. Primeiro publisher: Máquina Nerd.

---

## 1. Princípios

1. **Herdar o publisher.** `font-family: inherit`. Nenhuma fonte externa. Fundo branco, borda 1px, sem sombra.
2. **Uma cor de ação.** Verde OpaPreço `#0B6E4F` (contraste 6,3:1 com branco). Nunca o laranja da Shopee.
3. **Assinatura constante.** Topo: `OpaPreço | rótulo` à esquerda e selo de afiliado à direita. Rodapé: `Shopee · Preço verificado há X min`.
4. **Preço manda.** O preço atual é o maior texto do bloco. Desconto aparece só com prova e com sinal duplo (preço riscado + `−N%`), nunca só por cor.
5. **Nada vazio.** Campo opcional ausente = elemento não renderizado, sem reserva interna.
6. **Falha silenciosa.** Erro ou ausência de oferta: o slot colapsa. Nunca mensagem de erro para o leitor.

---

## 2. Tokens (resumo — fonte completa em tokens.json)

| Token | Valor |
|---|---|
| color.background | #FFFFFF |
| color.surface | #F7F7F7 (fundo de imagem, bloco de monitoramento, linha de produto do contextual) |
| color.border / borderHover | #E6E6E6 / #CFCFCF |
| color.textPrimary / textSecondary | #111111 / #666666 (5,7:1) |
| color.action / hover / active | #0B6E4F / #095A41 / #074633 |
| color.positive / positiveBg | #0B6E4F / #EDF5F1 (badge de desconto, 5,8:1) |
| radius | badge 4 · image 6 · cta 6 · card 8 · hero 12 |
| space | 4 · 8 · 12 · 16 · 20 · 24 · 32 |
| shadow | nenhuma |
| focus | outline 2px solid #0B6E4F, offset 2px, apenas em `:focus-visible` |
| motion | 120ms ease em border-color e background-color; colapso de slot 200ms |

Theming futuro: expor como CSS custom properties com prefixo `--op-` (`--op-action`, `--op-border`, `--op-radius-card` …) no elemento raiz do slot. O publisher só pode sobrescrever: action (desde que mantenha 4,5:1 com o texto do CTA), border, radius e font-family. Não pode remover o selo de afiliado.

---

## 3. Tipografia

| Papel | Tamanho / linha | Peso |
|---|---|---|
| Eyebrow (marca + rótulo) | 12/16 (hero 13/16) | 400; "OpaPreço" 700 |
| Rótulo do contextual | 12/16, uppercase, tracking .06em | 700 |
| Heading contextual | 18 / 1.3 | 700 |
| Título | card 17 · hero 18 · drop 16 · compact/grid/contextual 15 — line-height 1.3 | 600 |
| Preço atual | hero 28/34 · drop 26/32 · card 24/30 · contextual 22/28 · compact/grid 20/24 | 700, `tabular-nums`, tracking −0.01em |
| Preço de referência | 13 (hero/drop 14), line-through, #666 | 400 |
| Desconto | 12/18 | 700 |
| Meta / verificação | 12/16, #666 | 400 |
| Disclosure | 11/16, #666 | 400 |
| CTA | 15 (hero 16, secundário 14) | 600 |

---

## 4. Modelo de dados

```ts
type OfferData = {
  productTitle: string;            // obrigatório
  productImage?: string | null;    // URL; ausente → ícone neutro
  imageRatio?: 'square' | 'vertical' | 'horizontal'; // dica opcional; render é sempre contain
  currentPrice: number;            // obrigatório, BRL
  referencePrice?: number;         // só se comprovado
  discountPercent?: number;        // só se comprovado; inteiro
  merchant: 'Shopee';              // texto informativo
  checkedAt?: string;              // ISO 8601
  href: string;                    // link afiliado final
  cta?: string;                    // default "Ver oferta na Shopee"
  ctaShort?: string;               // default "Ver oferta" (compact, grid)
  affiliateDisclosure?: string;    // default por componente
  eyebrow?: string;                // default por componente
  priceDrop?: { from: number; percent: number; since?: string };
  historicalPrice?: { lowest30d?: number };
  dealScore?: number;              // não exibido na v1; uso interno de ranking
  isOfficialStore?: boolean;
};
```

### Regras de exibição de preço (backend + frontend)

- Desconto exibido somente se `referencePrice > currentPrice` **e** `discountPercent >= 5`. Abaixo de 5% não exibir.
- Formato: `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` → `R$ 299,90`.
- Sinal de desconto: `−17%` com U+2212 (menos), não hífen.
- `checkedAt`: < 1 min → "Preço verificado agora"; < 60 min → "há X min"; < 6 h → "há X h". Oferta com verificação > 6 h **não é servida**.
- "Menor preço recente" / "menor preço dos últimos 30 dias" só se `currentPrice <= historicalPrice.lowest30d`.
- `price_drop_v1` só é servido se `priceDrop.from > currentPrice` e `percent >= 5`; caso contrário o backend serve `product_card_v1`.

---

## 5. Componentes

Todos: elemento clicável único `<a href rel="sponsored noopener" target="_blank">` com `aria-label` completo ("{título} por {preço} na Shopee. Link de afiliado"). O CTA dentro dele é um `<span>` com aparência de botão (um único tab stop por oferta). Imagem com `alt=""` porque o título já está no link. Atributo `data-ad-component="{nome}"` no raiz para tracking.

Responsividade por **largura do container**, não do viewport (flex-wrap com flex-basis, ou container queries equivalentes). Os limiares abaixo são larguras do componente.

### 5.1 product_card_v1 — meio de artigo, sidebar

```ts
type ProductCardProps = {
  productImage?: string; productTitle: string;
  currentPrice: number; referencePrice?: number; discountPercent?: number;
  merchant: string; eyebrow?: string;   // default "Oferta verificada"
  checkedAt?: string; cta?: string;      // default "Ver oferta na Shopee"
  affiliateDisclosure?: string;          // default "Link de afiliado"
  href: string;
}
```

Anatomia: 1 imagem · 2 eyebrow (OpaPreço | rótulo) · 3 selo de afiliado · 4 título · 5 preço atual · 6 preço de referência* · 7 desconto* · 8 meta (merchant · verificado) · 9 CTA primário.

| | ≥ 480px (horizontal) | < 480px (vertical) |
|---|---|---|
| Raiz | flex row, gap 16, padding 16, border 1px, radius 8 | idem, wrap |
| Imagem | 160×160, radius 6, bg surface | 100% × 180 |
| Corpo | flex 1, coluna, gap 8 | |
| Rodapé | meta (flex 999 1 180px) + CTA (flex 1 1 150px) em linha | meta acima, CTA 100% |
| CTA | min-height 44, padding 0 16, radius 6 | idem |
| Reserva de altura | 194px | 416px (título 2 linhas) |

Truncamento: título 2 linhas (`-webkit-line-clamp: 2`). Em sidebar de 300px o card fica vertical automaticamente.

### 5.2 product_compact_v1 — entre parágrafos

```ts
type ProductCompactProps = {
  productImage?: string; productTitle: string;
  currentPrice: number; referencePrice?: number; discountPercent?: number;
  merchant: string; ctaShort?: string;   // default "Ver oferta"
  affiliateDisclosure?: string;          // default "Oferta afiliada"
  href: string;
}
```

Anatomia: thumbnail 56×56 · linha de disclosure "Oferta afiliada · Shopee" 11px · título 1 linha com ellipsis · preço 20px + desconto* · CTA secundário (outline). Nunca quebra de linha estrutural; sempre uma linha. Padding 12, gap 12. Altura fixa: **88px** em qualquer largura ≥ 300px. Preço de referência riscado é omitido por espaço; o badge de desconto basta.

### 5.3 product_hero_v1 — article-top

```ts
type ProductHeroProps = ProductCardProps & {
  historicalPrice?: { lowest30d?: number };
  isOfficialStore?: boolean;
}
```

Anatomia: painel de imagem (sangria dentro do card) · eyebrow 13px · selo · título 18px clamp 3 · preço de referência + desconto* acima do preço · preço 28px · bloco "Preço monitorado pelo OpaPreço" (surface, radius 8, padding 10/12) com linha de verificação, menor preço 30d* e loja oficial* · CTA primário 48px, largura total.

| | ≥ 600px | < 600px |
|---|---|---|
| Imagem | flex 1 1 300px, min-height 300, padding interno 24 | 100% × 300 |
| Corpo | padding 24, gap 12 | idem |
| Raio | 12 | 12 |
| Reserva | 344px | 642px |

Não usar headline de marketing, fundo colorido ou imagem lifestyle. Limite de largura: coluna do artigo (máx. 760px). No mobile, o slot article-top serve `product_compact_v1` (o hero ocupa uma tela inteira antes do conteúdo).

### 5.4 product_grid_v1 — article-bottom

```ts
type ProductGridProps = {
  heading?: string;                   // default "Ofertas relacionadas"
  offers: OfferData[];                // 2 a 4; < 2 → não renderiza
  maxItems?: 2 | 3 | 4;               // default 4
  affiliateDisclosure?: string;       // default "Links de afiliado"
}
```

Anatomia: cabeçalho (heading 17px 700 + "OpaPreço · Links de afiliado", divisor inferior 1px) · lista `<ul>` · item: imagem 100%×140, título 15px clamp 2 com min-height 40px, preço 20px + desconto*, CTA secundário 44px no rodapé do item (`margin-top: auto`, alinhado entre colunas) · rodapé "Preços na Shopee, verificados há até X min."

Grid: `repeat(auto-fill, minmax(150px, 1fr))`, gap 12, máximo 4 colunas. 720px → 4 colunas; 343px → 2 colunas. Mobile usa grid de 2 colunas, sem carrossel (carrossel esconde ofertas e dificulta o disclosure). Enviar 2 ou 4 itens; com 3 itens no mobile, o backend envia os 2 primeiros. Reserva: 1 linha 372px, 2 linhas 682px.

### 5.5 price_drop_v1 — queda comprovada

```ts
type PriceDropProps = {
  productImage?: string; productTitle: string;
  currentPrice: number;
  priceDrop: { from: number; percent: number; since?: string }; // obrigatório
  merchant: string; checkedAt: string;  // obrigatório neste formato
  cta?: string;                          // default "Conferir preço"
  affiliateDisclosure?: string;          // default "Link de afiliado"
  href: string;
}
```

Anatomia: linha de queda (seta ↓ + "Preço caiu 18%" 13px 700 em action, divisor, "OpaPreço registrou a queda nas últimas 24 h") · selo · imagem 120×120 · título 16px clamp 2 · "de R$ 399,90" (14px, riscado) "por R$ 329,90" (26px) · meta · CTA primário.

A queda é comunicada por texto + seta + preço riscado. O percentual tem 13px: menor que o preço. Sem vermelho, sem fundo colorido. ≥ 430px: imagem ao lado; abaixo: imagem 100% × 120. Reserva 216px / 352px.

### 5.6 contextual_recommendation_v1 — formato prioritário (article-inline-01)

```ts
type ContextualRecommendationProps = {
  context: string;           // obrigatório. "Se você está procurando um SSD para PS5"
  contextNote?: string;      // 1 frase factual, máx. 140 caracteres
  offer: OfferData;
  affiliateDisclosure?: string; // default "Oferta afiliada"
}
```

Anatomia: `<aside aria-label="Oferta afiliada">` sem caixa · régua superior 2px #111 e inferior 1px #E6E6E6 · rótulo "OFERTA AFILIADA" (12px uppercase 700) à esquerda e "Selecionada pelo OpaPreço" à direita · heading de contexto 18px 700 · nota 15px #444* · linha de produto clicável (surface #F7F7F7, radius 8, padding 12; hover #F0F0F0): thumb 88×88 em fundo branco, título 15px clamp 2, preço 22px + referência + desconto*, meta · CTA primário.

≥ 520px: CTA à direita da linha de produto (flex 1 1 180px). Abaixo: CTA 100% abaixo. Padding vertical 14/20, sem padding lateral (alinha com o texto do artigo). Reserva: ~270px desktop / ~370px mobile (heading 2 linhas, nota 3 linhas).

Regras de conteúdo do `context`: formato "Se você está procurando {categoria} para {produto da matéria}" ou "Para quem vai {ação da matéria}". Gerado a partir das tags da matéria, nunca escrito como se fosse a opinião do autor. `contextNote` só com fato verificável da ficha do produto (compatibilidade, capacidade, conexão). Sem adjetivos ("incrível", "o melhor").

---

## 6. Posições

| Slot | Desktop/tablet | Mobile | Observação |
|---|---|---|---|
| article-top | product_hero_v1 | product_compact_v1 | abaixo do título/lead, nunca acima do título |
| article-inline-01 | contextual_recommendation_v1 | idem | após o 2º ou 3º parágrafo |
| article-inline-02 | product_compact_v1 ou price_drop_v1 | idem | mínimo 3 parágrafos após inline-01 |
| article-bottom | product_grid_v1 | idem (2 colunas) | antes de comentários/relacionados do publisher |
| sidebar | product_card_v1 (vertical, 300px), sticky top 24px | não renderiza | só ≥ 1024px |

Máximo de 1 price_drop_v1 por página. Máximo 4 slots ativos por matéria. Breakpoints de viewport (para escolha do slot): mobile < 768, tablet 768–1023, desktop ≥ 1024. Coluna de referência: 720px em 1440px.

---

## 7. Estados

| Estado | Tratamento |
|---|---|
| default | borda #E6E6E6 |
| hover | borda #CFCFCF, título sublinhado (offset 3px, 1px), CTA primário #095A41 / secundário bg #EDF5F1. Sem elevação, sem escala. |
| focus-visible | outline 2px #0B6E4F, offset 2px, no `<a>` raiz |
| active | CTA primário #074633 / secundário bg #DCEDE4 |
| loading | skeleton com a mesma geometria e reserva de altura; blocos #EEEEEE; pulso opcional opacity 1→.6 1.2s, desligado em `prefers-reduced-motion` |
| error | slot colapsa (height → 0, 200ms) ou não é montado. Sem mensagem. Log interno. |
| empty | igual a error (ad server responde 204) |
| disabled | oferta expirada após o render (revalidação no clique/visibilidade): preço e título #666, CTA bg #F0F0F0 texto #666 "Oferta indisponível", sem href, `aria-disabled="true"`. Substituir por nova oferta no próximo carregamento. |

---

## 8. Imagem

- Sempre `object-fit: contain` sobre fundo #F7F7F7 com `mix-blend-mode: multiply` (funde fundos brancos de foto de produto). Nunca `cover` (corta produto).
- Quadro com dimensões fixas por componente (seção 5) → imagem vertical, quadrada ou horizontal cabem sem alterar a altura do componente.
- `loading="lazy"` exceto hero (`eager`). Servir WebP 2× do quadro (card 320px, hero 600px, compact 112px).
- Sem imagem: ícone de etiqueta 28px #9A9A9A centralizado (+ nome do merchant no card). O quadro permanece para manter a altura.

## 9. Truncamento

| Componente | Título | Outros |
|---|---|---|
| card | 2 linhas | eyebrow 1 linha |
| compact | 1 linha, ellipsis | — |
| hero | 3 linhas | — |
| grid | 2 linhas + min-height 2 linhas | heading 1 linha |
| price_drop | 2 linhas | — |
| contextual | 2 linhas | context: sem clamp, máx. 90 caracteres no backend; note máx. 140 |

Backend: limpar títulos da Shopee antes de enviar (remover "Promoção", "Frete Grátis", "Original", emojis, caixa alta em excesso, colchetes). Máx. 120 caracteres.

## 10. Acessibilidade

- Contraste AA: todos os pares de texto ≥ 4,5:1 (#666 em #FFF 5,7; #666 em #F0F0F0 5,0; #0B6E4F em #EDF5F1 5,8; #FFF em #0B6E4F 6,3).
- Alvo de toque ≥ 44px em todos os CTAs; o componente inteiro é clicável.
- Desconto nunca só por cor: preço riscado + sinal "−" + `aria-label="17% de desconto"`; preço riscado com `aria-label="Preço de referência R$ 359,90"`.
- `rel="sponsored noopener"`, `target="_blank"`. Contextual usa `<aside>`, grid usa `<section>` + `<ul>`.
- Leitores de tela leem o disclosure dentro do `aria-label` do link.

## 11. Disclosure

Todo componente mostra o disclosure **visível** sem interação: selo bordado "Link de afiliado" (card, hero, drop), "Oferta afiliada · Shopee" (compact), "OFERTA AFILIADA" (contextual), "OpaPreço · Links de afiliado" (grid). Nunca em tooltip, nunca abaixo de 11px, nunca com contraste menor que o texto secundário.

## 12. Microcopy

| Texto | Onde | Quando |
|---|---|---|
| Oferta verificada | eyebrow card/hero | default; preço checado < 6 h |
| Menor preço recente | eyebrow hero/card | `currentPrice <= lowest30d` |
| Boa oportunidade | eyebrow | `dealScore` ≥ limiar interno e desconto comprovado ≥ 10% |
| Preço caiu N% | price_drop | queda comprovada ≥ 5% |
| Preço monitorado pelo OpaPreço | bloco do hero | sempre no hero |
| Preço verificado agora / há X min / há X h | meta | `checkedAt` < 6 h |
| Ver oferta na Shopee | CTA primário | default card, hero, contextual |
| Ver oferta | CTA secundário | compact, grid |
| Conferir preço | CTA | price_drop (o usuário confirma a queda) |
| Link de afiliado | selo | card, hero, drop |
| Oferta afiliada | selo | compact, contextual |
| Links de afiliado | selo | grid |
| Selecionada pelo OpaPreço | contextual | sempre |
| Oferta indisponível | CTA disabled | oferta expirou |

Proibido sem evidência: Últimas unidades · Corra · Só hoje · Acaba em X minutos · Oferta imperdível · Menor preço do Brasil · Frete grátis · Cupom disponível. Proibido sempre: contagem regressiva, CTA piscando, "Compre já", maiúsculas no título do produto.

## 13. Do / Don't

Do: deixar a fonte do publisher; usar borda; mostrar só o preço quando não houver referência; colapsar o slot vazio; manter o selo de afiliado visível; exibir o horário de verificação.
Don't: sombra, gradiente, blur, neon; laranja Shopee ou logo Shopee como marca do anúncio; badge de desconto maior que o preço; várias badges empilhadas; skeleton infinito; "erro ao carregar"; carrossel no mobile; imagem com `cover`.

## 14. Implementação de slot (CLS)

```html
<div class="op-slot" data-op-slot="article-inline-01" style="min-height:270px">
  <!-- componente renderizado aqui -->
</div>
```

1. Servidor conhece o componente escolhido → renderiza SSR com reserva da tabela da seção 5 para a largura do container.
2. Sem SSR → reserva pela tabela, skeleton, troca pelo componente no mesmo frame em que a resposta chega.
3. 204/erro antes do 1º paint → remover o slot. Depois do paint → `height: 0` em 200ms (`overflow: hidden`), fora da viewport de preferência.
4. Timeout de 1,5 s → tratar como empty.
