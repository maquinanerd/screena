# 25 — Advertisement Slots (D3C)

**21 slots** reais no canônico (verificado por script), em **4 formatos**. Já componentizados como `AdSlot`/AdvertisementSlot (dc-import). Esta unidade define contrato e estados; **não** migra telas.

| Formato | Dimensão base | Qtd | Uso típico |
|---|---|---|---|
| leaderboard | 728×90 | **14** | topo/entre seções |
| skyscraper | 160×600 | **3** | coluna lateral |
| billboard | 970×250 | **3** | destaque de topo |
| rectangle | 300×250 | **1** | in-content |
| **Total** | — | **21** | 10 páginas |

## Regras
- **Rótulo “PUBLICIDADE” sempre visível** (não confundir com conteúdo editorial).
- **Espaço reservado** desde o início → **sem layout shift** (CLS) quando o anúncio carrega/falha.
- Estados: `filled` · `placeholder` (carregando) · **`unavailable`** (sem anúncio → espaço mantido, mensagem neutra).
- **Sem anunciante fictício**; nenhum criativo inventado na biblioteca.
- Nunca imitar card/hero editorial.

## Distribuição por página (do inventário)
home 4 · news 6 · article 1 · person 1 · browse 2 · discover 1 · listas 3 · entrar 1 · ad-pop 1 · ad-tela 1 = **21**.
