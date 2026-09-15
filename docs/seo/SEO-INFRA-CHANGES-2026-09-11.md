# Mudanças de infraestrutura — remediação de SEO de 11/09/2026

> **O que este documento é.** A lista do que o código **não** resolve sozinho. Cada
> item diz o que muda, onde, por quê (com a referência da auditoria ou da decisão
> do dono), como aplicar, como conferir e quem decide.
>
> **Nada aqui foi aplicado em produção por esta remediação.** O repositório não
> alcança a borda (Cloudflare), o painel de deploy nem as caixas de e-mail — e
> mudar a borda é decisão de quem opera o site.
>
> Auditoria: [`AUDITORIA-SEO-2026-09-11.md`](AUDITORIA-SEO-2026-09-11.md) ·
> Decisões do dono: [`DECISOES-DO-DONO-2026-09-11.md`](DECISOES-DO-DONO-2026-09-11.md) ·
> Resolução item a item: [`AUDITORIA-SEO-2026-09-11-RESOLVIDA.md`](AUDITORIA-SEO-2026-09-11-RESOLVIDA.md)

---

## Resumo

| # | O quê | Onde muda | Quem decide | Estado |
|---|---|---|---|---|
| I1 | `www.cinerie.com` → apex com **301** | Cloudflare — Redirect Rule | dono (decidido: 301) | aplicar |
| I2 | Cache de borda dos sitemaps | Cloudflare — Cache Rule | operação | aplicar; a origem já manda `Cache-Control` |
| I3 | Dois grupos `User-agent: *` no `robots.txt` | Cloudflare — robots.txt gerenciado | dono (D7) | decidir entre as opções |
| I4 | Cache de borda da home e das fichas de série | deploy / Cloudflare | dono | fora desta leva |
| I5 | Caixas `contato@cinerie.com` e `privacidade@cinerie.com` | e-mail do domínio | controlador | criar |
| I6 | Conferências depois do deploy | produção + Search Console | operação | fazer após o merge |
| I7 | HSTS também nos redirects (308 de barra final) | Cloudflare — Edge Certificates | operação | aplicar |

**Nenhuma variável de ambiente nova** entra com esta remediação, e o `Dockerfile`
não muda. `CINERIE_LAB_HOLD_SECONDS` existe só no validador local
(`validate:route-cache`).

---

## I1 · `www` → apex com 301

**Por quê.** Auditoria M1: `www.cinerie.com` serve o site inteiro com **200**. A
canonical mitiga, não resolve. Decisão do dono: **301** para o apex, preservando
*path* e *query string*.

**Por que na borda, e não no `middleware.ts`.** A própria auditoria aponta a borda.
Três motivos práticos: (1) o redirect na Cloudflare não chega à origem; (2) o
middleware só enxerga o *host* que a cadeia de proxy (Cloudflare → EasyPanel)
repassa, e isso não é verificável daqui; (3) o *matcher* do middleware exclui de
propósito `/_next/static`, `/media`, `/brand` e `/uploads` — uma regra de borda
cobre esses caminhos também.

**Como aplicar** (Cloudflare → Rules → Redirect Rules → *Single Redirect*):

| Campo | Valor |
|---|---|
| Quando | `http.host eq "www.cinerie.com"` |
| URL de destino | dinâmica: `concat("https://cinerie.com", http.request.uri.path)` |
| Status | **301** |
| Preservar *query string* | **ligado** |

O registro DNS de `www` precisa continuar *proxied*; sem isso a regra não roda.

**Como conferir:**

```bash
curl -sI "https://www.cinerie.com/pt/filmes/?utm_source=teste"
```

Esperado: `HTTP/2 301` e `location: https://cinerie.com/pt/filmes/?utm_source=teste`.

---

## I2 · Cache de borda dos sitemaps

**Por quê.** Auditoria M2: índice em 11,8–13,9 s, shards de 13 a 20 s, sem
`Cache-Control` e com `cf-cache-status: DYNAMIC`.

**O que a origem já faz** (commit `47a3b23`, `apps/web/src/lib/sitemap-cache-control.ts`):

| Rota | `Cache-Control` |
|---|---|
| `/sitemap.xml`, `/sitemaps/*` | `public, max-age=0, s-maxage=900, stale-while-revalidate=3600` |
| `/news-sitemap.xml` | `public, max-age=0, s-maxage=300, stale-while-revalidate=600` (janela de 48 h do Google News) |
| qualquer um, em falha de banco | `no-store` — resposta degradada não pode ser guardada |

**O que falta na borda.** A Cloudflare não guarda XML por padrão — a medição da
auditoria (`DYNAMIC`) é consistente com isso. É preciso marcar essas rotas como
elegíveis a cache e **respeitar o `Cache-Control` da origem**.

**Como aplicar** (Cloudflare → Caching → Cache Rules):

| Campo | Valor |
|---|---|
| Quando | `(http.request.uri.path eq "/sitemap.xml") or starts_with(http.request.uri.path, "/sitemaps/") or (http.request.uri.path eq "/news-sitemap.xml")` |
| Cache eligibility | *Eligible for cache* |
| Edge TTL | *Use cache-control header if present* |
| Browser TTL | *Respect origin* |

Sem risco de dado pessoal: sitemap não varia por sessão, e a resposta degradada sai
com `no-store`.

**Como conferir:** duas leituras seguidas de `/sitemap.xml`; a segunda deve vir
com `cf-cache-status: HIT` e `age` maior que zero.

---

## I3 · Dois grupos `User-agent: *` no `robots.txt`

**O fato.** O app emite **um** grupo `User-agent: *` (baseline, §4; a checagem
`robots-grupo-duplicado` do `seo:audit` mede isso). O segundo grupo é o do bloco
**gerenciado da Cloudflare**, que se antepõe ao arquivo da origem com o
`Content-Signal` e os `Disallow` dos crawlers de treino.

**A decisão que vale (D7).** A política **fica**: busca e resposta ao vivo
liberadas; treino bloqueado; `Content-Signal` mantido. A duplicidade é defeito
técnico, e simplificar o lado do app **não** pode remover as regras da borda.

**As opções.**

- **(a) Manter como está.** Google e Bing unem os grupos do mesmo *user-agent*
  (RFC 9309, §2.2.1). O efeito real se limita a parser que lê só o primeiro grupo:
  ele deixa de ver os `Disallow` do app, que cobrem só `/api/`, `/dev/` e `/admin/`
  — áreas técnicas, sem página indexável.
- **(b) Uma fonte só, no app.** Desligar o robots.txt gerenciado e o app passar a
  emitir a política inteira (crawlers de treino + `Content-Signal`). Exige: copiar
  **o texto exato servido hoje** pela Cloudflare, versioná-lo, trocar o
  `app/robots.ts` (o `MetadataRoute.Robots` do Next não emite `Content-Signal`)
  e desligar o bloco gerenciado **no mesmo deploy**.

**Por que (b) não foi feito nesta leva.** O texto do bloco gerenciado não está no
repositório, e esta remediação não alcança a produção para copiá-lo. Reescrevê-lo
de memória seria inventar a declaração de sinalização de conteúdo da empresa.

**Recomendação.** (a) até o dono querer (b). Em (b), conferir depois do deploy que
sobra **um** grupo por *user-agent* e que os crawlers de treino continuam com
`Disallow: /`.

---

## I4 · Cache de borda da home e das fichas de série

**Por quê.** Auditoria §7.4: home `DYNAMIC` (5/5), ficha de série `BYPASS` (10/10).

**Continua como estava, e o motivo está escrito no código.** A home e as
listagens são dinâmicas porque o build do release não alcança o banco; a ficha de
série, porque lê `?temporada=`. O runbook
[`route-cache-and-isr-disk.md`](../operations/route-cache-and-isr-disk.md) tem as
medições e o que precisaria mudar no deploy.

**O que esta remediação acrescentou à lista de rotas dinâmicas, e por quê:**

| Rotas | Motivo |
|---|---|
| `/pt/termos/`, `/pt/privacidade/`, `/pt/creditos-de-dados/` | motivo (d): o `<meta robots>` lê a chave de indexação de RUNTIME. Prerenderizadas, gravavam o `noindex, nofollow` do build (medido em 15/09/2026) |
| `/pt/sobre/`, `/pt/politica-editorial/`, `/pt/contato/`, `/pt/cinerie-score/` | o mesmo motivo (d) |
| `/pt/autores/`, `/pt/autores/{slug}/` | motivo (b): despublicação de emergência — a mesma regra de `/pt/noticias/**` |

Nenhuma delas lê o banco além das páginas de autor, e o custo de renderizar por
requisição é baixo. **Não cachear `/pt/noticias/**` nem `/pt/autores/**` na borda**:
a despublicação de emergência depende de leitura por requisição.

---

## I5 · Caixas de e-mail

**O fato.** `contato@cinerie.com` e `privacidade@cinerie.com` são os canais que o
controlador publicou nos Termos de Uso (item 12) e na Política de Privacidade
(item 1). O cabeçalho de `app/pt/privacidade/page.tsx` registra que as caixas
**ainda não existiam** quando o texto foi escrito.

**O que esta remediação fez com isso.** As páginas `/pt/contato/` e
`/pt/politica-editorial/`, e o `ContactPage` do JSON-LD, mostram esses dois
endereços — os únicos publicados. Nenhum telefone, endereço de rua ou canal novo
foi criado, e um teste (`tests/web/institutional-pages-facts.test.ts`) reprova se
uma página institucional escrever canal que não conste dos documentos legais.

**O que falta.** Criar as duas caixas (ou aliases) e **provar que recebem**:
enviar uma mensagem de fora para cada uma e ver chegar. Até lá, o canal publicado
não responde.

---

## I6 · Conferências depois do deploy

1. **Robots dos documentos legais** (commit `a5867e8`). Com
   `CINERIE_PUBLIC_INDEXING_ENABLED` ligado:

   ```bash
   curl -s https://cinerie.com/pt/creditos-de-dados/ | grep -o '<meta name="robots"[^>]*>'
   ```

   Esperado: `index, follow, max-image-preview:large`. Antes do deploy, o esperado
   (INFERIDO do `Dockerfile`, que constrói sem env) é `noindex, nofollow`.

2. **Páginas novas respondendo 200, indexáveis e no shard estático:**
   `/pt/sobre/`, `/pt/politica-editorial/`, `/pt/contato/`, `/pt/cinerie-score/`,
   `/pt/autores/` e a página de cada autor (o slug sai do nome da assinatura).

3. **Auditoria por fora, contra produção:**

   ```bash
   pnpm --filter @screena/web seo:audit
   ```

   Esperado: `0 violações`.

4. **Search Console.** Reenviar `sitemap.xml` e `news-sitemap.xml`; inspecionar as
   URLs das páginas institucionais; acompanhar o relatório **Páginas** pelas
   semanas seguintes. As decisões D1 (69.016 galerias), D2 (pessoas) e D3 (~11.666
   fichas `tmdb-{id}`) tiram URLs do índice **de propósito** — "Excluída pela tag
   noindex" subir é o efeito esperado, não regressão.

5. **Dados estruturados.** Rich Results Test em uma matéria (`NewsArticle` com
   `author.url`), numa página de autor (`ProfilePage`) e em `/pt/contato/`
   (`ContactPage`). A elegibilidade a *rich result* é INFERIDA da documentação do
   Google; nada disso foi testado na ferramenta.

6. **Desempenho de campo.** A PageSpeed Insights sem chave responde cota **zero**;
   o `perf:lab` desta leva mede causas estruturais em laboratório local. O número
   de campo vem do relatório **Core Web Vitals** do Search Console, quando houver
   volume.

---

## I7 · HSTS também nos redirects

**Por quê.** Achados baixos da auditoria: o **308 de barra final** sai **sem HSTS**,
enquanto as páginas saem com HSTS de 2 anos, `includeSubDomains; preload`.

**De onde vem o HSTS hoje.** Não do app: nenhum arquivo de `apps/web`
(`next.config.ts`, `middleware.ts`, `src/`) escreve `Strict-Transport-Security`
(LI, 15/09/2026). E o 308 de barra final é emitido pelo roteamento do Next antes
do middleware — cabeçalho de página não o alcança.

**Como aplicar.** Ligar o HSTS **na borda** (Cloudflare → SSL/TLS → Edge
Certificates → HSTS), com os mesmos valores que as páginas já anunciam
(`max-age` de 2 anos, `includeSubDomains`, `preload`). Na borda ele vale para toda
resposta HTTPS *proxied*, redirects inclusive.

**Como conferir:**

```bash
curl -sI "https://cinerie.com/pt/filmes" | grep -i -E "^(HTTP|location|strict-transport-security)"
```

Esperado: `308`, `location` com a barra final e `strict-transport-security`
presente.
