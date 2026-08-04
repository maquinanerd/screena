# 38 — Rebrand Validation

Varredura de texto (`the screen|screena|thescreen|screen score`, case-insensitive) em **todo o projeto**, após a correção desta sessão.

## Gaps encontrados NESTA passada e corrigidos

| Arquivo/grupo | Problema | Correção |
|---|---|---|
| `paginas/01–18*.html` (exceto `00`) | 8 arquivos (`05-article`, `06-movie-detail`, `07-series-detail`, `10-browse`, `13-settings`, `14-data`, `15-listas`, `18-ad-tela`) ainda traziam "The Screen"/"Screen Score"/`thescreen.media` — são excertos estáticos, não recarregam de `_logica-component.js`/`_compartilhado-chrome.html` | Reaplicado o mesmo rebrand textual diretamente nesses 8 arquivos |
| `Screen-Design-Canonical/` (pacote espelho completo) | Pasta duplicada com sua própria cópia de `docs/`, `paginas/`, `uploads/`, canônico e manifesto — estava **inteiramente desatualizada** (pré-rebrand) | Ressincronizada por cópia integral a partir da raiz corrigida (`docs/`, `paginas/`, `uploads/`, `Screen Screens v4.dc.html`, `MANIFESTO-CANONICO.json`, `00-LEIA-PRIMEIRO.md`) |

## Estado atual (limpo)

Zero ocorrências em:
- `Screen Screens v4.dc.html` (canônico)
- `paginas/00-principal-completo.html` (cópia idêntica) e `paginas/01–18*.html`/`*.md`
- `paginas/_logica-component.js`, `paginas/_compartilhado-chrome.html`
- `docs/*.md` vivos (contratos e inventários)
- `Screen-Design-Canonical/` (pacote espelho, agora ressincronizado)
- `CLAUDE.md`, `MANIFESTO-CANONICO.json`, `00-LEIA-PRIMEIRO.md`

## Ocorrências remanescentes — todas em local explicitamente LEGADO (corretas, não alteradas)

| Local | Por quê está correto preservar |
|---|---|
| `design_handoff_the_screen/` (README.md, CLAUDE.md) | Pasta marcada `⚠️ DIRETÓRIO LEGADO — NÃO USAR`; documenta o estado antigo por design |
| `screen-v4-design-handoff/source/LEGACY__Screen-Screens-v4__273832-bytes.dc.html` | Prefixo `LEGACY__` explícito; versão anterior preservada como registro histórico |
| `RELATORIO_The_Screen.md` | Listado como arquivo legado em `ARQUIVOS-LEGADOS-E-HISTORICOS.md`; relatório de fase anterior |
| `PROMPT-CLAUDE-CODE-CHANGELOG.md` (linha 15) | **Exceção técnica documentada**: `maquinanerd/screena` e `@screena/*` são identificadores de repositório/pacote, não uso público da marca — o próprio changelog já registra que não devem ser renomeados |

## Cinerie Score — verificação de uso (não é só troca de texto)

`"Screen Score"` → `"Cinerie Score"` foi trocado em 2 pontos: `paginas/06-movie-detail.html` (nota 8.2) e `paginas/07-series-detail.html` (nota 8.6). Ambos os casos usam **dado mock do protótipo** (nota fixa exibida sempre) — não há estado condicional de "sem nota"/"sem autorização" implementado no protótipo atual. **Isto é uma dívida a registrar, não uma correção a fazer aqui**: no build real, o componente `RatingSource`/Cinerie Score precisa de um estado vazio explícito (omitir ou "sem nota ainda") em vez de sempre mostrar um número — ver `26-DIVERGENCES-AND-OPEN-DECISIONS.md` (pendente).

## Conclusão

Rebrand textual: **validado e completo** em todos os arquivos ativos do projeto, incluindo o gap real encontrado nesta passada (excertos estáticos de `paginas/` e o pacote espelho `Screen-Design-Canonical/`). Nenhuma marca antiga aparece em superfície implementável.
