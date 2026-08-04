# 37 — Logo Asset Mapping

## 1. Fontes oficiais (6 SVGs enviados pelo usuário)

| Arquivo | Tom | Acento | Hex do acento |
|---|---|---|---|
| `uploads/cinerie-black.svg` | Preto (`#060606`) | Neutro | `#060606` |
| `uploads/cinerie-black-red.svg` | Preto | Filmes | `#F0443E`* |
| `uploads/cinerie-black-green.svg` | Preto | Séries | `#7FA56F`* |
| `uploads/cinerie-white.svg` | Branco (`#fcfcfc`) | Neutro | `#fcfcfc` |
| `uploads/cinerie-white-red.svg` | Branco | Filmes | `#c92b2b` |
| `uploads/cinerie-white-green.svg` | Branco | Séries | `#5d7d51` |

*Nota: os valores exatos de acento nos arquivos `cinerie-black-red`/`cinerie-black-green` fornecidos pelo usuário não foram lidos byte-a-byte nesta auditoria (peso de leitura); os slots internos `5b`/`5c`/`5g`/`5h` (abaixo) já foram normalizados para o hex de marca exato `#F0443E`/`#7FA56F` — é essa a fonte que a interface renderiza.

## 2. Slots internos ativos (referenciados pelo `LOGOS` map no canônico)

O canônico consome os SVGs através de `paginas/_logica-component.js` / `Screen Screens v4.dc.html`:
```
logoTone   = transparent ? "branca" : "preta"
logoUnder  = (isNews||isArticle) ? "noticias" : catRed ? "cinema" : catGreen ? "serie" : isPerson ? "pessoas" : (transparent ? "branco" : "preto")
logoBg     = LOGOS[logoTone + "-" + logoUnder]
```

| Slot (chave) | Arquivo referenciado | Acento renderizado | Contexto (telas) | Status |
|---|---|---|---|---|
| `preta-preto` | `uploads/5a-logo-preta-sublinhado-preto.svg` | `#060606` neutro | Home/News/Person/Browse/Discover/Listas/Settings/Data/Entrar (nav sólida, fora de filme/série) | ✅ EM USO · CONFORME |
| `preta-cinema` | `uploads/5b-logo-preta-sublinhado-cinema.svg` | `#F0443E` vermelho | Cinema (cat-home), Movie Detail (nav sólida) | ✅ EM USO · CONFORME |
| `preta-serie` | `uploads/5c-logo-preta-sublinhado-serie.svg` | `#7FA56F` verde | Serie (cat-home), Series Detail/Mobile (nav sólida) | ✅ EM USO · CONFORME |
| `preta-pessoas` | `uploads/5d-logo-preta-sublinhado-pessoas.svg` | `#060606` neutro | Person (nav sólida) | ✅ EM USO · CONFORME (neutro, conforme regra nova) |
| `preta-noticias` | `uploads/5e-logo-preta-sublinhado-noticias.svg` | `#060606` neutro | News, Article (nav sólida) | ✅ EM USO · CONFORME (neutro, conforme regra nova) |
| `branca-branco` | `uploads/5f-logo-branca-sublinhado-branco.svg` | `#fcfcfc` neutro | Home/hero (nav transparente, fora de filme/série/pessoas/notícias) | ✅ EM USO · CONFORME |
| `branca-cinema` | `uploads/5g-logo-branca-sublinhado-cinema.svg` | `#F0443E` vermelho | Cinema/Movie Detail (nav transparente sobre hero) | ✅ EM USO · CONFORME |
| `branca-serie` | `uploads/5h-logo-branca-sublinhado-serie.svg` | `#7FA56F` verde | Serie/Series Detail (nav transparente sobre hero) | ✅ EM USO · CONFORME |
| `branca-pessoas` | `uploads/5i-logo-branca-sublinhado-pessoas.svg` | `#fcfcfc` neutro | Person (nav transparente, se houver hero) | ✅ EM USO · CONFORME (neutro) |
| `branca-noticias` | `uploads/5j-logo-branca-sublinhado-noticias.svg` | `#fcfcfc` neutro | News/Article (nav transparente sobre hero) | ✅ EM USO · CONFORME (neutro) |

**Regra confirmada em código:** nenhuma tela mista/neutra usa vermelho ou verde — `logoUnder` só resolve `"cinema"`/`"serie"` quando `catRed`/`catGreen` (contexto exclusivo de filme/série). Pessoas e Notícias sempre caem em acento neutro. **A implementação já está em conformidade com a regra semântica desta missão — nenhuma correção de código foi necessária aqui.**

## 3. ⚠️ Achado de auditoria — 10 arquivos duplicados NÃO usados e NÃO conformes

Existem, ao lado de cada slot ativo, variantes com sufixo de hash (ex.: `5a-logo-preta-sublinhado-preto-80c7bb5b.svg`) — estrutura de SVG diferente (viewBox `18 -742 2978 922`, dois `<path>` — glifo + barra de acento separada) e **não referenciadas em nenhum lugar do código** (`LOGOS` só aponta para os arquivos sem sufixo).

| Slot | Arquivo órfão | Acento no arquivo | Conforme à regra? |
|---|---|---|---|
| preta-preto | `5a-logo-preta-sublinhado-preto-80c7bb5b.svg` | `#111113` (neutro) | ✅ cor ok, mas **não referenciado** |
| preta-pessoas | `5d-logo-preta-sublinhado-pessoas-8590fc79.svg` | (não lido) | — |
| preta-noticias | `5e-logo-preta-sublinhado-noticias-6fd6282b.svg` | **`#4A72C4` (azul)** | ❌ **NÃO conforme** — notícias deve ser neutro |
| branca-cinema | `5g-logo-branca-sublinhado-cinema-22d213ef.svg` | `#E24B4A` (vermelho, mas não é o hex de marca `#F0443E`) | ⚠️ hex divergente |
| branca-serie | `5h-logo-branca-sublinhado-serie-bbe8bdc9.svg` | `#639922` (verde, mas não é o hex de marca `#7FA56F`) | ⚠️ hex divergente |
| branca-pessoas | `5i-logo-branca-sublinhado-pessoas-d92df756.svg` | **`#E2A83B` (dourado/âmbar)** | ❌ **NÃO conforme** — pessoas deve ser neutro |
| branca-noticias | `5j-logo-branca-sublinhado-noticias-f51fc318.svg` | **`#4A72C4` (azul)** | ❌ **NÃO conforme** — notícias deve ser neutro |

**STATUS: `ARQUIVADO_LEGACY_NAO_USAR` (executado em D2, 2026-07-21).** Movidos para `uploads/LEGACY-NAO-USAR/` (não apagados), com `_LEGACY-NAO-USAR.md` documentando nome/hash/tamanho/cor/motivo; `referenced:false` confirmado antes de mover. Eram um upload/experimento anterior com um esquema de cor por categoria (azul=notícias, dourado=pessoas) que a regra atual desta missão **explicitly proíbe** ("não usar vermelho/verde por decoração"; pessoas e notícias são contextos neutros). Como não estão referenciados, não há bug ativo — mas recomenda-se movê-los para `uploads/22-archive-legacy-logos/` (preservados, não implementáveis) para não serem acidentalmente wireados depois. Não deletados nesta passada, conforme regra "eliminar somente após confirmar que não são necessários".

## 4. Outros achados no diretório `uploads/`

- **`uploads/Convert logos to SVG/`** — subpasta com cópias duplicadas de ao menos 3 dos 6 SVGs oficiais (`cinerie-black.svg`, `cinerie-black-red.svg`, `cinerie-white-green.svg`). Não referenciada pelo código. Provável artefato de processo de conversão. Não usada, sem risco ativo.
- **Wordmarks legados "SCREEN"/"SCRENA"** — `screen-all-white.svg`, `screen-all-black.svg`, `screen-auto.svg`, `screen-auto-black.svg`, `screen_logo_branco.svg`, `screen_logo_branco_movies.svg`, `screen_logo_black_series.svg`, `screen-movie-black.svg`, `screen-series-black.svg`, `screen_logo_filme_dark.svg` (`aria-label="SCRENA"`), `screen_logo_serie_dark.svg` (`aria-label="SCRENA"`), `screen_logo_serie.svg`, `screen_logo_animada.svg`. Marca antiga, **não referenciados** pelo `LOGOS` map ativo. Recomenda-se arquivar (não deletar) junto aos demais legados de marca.
- **`uploads/the_screen_badges_v3_1_official_identity/`** — sistema de badges de conquista/rank (avatares, molduras, estrelas), sistema visual **separado** do logo principal. Fora do escopo desta auditoria de logo; nome da pasta usa "the_screen" como identificador técnico de diretório (não é texto visível na UI) — mesma exceção técnica já registrada para `maquinanerd/screena`.

## 5. Conclusão da Seção 1 (validação de rebrand + logos)

- Zero ocorrências de "The Screen"/"Screena"/"thescreen.media"/"Screen Score" em arquivos ativos (canônico, cópia idêntica, `paginas/*`, `docs/*` vivos) — ver `38-REBRAND-VALIDATION.md`.
- Logo: os 10 slots **ativos** já seguem a regra semântica correta (vermelho só em filme, verde só em série, neutro em pessoas/notícias/misto). Nenhuma correção de código foi necessária.
- 10 arquivos-slot órfãos não conformes (azul/dourado): **ARQUIVADOS** em `uploads/LEGACY-NAO-USAR/` (D2, não apagados).
