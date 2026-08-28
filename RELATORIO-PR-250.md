# Relatório da PR #250 — o 500 de toda ficha de série

> **Uma linha:** o Next classificava `/pt/series/[slug]` como estática por causa do
> `generateStaticParams` que a #245 adicionou, mas essa rota lê `searchParams` — e ler a
> query numa rota estática, em runtime, é um erro do qual o Next não consegue se recuperar.
> Toda ficha de série respondia 500.

| | |
|---|---|
| **Data** | 2026-08-28 |
| **PR** | [#250](https://github.com/maquinanerd/screena/pull/250) |
| **Branch** | `claude/serie-500-error-b67ebe` |
| **Base** | `main` @ `8f97770` |
| **Commit** | `fa7d30c` |
| **Arquivos** | 3 (109 inserções, 25 remoções) |
| **Código funcional alterado** | **5 linhas** — o resto é comentário e teste |
| **Regressão de** | [#245](https://github.com/maquinanerd/screena/pull/245) (`3f6acd3`) |

---

## 1. O enunciado

O dono abriu a tarefa com o site parcialmente fora e uma medição já feita no navegador contra
produção, com cache furado:

| rota | HTTP | Cloudflare |
|---|---|---|
| `/pt/series/ted-lasso/` | **500** | BYPASS |
| `/pt/series/materia-escura/` | **500** | BYPASS |
| `/pt/series/reacher/` | **500** | BYPASS |
| `/pt/series/breaking-bad/` | **500** | BYPASS |
| `/pt/filmes/habitar-el-cine-desde-adentro/` | 200 | MISS |
| `/pt/filmes/el-esquilador/` | 200 | MISS |
| `/pt/filmes/ghazal-e-sorkh/` | 200 | MISS |
| `/pt/series/ted-lasso/imagens` | 200 | MISS |
| `/pt/series/ted-lasso/temporadas/1/` | 200 | MISS |
| `/pt/series` (listagem) | 200 | DYNAMIC |
| `/pt/` | 200 | DYNAMIC |

E com a leitura certa já embutida: **"É algo que a ficha de série faz e que a ficha de filme e
as sub-páginas dela não fazem."** O enunciado também avisava para não tratar "foi a #245" como
conclusão — a ficha de filme recebeu o mesmo tratamento e estava de pé.

O corpo do 500 era a página de erro genérica do Next, **sem digest visível**.

---

## 2. O que eu fiz, em ordem

### 2.1 Achei a assimetria antes de formular hipótese

Varri as 32 `page.tsx` do app cruzando duas colunas: quem declara `generateStaticParams` e quem
recebe `searchParams`.

| rota | `generateStaticParams` | `searchParams` | produção |
|---|:---:|:---:|:---:|
| `/pt/filmes/[slug]` | ✅ | — | 200 |
| `/pt/filmes/[slug]/imagens` | ✅ | — | 200 |
| `/pt/filmes/[slug]/videos` | ✅ | — | 200 |
| `/pt/pessoas/[slug]` | ✅ | — | 200 |
| `/pt/series/[slug]/imagens` | ✅ | — | 200 |
| `/pt/series/[slug]/videos` | ✅ | — | 200 |
| `/pt/series/[slug]/temporadas/[season]` | ✅ | — | 200 |
| `/pt/series/[slug]/temporadas/[season]/episodios/[episode]` | ✅ | — | 200 |
| `…/episodios/[episode]/imagens` | ✅ | — | 200 |
| **`/pt/series/[slug]`** | ✅ | ✅ | **500** |
| `/pt/explorar` | — | ✅ (com `force-dynamic`) | 200 |

**Uma única rota no app inteiro tem as duas coisas.** É a que caiu. A tabela de produção e a
tabela do código são a mesma tabela.

`apps/web/app/pt/series/[slug]/page.tsx:241`:

```ts
const [{ slug }, query] = await Promise.all([params, searchParams])
```

`searchParams` é aguardado na **primeira instrução** do componente, antes de qualquer consulta
ao banco.

### 2.2 O que a #245 fez, exatamente

`git show 3f6acd3` nas duas fichas: ela adicionou `generateStaticParams` a **ambas** e **não
tocou** em `searchParams` de nenhuma. A ficha de filme nunca leu query. A ficha de série já lia
`?temporada=` antes da #245 — o que a #245 fez foi colocar a metade que faltava para a
combinação virar letal.

### 2.3 O rastro

O log do container exigia a senha do painel do EasyPanel. **Não digitei senha em formulário** —
é regra minha e, pelo registro de sessões anteriores, o caminho do painel depende do operador de
qualquer forma. O enunciado previa isso no passo 1.3: reproduzir localmente.

Montei um app Next **15.5.19** mínimo e isolado (a mesma versão instalada), com quatro rotas que
separam as variáveis:

| forma | o que declara | corresponde a | resultado |
|---|---|---|:---:|
| **A** | `generateStaticParams` + `searchParams` | ficha de série **depois** da #245 | **500** |
| **B** | só `generateStaticParams` | ficha de filme depois da #245 | 200 |
| **C** | só `searchParams` | ficha de série **antes** da #245 | 200 |
| **D** | igual a A, capturando o erro | — | 500 (e revela a mensagem) |

A tabela do `next build` do app mínimo já mostrava o problema:

```
├ ● /a/[slug]      ← SSG, apesar de ler searchParams
├ ● /b/[slug]
└ ƒ /c/[slug]      ← Dynamic
```

O log do servidor de A, em build de produção:

```
[Error: An error occurred in the Server Components render. The specific message is
omitted in production builds to avoid leaking sensitive details. A digest property
is included on this error instance which may provide additional details about the
nature of the error.] {
  digest: 'DYNAMIC_SERVER_USAGE'
}
```

**É por isso que a página de erro em produção não mostrava digest legível** — o Next suprime a
mensagem em build de produção. A rota D capturou o texto suprimido:

```
Dynamic server usage: Route /d/[slug] couldn't be rendered statically because it used
`await searchParams`, `searchParams.then`, or similar.
See more info here: https://nextjs.org/docs/messages/dynamic-server-error
```

E o erro externo, que é o que devolve o 500 e não dá para capturar de dentro da página:

```
Error: Page changed from static to dynamic at runtime /d/ted-lasso,
reason: `await searchParams`, `searchParams.then`, or similar
see more here https://nextjs.org/docs/messages/app-static-to-dynamic-error
```

### 2.4 O mecanismo, escrito por extenso

1. `generateStaticParams` existe → o Next marca a rota como elegível a prerender e ela entra em
   `dynamicRoutes` do `prerender-manifest.json`. A tabela do build imprime `●` (SSG).
2. Ela devolve `[]` **de propósito** (são ~67 mil URLs e o banco não está disponível no build).
   Como nada é renderizado no build, **o Next nunca descobre que a página lê a query**.
3. Na primeira visita em produção, o Next tenta gerar o HTML estático daquela URL para guardar.
4. A página aguarda `searchParams`. Isso é uso dinâmico → `DYNAMIC_SERVER_USAGE`.
5. **No build**, esse erro faria o Next apenas rebaixar a rota para dinâmica. **Em runtime ele
   não pode mais reclassificar** — a rota já está no manifesto como estática. Ele lança
   *"Page changed from static to dynamic at runtime"* e devolve **500**.

Passo 5 é a diferença inteira entre "o build teria avisado" e "o build passou e o site caiu".

### 2.5 O 500 é só o sintoma

Mesmo que o Next tolerasse, a classificação estaria errada por um segundo motivo, independente:

**Cache de rota é por _pathname_.** `?temporada=2` e `?temporada=5` compartilhariam o mesmo HTML
guardado. Uma rota cujo conteúdo depende da query **não pode** ser cacheada por rota. O
`generateStaticParams` nunca foi seguro aqui — o 500 só tornou isso visível rápido.

### 2.6 É código ou dado?

**Código.** Quebra em toda série, com ou sem `?temporada=` na URL, porque o `searchParams` é
aguardado incondicionalmente antes de qualquer leitura do banco. Não há registro específico
envolvido, e nenhuma escrita das levas paralelas (PROMPT 5 / PROMPT 6) tem relação — não
encontrei evidência de escrita delas em produção.

---

## 3. A correção

### 3.1 O que mudou

**`apps/web/app/pt/series/[slug]/page.tsx`** — todo o código funcional alterado na rota:

```diff
-export const revalidate = 3600
-export async function generateStaticParams(): Promise<Record<string, string>[]> {
-  return []
-}
+export const dynamic = 'force-dynamic'
```

`force-dynamic` é **a mesma declaração que `/pt/explorar/` já usa, pelo mesmo motivo**: a
resposta depende da query. Ela torna a leitura legal e impede qualquer reclassificação futura.

O `revalidate` saiu junto porque, sem `generateStaticParams`, **ele já era inerte** — esse é o
achado central da própria #245. Deixá-lo ali só convidaria alguém a "consertar o cache"
readicionando a função que derrubou o site.

**`apps/web/src/lib/route-cache-policy.ts`** — a rota passa de `public-static` para
`public-dynamic`, com a razão registrada.

**`apps/web/scripts/validate-route-cache-real-postgres.ts`** — a prova (seção 4).

### 3.2 Por que não removi o `?temporada=` em vez do `generateStaticParams`

Era a alternativa: manter o cache e tirar a query. Rejeitada, porque `?temporada=` **está vivo**
— e não é decorativo:

```ts
const seasonHref = seasonPath(data.canonicalSlug, season.seasonNumber)
                   ?? `?temporada=${season.seasonNumber}#episodios`
```

`seasonPath` (`apps/web/src/lib/routes.ts:96`) devolve `null` quando `seasonNumber < 1` — ou
seja, **para a temporada 0, "Especiais"**. O `?temporada=` é hoje o **único** caminho até ela: o
comentário da própria rota diz que Especiais "só aparece quando pedida explicitamente".

Tirar `searchParams` mataria a aba Especiais em silêncio. Numa emergência, não troco um 500 por
uma regressão silenciosa.

### 3.3 O que **não** mudou

As **outras 9 fichas** ficam exatamente como a #245 as deixou. O ganho continua de pé — provas 6
e 7 do validador seguem verdes:

```
[PASS]  6. ficha de filme e CACHEAVEL — cache-control=s-maxage=3600, stale-while-revalidate=31532400
[PASS]  7. a SEGUNDA leitura da ficha vem do cache — x-nextjs-cache=HIT  1a=125ms  2a=52ms
```

Tabela do build, antes e depois, lado a lado:

| rota | antes (quebrado) | depois (corrigido) |
|---|:---:|:---:|
| `/pt/filmes/[slug]` | ● SSG | ● SSG |
| `/pt/series/[slug]/imagens` | ● SSG | ● SSG |
| `/pt/series/[slug]/temporadas/[season]` | ● SSG | ● SSG |
| **`/pt/series/[slug]`** | **● SSG** | **ƒ Dynamic** |

**Uma linha da tabela mudou.**

### 3.4 Isto é paliativo?

**Não.** É o estado correto para uma rota cujo conteúdo depende da query — pelas duas razões da
seção 2.5. O que fica pendente é uma melhoria (seção 7), não um conserto adiado.

---

## 4. A prova

### 4.1 O guard que já existia acusou sozinho

`tests/web/route-cache-policy.test.ts` reprovou na primeira rodada:

```
- Array []
+ Array [
+   "/pt/series/[slug]: registro diz public-static, build diz dinamica",
+ ]
```

Esse teste **não faz `grep` no fonte** — ele lê `.next/prerender-manifest.json`, a decisão do
próprio Next. Ele funcionou exatamente como projetado: registro e realidade divergiram, e ele
travou. A correção do registro faz parte desta PR.

### 4.2 O teste que renderiza a rota de verdade

`validate-route-cache-real-postgres.ts` **já** subia Next real sobre o build, com PostgreSQL 16
efêmero, semeando 6.000 filmes / 3.000 séries / 3.000 pessoas. E passava 14/14.

**Ele nunca pedia uma série.** As provas 6 e 7 pediam `/pt/filmes/filme-1/` e concluíam sobre "a
ficha" a partir de uma das dez.

Acrescentei quatro provas que **pedem a URL por HTTP e conferem o corpo** — status 200 **e**
título da entidade presente **e** corpo não é a página de erro do Next — mais um controle:

```
[PASS] 15. ficha de filme RENDERIZA — status=200 titulo "Titulo filme 1" presente
[PASS] 16. ficha de serie RENDERIZA — status=200 titulo "Titulo serie 1" presente
[PASS] 17. ficha de serie COM ?temporada= (a forma que caiu em producao) — status=200 titulo presente
[PASS] 18. ficha de pessoa RENDERIZA — status=200 titulo "Titulo pessoa 1" presente
[PASS] 19. CONTROLE: o criterio acima REPROVA uma ficha inexistente (404, sem titulo)
=== 19/19 PASS ===
```

A prova 19 existe porque um `includes` que casasse com qualquer coisa faria as quatro anteriores
passarem sem medir nada.

### 4.3 Controle negativo — executado, não descrito

Repus o `generateStaticParams` no espelho de build, **rebuild completo**, rodei de novo:

```
Tabela do build:  ● /pt/series/[slug]        ← voltou a SSG

[PASS] 15. ficha de filme RENDERIZA — status=200 titulo "Titulo filme 1" presente
[FAIL] 16. ficha de serie RENDERIZA — status=500 titulo "Titulo serie 1" AUSENTE
[FAIL] 17. ficha de serie COM ?temporada= — status=500 titulo "Titulo serie 1" AUSENTE
[PASS] 18. ficha de pessoa RENDERIZA — status=200 titulo "Titulo pessoa 1" presente
=== 17/19 PASS ===
```

Vermelho nas duas provas certas, com o **mesmo status 500 de produção**, e verde em filme e
pessoa. **O teste discrimina** — não é decorativo. Depois restaurei a correção e reconfirmei
19/19.

### 4.4 Por que os testes existentes não pegaram

Havia teste da ficha de série. Ele passava — e passa **28/28 com o defeito de pé**.

| harness | o que faz | por que não viu |
|---|---|---|
| `validate:series-page` | slug → `tv_show` → presenter → indexabilidade | diz no próprio cabeçalho: **"Nao sobe Next"** |
| `validate:decision-robots` | importa a rota, chama `generateMetadata` | roda **fora** do Next |
| `qa-episode-season` | pede `/pt/series/{slug}/temporadas/2/` | pede a **sub-rota**, que funcionava |
| `validate:route-cache` | Next real + Postgres real | **nunca pedia uma série** |
| `typecheck` / `lint` / `build` | — | o build **classifica** a rota; ele não a renderiza (`[]`) |

**Nenhum teste do repositório jamais fez um `GET` de `/pt/series/{slug}/`.** Um defeito de
_classificação de rota_ do Next é invisível para tudo que não peça a URL do servidor de
produção. Essa era a lacuna, e é ela que a seção 4.2 fecha.

### 4.5 A ficha de filme tinha o mesmo risco latente?

**Não — e não por sorte de dado.** É estrutural:

- Só **duas** `page.tsx` do app leem `searchParams`: `/pt/explorar` (já `force-dynamic`) e esta.
- **Zero** ocorrências de `cookies()`, `headers()`, `draftMode()`, `connection()`,
  `unstable_noStore()` ou `fetch(…, { cache: 'no-store' })` em qualquer caminho de render de
  `apps/web` — nenhum outro gatilho de "dinâmico" existe no app público.

Ainda assim as provas cobrem **filme e pessoa** além de série, para que uma regressão futura em
qualquer uma delas fique vermelha.

---

## 5. Portões

Todos executados em espelho de build com `node_modules` real (o `pnpm install` direto na árvore
em `E:` é inviável — 220 ms por arquivo).

| portão | resultado |
|---|---|
| `pnpm typecheck` | **0** |
| `pnpm typecheck:web` | **0** |
| `pnpm lint` | **0** |
| `pnpm test` | **569/569 arquivos · 7399/7399 testes** |
| `pnpm audit:invariants` | **PASSOU** — 7 ok, 0 avisos, 0 violações |
| `pnpm audit:render` | **PASSOU** — 2 ok, 0 violações |
| `pnpm build` | **0** |
| `validate:route-cache` | **19/19** |
| `validate:all` | **161/161** em 7 validadores |
| `validate:decision-robots` | **23/23** |
| `validate:season-episode-routes` | **32/32** |

O total da suíte (569 / 7399) bate com o total conhecido do repositório — **não houve recorte**.

---

## 6. O que ainda tem que ser feito

### 6.1 Reimplantar — o site só volta com isso

**`autoDeploy` é `false`.** Merge não implanta. Depois de a #250 entrar na `main`, o serviço
`screen-app` precisa ser reimplantado no EasyPanel (`161.97.181.82:3000`, projeto `rss_prime`)
para o 500 sair do ar. **Enquanto isso não acontecer, toda ficha de série continua fora.**

### 6.2 Conferir por efeito, não por commit

Produção não sabe dizer qual commit está rodando. A verificação é pedir a URL:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://cinerie.com/pt/series/ted-lasso/?cb=$(date +%s)"
```

Esperado: **200**. Vale conferir também `materia-escura`, `reacher` e `breaking-bad`, e uma
com query: `/pt/series/ted-lasso/?temporada=1`.

Depois do deploy, o cabeçalho dessa rota volta a ser
`private, no-cache, no-store, max-age=0, must-revalidate` — **isso é o esperado agora**, é o
default do Next para render dinâmico, e é o que a rota teve nos 13 meses anteriores à #245.

### 6.3 Recuperar o cache da ficha de série (melhoria, não urgência)

Para essa rota voltar a ser cacheável sem quebrar, "Especiais" (temporada 0) precisa de **rota
própria**. Hoje `seasonPath` recusa `seasonNumber < 1` e o `?temporada=` é o único caminho até
ela. Sem query na rota, `generateStaticParams` volta a ser seguro.

Ordem sugerida: (1) permitir temporada 0 em `seasonPath` / rota de temporada; (2) trocar o
fallback `?temporada=` por link de rota; (3) remover a leitura de `searchParams`; (4) só então
devolver `generateStaticParams` e o registro para `public-static`. A prova 17 do validador
protege cada passo.

### 6.4 Nada além disso

Sinopse, biografia, slug, censo, sitemap e indexabilidade continuam com os PROMPT 5 e PROMPT 6.
Nada foi tocado neles. Nenhum `--apply` foi executado. Nenhuma escrita em produção. Nenhum
serviço parado ou reiniciado. Nenhuma alteração na Cache Rule da Cloudflare — ela estava
devolvendo `BYPASS` corretamente e **não cacheou o erro**.

---

## 7. A lição, em uma frase

> Um `generateStaticParams` que devolve `[]` promete ao Next que a rota é estática **sem lhe dar
> nada para verificar** — o build classifica, não renderiza, e a mentira só é descoberta na
> primeira visita de produção, quando já é tarde para reclassificar.

O corolário prático: **rota que lê query não pode declarar `generateStaticParams`** — nem que o
Next deixasse, porque cache de rota é por pathname. E o corolário de teste: **um harness que sobe
Next real e semeia 3.000 séries ainda vale zero para séries se nunca pedir uma.** Semear não é
medir; pedir a URL é.

---

## Apêndice A — o pedido original, na íntegra

> # EMERGÊNCIA — TODA PÁGINA DE SÉRIE ESTÁ EM 500
>
> **Pare tudo que estiver fazendo. Escopo desta tarefa: derrubar esse 500 e nada mais.**
>
> ## O QUE FOI MEDIDO AGORA (2026-08-28, navegador contra produção, cache furado)
>
> *(a tabela de medições está reproduzida na seção 1 deste relatório)*
>
> **A assinatura do defeito é essa:** quebra **só** a ficha de série. A ficha de filme renderiza
> na origem sem erro — testado com títulos obscuros e cache furado, então não é cache velho
> escondendo o problema. As sub-páginas da própria série (`/imagens`, `/temporadas/{n}/`)
> renderizam. A listagem renderiza.
>
> **É algo que a ficha de série faz e que a ficha de filme e as sub-páginas dela não fazem.**
>
> O corpo do 500 é a página de erro genérica do Next, **sem digest visível**. O rastro está no
> log do container.
>
> ## CONTEXTO DE MUDANÇA
>
> O último deploy do `screen-app` foi a **PR #245** (`3f6acd3`), que entre outras coisas:
> adicionou `generateStaticParams` a 10 rotas de ficha, incluindo `/pt/series/[slug]`; reescreveu
> `entity-indexes.ts`, `home-hero.ts` e `home-upcoming.ts`; tirou `searchParams` de rotas; mudou
> a autoridade da ordenação alfabética para a collation do PostgreSQL.
>
> **Mas atenção:** a ficha de filme recebeu o mesmo tratamento e **está funcionando**. Então "foi
> a #245" é hipótese, não conclusão. Pode ser dado escrito por worker, pode ser algo específico
> de série que só aparece com certos dados.
>
> Há duas outras levas em execução (**PROMPT 5** e **PROMPT 6**), ambas proibidas de escrever em
> produção. Se você encontrar evidência de escrita recente no banco vinda delas, isso é achado e
> entra no relatório.
>
> ## REGRAS FIXAS
>
> 1. Não abra tarefa, issue ou recomendação sobre rotação de credenciais.
> 2. NUNCA imprima valor de chave, token ou senha.
> 3. Não commite o `.env`.
> 4. Nenhum comando com dois hifens isolados como argumento próprio.
> 5. Nada destrutivo: `DROP`, `TRUNCATE`, `DELETE` em massa, destruir serviço, apagar backup,
>    apagar volume.
> 6. Não pare nem reinicie serviço.
>
> ## PASSO 1 — O RASTRO. NADA ANTES DISSO.
>
> **Não formule hipótese antes de ler o erro real.** Leia o log do container `screen-app` no
> EasyPanel e traga a exceção completa com stack, colada literal. Se o log não mostrar stack,
> reproduza localmente e diga o que fez.
>
> ## PASSO 2 — ISOLAR
>
> Reproduza contra PostgreSQL real. Qual bloco da página quebra? É toda série ou só algumas?
> É código ou dado?
>
> ## PASSO 3 — CONSERTAR
>
> A **menor** mudança que devolve a página. Nada de refatorar de carona. Se a causa for da #245,
> considere reverter só o pedaço culpado. Se o conserto rápido for reverter a rota de série para
> dinâmica, faça isso e diga que é paliativo.
>
> ## PASSO 4 — A PROVA
>
> Um teste que renderiza a rota real de série e reprova quando o defeito volta — não `grep`, não
> asserção sobre função interna. Controle negativo executado. Por que os testes existentes não
> pegaram? A ficha de filme tem o mesmo risco latente?
>
> ## PORTÕES
>
> `typecheck`, `lint`, suíte completa, `audit:invariants`, `audit:render`, `build`, e os
> validadores reais de PostgreSQL. Um PR só.
>
> ## O QUE NÃO FAZER
>
> Não conserte mais nada. Não mexa na Cache Rule da Cloudflare. Não mexa em sinopse, biografia,
> slug, censo, sitemap ou indexabilidade. Não rode `--apply` de nada. Não pare nem reinicie
> serviço.
>
> ## AO TERMINAR
>
> Diga em uma linha: **qual era o erro, qual linha causou, e o que mudou.**

---

## Apêndice B — a resposta de uma linha (pedida em "AO TERMINAR")

> O Next classificava `/pt/series/[slug]` como **SSG** por causa do `generateStaticParams` que a
> #245 adicionou, mas a linha 241 daquela rota faz `await Promise.all([params, searchParams])` —
> ler a query numa rota estática lança `DYNAMIC_SERVER_USAGE` / *"Page changed from static to
> dynamic at runtime"*, e no runtime (diferente do build) o Next não pode rebaixar a rota:
> devolve 500. Troquei `revalidate` + `generateStaticParams` por
> `export const dynamic = 'force-dynamic'`.

---

## Apêndice C — a sessão, na ordem em que aconteceu

| # | passo | resultado |
|---|---|---|
| 1 | Li a rota de série e a de filme lado a lado | achei `searchParams` só na de série |
| 2 | `git show 3f6acd3` nas duas fichas | a #245 adicionou `generateStaticParams` às duas e **não** tocou em `searchParams` de nenhuma |
| 3 | Varri as 32 `page.tsx` cruzando `generateStaticParams` × `searchParams` | **uma única** rota tem as duas — a que caiu |
| 4 | Tentei o log do container | bloqueado: exige senha em formulário, que não digito. Fui para o passo 1.3 do enunciado |
| 5 | Montei app Next 15.5.19 mínimo com as formas A/B/C/D | **A=500**, B=200, C=200 — a combinação é a causa |
| 6 | Li o log do app mínimo | `digest: 'DYNAMIC_SERVER_USAGE'`, mensagem suprimida em produção |
| 7 | Rota D capturando o erro | revelou o texto: *"couldn't be rendered statically because it used `await searchParams`"* e *"Page changed from static to dynamic at runtime"* |
| 8 | Verifiquei se `?temporada=` está vivo | está: é o **único** caminho até "Especiais" (`seasonPath` recusa temporada 0) → não removi `searchParams` |
| 9 | Apliquei a correção | `revalidate` + `generateStaticParams` → `force-dynamic` |
| 10 | `next build` no espelho | `ƒ /pt/series/[slug]`; as outras 9 fichas continuam `●` |
| 11 | Rodei `validate:route-cache` | 14/14 antigas + falhou nada — mas percebi que ele **nunca pedia uma série** |
| 12 | Acrescentei 4 provas por HTTP + 1 controle | **19/19 PASS** |
| 13 | **Controle negativo**: repus o defeito, rebuild, rerodei | **17/19** — provas 16 e 17 vermelhas com `status=500`; filme e pessoa verdes |
| 14 | Restaurei a correção, reconfirmei | 19/19 |
| 15 | Suíte completa | falhou 1: `route-cache-policy.test.ts` acusou registro × manifesto |
| 16 | Atualizei `route-cache-policy.ts` para `public-dynamic` | suíte **569/569 arquivos, 7399/7399 testes** |
| 17 | Portões restantes | typecheck 0, lint 0, audits PASSOU, build 0, `validate:all` 161/161, decision-robots 23/23, season-episode 32/32 |
| 18 | Commit `fa7d30c`, push, PR #250 | 3 arquivos, 5 linhas de código funcional |

### O que foi respeitado das regras fixas

- Nenhuma recomendação sobre rotação de credenciais.
- Nenhum valor de chave, token ou senha impresso — e nenhuma senha digitada em formulário.
- `.env` não commitado (não existe `.env` nesta árvore).
- Nenhum comando com dois hifens isolados.
- Nada destrutivo: nenhum `DROP`, `TRUNCATE` ou `DELETE`; nenhum serviço, backup ou volume tocado.
- Nenhum serviço parado ou reiniciado.
- Nenhum `--apply`. Nenhuma escrita em produção.
- Cloudflare intocada. PROMPT 5 e PROMPT 6 intocados.
- **Um PR só.**

### Sobre PROMPT 5 / PROMPT 6

O enunciado pedia para reportar evidência de escrita recente em produção vinda dessas levas.
**Não encontrei nenhuma** — e nem poderia procurar direito: o banco de produção só é alcançável
pelo console do painel, que depende do operador. O defeito, de todo modo, é de classificação de
rota e independe de dado, então não há hipótese em aberto ali.
