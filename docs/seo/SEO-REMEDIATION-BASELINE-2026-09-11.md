# Baseline da remediação de SEO — 11/09/2026

> **Para que serve.** Registrar o estado do repositório **antes** da primeira
> mudança da remediação, para que nenhuma falha pré-existente seja atribuída ao
> que vier depois — e para que nenhuma regressão nova se esconda atrás de uma
> falha antiga.
>
> Auditoria de referência: [`AUDITORIA-SEO-2026-09-11.md`](AUDITORIA-SEO-2026-09-11.md).
> Decisões que destravaram a remediação: [`DECISOES-DO-DONO-2026-09-11.md`](DECISOES-DO-DONO-2026-09-11.md).

---

## 1. Ponto de partida

| Item | Valor |
|---|---|
| Branch | `fix/seo-audit-2026-09-11` |
| Base | `main` em `e302161` — já com a #277 (marcas por área) e a #278 (auditoria) mescladas |
| `main` andou depois da base? | Não (conferido de novo em 14/09/2026 com `git log e302161..origin/main`: vazio) |
| Onde os comandos rodaram | Cópia de trabalho em `C:` — o worktree em `E:` é inviável para `pnpm install` (~220 ms por arquivo) |
| Node / pnpm | Node **24.19.0** (o repositório declara `>=22 <23`) · pnpm 9.15.4 |

**Consequência do Node 24, registrada antes de virar surpresa:** Vitest e build
funcionam; **Playwright não**. Isso afeta o Gate 24 (regressão de desempenho),
que precisa de outro caminho de medição ou de Node 22.

---

## 2. Resultado

| Etapa | Saída | Leitura |
|---|---|---|
| `pnpm typecheck` | **0** | limpo |
| `pnpm typecheck:apps` | **0** | limpo |
| `pnpm lint` | **1** | **uma** ocorrência — ver 2.1 |
| `pnpm test` | **0** | **577 arquivos de teste, todos passando** (119,97 s) |
| `pnpm --filter @screena/web build` | **0** | build de produção completo |

### 2.1 A falha de lint não é do repositório

```text
apps/web/scripts/qa-logos-scratch.ts
  14:56  error  'writeFileSync' is defined but never used
```

`qa-logos-scratch.ts` é um arquivo de **scratch da leva anterior** (verificação
visual das marcas), que existia só na cópia de `C:` e **nunca foi versionado**.
O CI da `main` passa no lint. A sincronização corrigida (2.2) o removeu da cópia.

**Falhas pré-existentes no repositório: nenhuma.**

### 2.2 Ressalva honesta sobre a sincronização

A primeira sincronização `E:` → `C:` **falhou** com `robocopy rc=16` e não copiou
nada: o Git Bash converte argumento iniciado em `/` para caminho do Windows, e
`/MIR` chegava ao robocopy como `C:/Program Files/Git/MIR`. Corrigido com
`MSYS_NO_PATHCONV=1`.

Portanto, o baseline acima rodou sobre a cópia de `C:` **como ela estava ao fim da
leva das marcas** — conteúdo equivalente ao que a #277 mesclou na `main`, mais o
arquivo de scratch. **Nenhuma alteração desta remediação estava presente**, que é
exatamente a propriedade que um baseline precisa ter.

---

## 3. Baseline de desempenho

Não houve medição nova neste ponto. A referência é a da própria auditoria —
laboratório (Chrome 152 headless via DevTools Protocol, 3 execuções, mediana),
em produção, **não** PageSpeed:

| Página | LCP mobile | LCP desktop | CLS | Peso mobile |
|---|---|---|---|---|
| home | 3.228 ms | 1.872 ms | 0,005 | 1.377 KB |
| filme | **5.084 ms** | 1.476 ms | 0 | 1.521 KB |
| série | 3.628 ms | 1.220 ms | 0 | 322 KB |
| notícia | 2.668 ms | 732 ms | **0,088** (desktop) | 367 KB |

E os dois números estruturais que a remediação precisa mudar:

- ficha de filme a 412 px: `document.scrollWidth` = **1.816 px**;
- fotos de elenco: **951 KB** em `tmdbSize: "original"` para quadrados de 64 px.

---

## 4. O que já estava certo e não pode regredir

Levantado pela auditoria e conferido nos mapas de código desta remediação:

- HTTPS, HSTS de 2 anos com `preload`, normalização de barra final;
- HTML do Googlebot idêntico ao do navegador; conteúdo principal no SSR;
- 1 H1 por página; nenhuma `<img>` sem `alt`;
- temporada e episódio `noindex, follow` **e** fora do sitemap;
- `/en/` e `/es/` em 404, sem `hreflang` apontando para eles;
- **zero `AggregateRating`** — travado por **dez** asserções em sete arquivos de
  teste; o Cinerie Score não vira nota de terceiro;
- `?utm_source` canonicaliza para a URL limpa;
- `robots.txt` do app emite **um único** grupo `User-agent: *` (os dois grupos
  vistos ao vivo vêm do bloco gerenciado da Cloudflare, não do código).
