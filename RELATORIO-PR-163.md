# Relatório — PR #163 · Página de Filme e de Série no desenho canônico

**Branch:** `claude/movie-series-detail-pages-b54c3f` · **PR:** https://github.com/maquinanerd/screena/pull/163
**Data:** 2026-08-12 · **Commits:** 4 · **Árvore:** limpa

---

## Sumário em uma linha

Consertou uma mentira que estava no ar (Rotten Tomatoes como `80/100`), montou a
estrutura canônica das duas telas com **ausência honesta e registrada**, e
documentou 8 blocos que não renderizam com o motivo de cada um. Uma afirmação do
relatório inicial foi **refutada e corrigida** (ver §9).

---

## 1. Os quatro commits

| SHA | O quê |
| --- | --- |
| `f7f5dfe` | **T0** — sufixo da nota passa a ser da FONTE. RT vira `%`. Commit próprio, como pedido. |
| `13708a1` | **T1–T6** — fileira de chips, crédito preso à nota, `SectionBoundary`, score removido, parser de prêmios. |
| `045c9df` | **T7–T8** — responsividade auditada por medição, tokens por vertical, `DESIGN-DELTA-detalhe.md`. |
| `85c5674` | **Correção** — "Onde assistir NÃO acende sozinho": a afirmação anterior era premissa não verificada. |

---

## 2. T0 — Sufixo por fonte · **feito**

O sufixo vinha do denominador (`${value}/${best}`), então toda fonte de escala
100 saía `N/100`. RT entrava nesse balde e a página afirmava "84 pontos de 100
possíveis" onde a fonte disse "84% dos críticos aprovaram".

Agora é propriedade da fonte:

| Fonte | Sufixo |
| --- | --- |
| `imdb` | `/10` |
| `metacritic` | `/100` |
| `rotten_tomatoes` | **`%`** |
| `letterboxd` | `/5` |
| `filmaffinity` | `/10` |

**O caso que prova a regra:** RT e Metacritic têm a **mesma escala (100)** e a
**mesma natureza (`critics`)** e se escrevem **diferente**. Nenhuma regra
derivada de escala, de valor ou de `score_type` separa os dois. Só a fonte.

Dois efeitos que não estavam no pedido:

- escala da linha divergente da escala canônica **derruba a nota** (o sufixo
  descreveria outra régua);
- a ordem da fileira passou a ser prioridade declarada, não alfabética.

### Havia um teste travando o defeito

`tests/web/ratings-presenter.test.ts` afirmava `rotten_tomatoes:92/100` **e
exigia `"/"` em toda `scoreLabel`**. Essa última assertion travava a forma
correta: escrever `92%` quebrava a suíte. Atualizado com o porquê; a regra que
ele defende (nada é reescalado entre fontes) foi **reforçada**, não relaxada.

**Arquivos:** `apps/web/src/lib/ratings-presenter.ts`,
`tests/governance/rating-suffix-by-source.test.ts` (6 casos, com controle
positivo de fixture).

---

## 3. T1 — Crédito · **feito**

### O que os 12 testes do gate exigem, exatamente

**Texto visível, no presenter. Nem proximidade no DOM, nem link.**

- `buildRatingsView` devolve `null` se `attribution.text` for ausente, vazio ou
  só espaços — o painel inteiro some.
- **Link não é exigido para ratings.** `attribution.url` pode ser `null`.
  `requiresLinkback` vive no *server*, com dispensa nominal para RT/Metacritic
  (`LINKBACK_DISPENSED_SOURCES`). Só as ofertas de streaming exigem linkback nos 12.
- **Nenhum dos 12 olha marcação.** Mover o crédito para rodapé, seção "Fontes" ou
  tooltip deixaria todos verdes com a licença violada em produção.

### O buraco que foi fechado

`apps/web/app/_components/__tests__/ratings-panel.test.tsx` (13 casos):

- assertion de **contenção** — o crédito na fatia de marcação do **seu** chip;
- o **negativo** — nenhum crédito aparece fora de um chip;
- crédito é **texto visível**, não `aria-label` nem `title`.

Sem jsdom (o projeto roda `environment: 'node'`): a marcação é fatiada por chip,
e a **precondição do corte** (nenhum `<li>` aninhado) é verificada antes de
qualquer assertion depender dela.

### Detalhes de fidelidade

- **Contagem de votos só no IMDb.** A OMDb devolve `imdbVotes`; RT e Metacritic
  não trazem contagem. Nunca "31 críticas" inventadas.
- **Linkback só onde há `imdbID`.** Derivar slug do título fabricaria um link
  que pode não existir.

---

## 4. T2 — Fileira de chips · **feito, com conflito resolvido contra o mockup**

- **1, 2, 3 ou 4 chips.** Divisória modelada como **liderante** (do 2º em
  diante): "n chips → n−1 divisórias, nenhuma na ponta" vira consequência da
  forma, não de um `if` que alguém precisa lembrar.
- **Zero chips:** bloco "Avaliações" inteiro fora do DOM + log.
- **Ordem declarada:** `imdb → rotten_tomatoes → metacritic → letterboxd →
  filmaffinity`. IMDb primeiro porque é a única fonte de público do conjunto
  servido pela OMDb, a única com linkback e a única com contagem — ancora a
  fileira com o chip mais completo. Coincide com o canônico.
- **Metacritic entra** na fileira com tratamento igual.

### O gate ganhou do desenho

O canônico desenha a marca gráfica de cada fonte (caixa amarela do IMDb
`#F5C518`, tomate do RT `#FA320A`, azul do TMDB). **Não podemos.**

Em `services/legal/src/authorization-spec.ts` o campo é o literal
`readonly logoAllowed: false` — **é o tipo, não um valor** — e a nota das
licenças diz *"Logo e citacao integral de critica NAO autorizados"*.

O slot da marca carrega o **nome da fonte em texto**. Travado por teste que
barra `<svg>`, `<img>` e as três cores de marca. **Não propus marca para o
Metacritic** — seria a mesma violação.

---

## 5. T3 — Cinerie Score · **opção (a)**

O bloco não renderiza. A coluna começa direto em "Avaliações".

**Por quê (a) e não (b):** o contrato de dados reais decide — *"se não há
conteúdo, a seção inteira não renderiza"*. A página escrevia "Ainda não
calculado", texto solto ocupando a **posição de maior destaque** da coluna (47px
/ weight 800 no canônico) para dizer que não há nada ali.

### O que (c) exigiria

| Requisito | Estado |
| --- | --- |
| Fórmula versionada | `PRODUCTION_FORMULA_REGISTRY` **vazio de propósito** |
| Peso crítica/público | não decidido |
| Regra para título com fonte única | não decidida |
| Licença de obra derivada | **`derivative_allowed` é `false` em toda decisão registrada** |
| Decisão `cinerie_score_display` | **não existe** |

`docs/legal/source-operations-inventory.md` §4 diz literalmente **"Bloqueado"**.
A infra existe (`packages/cinerie-score`, `docs/product/cinerie-score-decision.md`).
Falta a decisão humana. **Não comecei.**

---

## 6. T4 — Onde assistir · **bloco feito; a cadeia NÃO acende (ver §9)**

Bloco completo, dirigido por dado. Zero ofertas → fora do DOM **e**
`reason=no_authorized_provider`.

### `SectionBoundary` — a razão de existir

O contrato manda não renderizar bloco vazio, e isso está certo. Cumprido
**sozinho**, produz um defeito maior: hoje há zero ofertas exibíveis, o bloco
some de **todo** título, e isso é visualmente idêntico a um filme que não está em
streaming nenhum.

`apps/web/src/lib/section-absence.ts` + `app/_components/section-boundary.tsx`:

- a união `SectionDecision` torna **impossível** escrever "sumiu sem motivo"
  (`rendered: false` obriga `absence`);
- a fronteira emite o log **no mesmo ponto** em que decide não renderizar — as
  duas metades não podem divergir porque são a mesma linha;
- `reason` nomeia **causa acionável**: `no_authorized_provider` (operação
  pendente, `actionable: true`) ≠ `no_offer_for_entity` (fato sobre o título,
  `actionable: false`). Sem isso o log vira ruído;
- em dev, aviso visível no DOM. Em produção, só log.

O teste assere **os dois fatos na mesma assertion**:
`expect(observed).toEqual({ markup: "", logs: [...] })`.

**Nenhum comando de produção foi rodado.**

---

## 7. T5 — "Original Screen" · **premissa refutada**

**Nunca esteve no site.** Estava só no arquivo canônico do design. A divergência
é do canônico, não da implementação.

Travei com teste mesmo assim
(`tests/governance/original-screen-absent.test.ts`), porque o canônico é o
arquivo que a próxima pessoa abre para "completar o que falta". O guard barra
**as duas formas** — o problema não é o rebrand, é a afirmação: "Original
Cinerie" seria igualmente falso, porque a Cinerie não produz filme nem série.

O guard lê a página **sem comentários**, senão documentar a decisão seria
proibido por ela mesma. Provado por **controle negativo** (adicionei o rótulo,
o teste falhou, revertei).

---

## 8. T6 — Prêmios · **não consegui provar; parser e componente entregues**

Confirmei sua premissa: a API da TMDB não expõe prêmios.

**Não pude fazer a chamada real:**

- `OMDB_API_KEY` **não está** no `.env` local;
- o host do banco de produção é interno, inalcançável daqui;
- `curl` bloqueado no ambiente;
- **a fixture não serve** — ela se declara *"recortada nos campos que o adapter lê"*.

### O que estabeleci pelo código

`api_cache` guarda o payload **bruto sem podar** (`payload` passa direto no
upsert de `services/ratings/src/persistence/cache.ts`), e o worker grava sempre
que houve rede (`omdb/run.ts:285`). **Se `Awards` chega, ele já está
armazenado** — não "descartado", e sim nunca promovido a tabela de domínio.

Uma consulta resolve:

```bash
psql "$DATABASE_URL" -c "SELECT payload ? 'Awards' AS tem, payload->>'Awards' FROM api_cache WHERE provider_api='omdb' LIMIT 5;"
```

### Entregue

- `apps/web/src/lib/awards-presenter.ts` — parser puro, **11 casos testados**:
  com Oscar, sem Oscar, singular, só vitórias, só indicações, prêmio não-Oscar,
  milhar, `N/A`, ausente/nulo/vazio, formato desconhecido → devolve o **bruto**.
- `apps/web/app/_components/awards-band.tsx` — componente pronto, **não
  importado**.
- **Não traduz o nome do prêmio.** "Won 3 Oscars" sai verbatim — o nome é
  afirmação factual da fonte, e traduzir arbitrariamente é inventar.

**Licença:** `Awards` é fato editorial, não nota. `use_case` próprio, **fora de
`rating_display`**. Não encostei em `services/legal`.

---

## 9. ⚠️ CORREÇÃO — "Onde assistir" NÃO acende com operação

> O relatório inicial afirmou: *"Onde assistir — Bloco 2 do runbook — **só
> operação** — acende sozinho."* **Está errado.** A frase veio do enunciado da
> tarefa e foi repetida com autoridade de achado. Refutada por outro agente com
> arquivo:linha; **reverifiquei cada trava** antes de corrigir.

São **três paradas independentes de código**. Qualquer uma sozinha mantém o
bloco apagado — corrigir duas não acende nada.

### 9.1 O render e o worker falam de provedores diferentes (a decisiva)

| Lado | Arquivo:linha | Valor |
| --- | --- | --- |
| Leitura | `apps/web/src/server/entity-watch.ts:37` (filtro em `:56`) | `providerApi = "streaming_availability"` |
| Escrita | `services/ingestion/src/persistence/watch-providers-store.ts:122` | `provider_api = TMDB_PROVIDER_API` (`'tmdb'`) |

A query filtra por um valor que o worker **nunca grava**. Zero linhas,
independentemente de licença, decisão ou runbook.

### 9.2 Nasce invisível, e a promoção recusa promover

`watch-providers-store.ts:122` grava `display_allowed` como `false` literal.
`services/ingestion/src/watch-providers/types.ts:66-70`:

> *"Toda linha nasce `display_allowed = false` (invariante 6). Este contrato NAO
> expoe nenhum campo de licenca/atribuicao/revisao."*

O caminho que acenderia é `promote-watch-availability`, e
`services/streaming/src/promotion/guardrails.ts:61` devolve **`wrong-provider`**
para tudo que não seja `streaming_availability` — *"nunca tocamos dado de outro
fornecedor"* (comentário na linha 11).

### 9.3 `deep_link` é NULL e o presenter descarta oferta sem ele

`watch-providers-store.ts:120` grava `NULL`, com o motivo **correto** ao lado: o
TMDB publica **um link por país**, que vai em `web_url`; derivar deep link
afirmaria um destino que o upstream nunca prometeu.

Só que `watch-availability-presenter.ts` exige deep link http/https válido. **As
duas regras estão certas isoladamente e se anulam juntas.**

### 9.4 Sem `attribution_text` — e o texto que existe credita a fonte errada

O registrado para streaming é **"Disponibilidade fornecida por Movie of the
Night"** — o fornecedor do slice RapidAPI. Em dado vindo do TMDB creditaria quem
não produziu o dado: a disponibilidade do TMDB é **JustWatch**, e a atribuição a
JustWatch é condição do acesso à TMDB.

### 9.5 São dois caminhos disjuntos

| | `streaming_availability` (RapidAPI) | `tmdb` (watch/providers) |
| --- | --- | --- |
| Render lê? | **SIM** | **NÃO** |
| Promoção aceita? | sim | **não** (`wrong-provider`) |
| `deep_link` | tem | **NULL** |
| Atribuição | Movie of the Night | **nenhuma** (e a acima seria errada) |

A memória antiga do projeto listava 4 passos para acender streaming — **eles
valem para o caminho RapidAPI**. O caminho TMDB grava dado que o render não lê.

### 9.6 O que eu NÃO sei

Não investiguei **quanto** de código é a correção. Não sei se a saída é apontar
o render para `tmdb`, fazer o caminho TMDB gravar `streaming_availability`, ou
uma terceira coisa — cada uma tem consequência de licença diferente (quem é a
fonte, qual crédito). **Escopo de outro prompt.**

---

## 10. T7 — Série · **feito**

- **Paleta como token por vertical** (`--ctx-kicker`, `--ctx-kicker-on-dark`) em
  vez de hex inline no JSX. Havia `style={{ color: '#B6D3A8' }}` no componente —
  cor de marca hardcoded é o que faz filme e série divergirem em silêncio quando
  só um dos dois é editado.
- **Elenco** segue a escada do contrato: 6 → 5 (notebook) → 4 (tablet) → rail
  horizontal de 120px (mobile).
- **"Ver no celular"** é ferramenta de protótipo. Não portado.
- **O segundo seletor de temporada NÃO foi portado.** No canônico a crítica é
  *por temporada* (`seasonInfo.critica`); aqui `review_summary` é por
  **entidade**. O seletor não teria estado para trocar e sugeriria críticas por
  temporada que não existem.

---

## 11. T8 — Responsividade · **auditada por medição**

`pnpm --filter @screena/web qa:detail-responsive` — CSS **real** (lido do disco),
fileira de notas **real** (componente + presenter), Chromium, 5 larguras × 3
cenários. Mede overflow horizontal, alvo de toque e piso de fonte.

**Resultado: auditoria limpa** nas 15 combinações.

### O que a medição achou (nada disso aparece lendo o arquivo)

| Achado | Detalhe |
| --- | --- |
| **Overflow horizontal a 320px** | `.detail-hero__aside` tinha `min-width: 300px` e sobram 280px após o padding — a coluna saía da tela na primeira largura que o contrato manda auditar |
| **Duas regras conflitantes** para episódios no mobile | Um bloco derivado da tela 08 (~4.500 linhas depois, mesma especificidade) sobrescrevia o `128px 1fr` por um card vertical de still full-width |
| **Piso de 12px inerte** | O bloco de correção perdia por ordem de documento para `.eyebrow-bar span`, `.mnews-card__cat`, `.episode-row__num`. A auditoria reprovava **com o conserto já no arquivo** |
| **Alvo de toque** | Breadcrumb (19px) e link de crédito (13px) abaixo de 44px |
| **`.mnews-card__title`/`__meta`** | `<span>` sem `display:block` — a linha meta grudava no fim do título. Defeito que **já estava no ar** |

### Derivação da faixa de mídia (o contrato não a cobre)

Regra: **nenhuma célula desaparece; a altura fixa é que cede.** Os três atalhos
da direita eram escondidos com `display:none` abaixo de 1024 — isso não
simplificava o layout, **apagava três links** exatamente onde a navegação lateral
já não existe.

| Faixa | Comportamento |
| --- | --- |
| ≥1024 | canônico: `1fr 3fr 2fr`, 472px |
| ≤1023 | pôster + destaque em cima (360px); atalhos empilham abaixo em 3 colunas (132px) |
| ≤767 | idem, 240px / 104px |

### Conflito contrato × tela 08 (episódios)

Resolvido **a favor do contrato**, porque ele próprio define a hierarquia: *"a
tela 08-series-mobile é referência de LINGUAGEM mobile, **não o contrato
completo**"*. Com o still em cima, uma temporada de 16 episódios vira uma
rolagem de três metros.

---

## 12. Prova

| Item pedido | Estado |
| --- | --- |
| Teste do sufixo por fonte (IMDb `/10`, MC `/100`, RT `%`) | ✅ 6 casos |
| Fileira com 0, 1, 2, 3 e 4 fontes, divisórias corretas | ✅ |
| Crédito **dentro** do bloco da nota (contenção no DOM) | ✅ + o negativo |
| Sem provedor → fora do DOM **e** log, na mesma assertion | ✅ |
| "Original Screen" não aparece | ✅ + controle negativo |
| Controle positivo contra fixture malformada | ✅ em 4 suítes |
| Screenshots 1440/1024/768/375 | ⚠️ ver ressalva abaixo |

**Ressalva sobre as capturas:** saem do harness estático, **não** do Next com o
banco de produção (`DATABASE_URL` aponta para host interno inalcançável). Elas
provam o **comportamento do CSS** — que é o que mudei — com componente e
presenter reais. **Não provam a cadeia de dados.** "Gladiador" ali é fixture com
as notas na forma real da OMDb, inclusive o `80` do RT que motivou o T0.

---

## 13. Verificação

```
pnpm typecheck (apps/web)      OK
pnpm lint                      OK
vitest                         5.570 passando (417 arquivos)
pnpm audit:invariants          PASSOU
pnpm audit:render              PASSOU
pnpm build (@screena/web)      OK
```

**Uma correção no auditor:** `check-invariants` varria a saída **gerada** do QA
visual (`apps/web/.qa-*`, gitignored) como se fosse código. Uma violação ali não
é consertável no lugar certo, e o mesmo commit passava ou falhava conforme
existisse um diretório local. Ignorada por prefixo, como `.next` e `dist`. As
outras duas acusações eram **reais** e foram corrigidas na origem, **sem tocar
nas regras**.

---

## 14. O que NÃO foi tocado (como pedido)

- `resolveDisplayAllowed` e os 12 testes do gate
- o trigger `external_ratings_display_guard_trg`
- a hidratação de licença em `external-ratings-store.ts`
- `services/legal` — nenhum `apply`, nenhuma mudança de decisão
- o adaptador OMDb e o parser dos três formatos
- as migrations de licença

---

## 15. O que falta para a página ficar igual ao mockup

| Bloco | Falta | Frente | Acende com |
| --- | --- | --- | --- |
| Guia Cinerie · crítica | alguém escrever | Redação | **Só conteúdo** — o caminho já está ligado |
| Onde assistir | corrigir a cadeia (§9) | Dados + legal | **Código novo** — não é operação |
| Prêmios | confirmar `Awards` → licença → coluna | Dados + legal + front | Código novo |
| Cinerie Score | fórmula + peso + `derivative_allowed` | **Decisão do dono** | Código novo |
| Chips de gênero | `movies` não tem junção com `genres` | Ingestão | Código novo |
| Mais como este | sem dataset determinístico | Recomendação | Código novo |
| Trailer (play, contagens) | sem contrato de vídeo/mídia | Front + dados | Código novo |
| Estrela + assinatura da crítica | `content_blocks` guarda texto, não veredito nem autoria | Schema | Código novo + migration |

**Nenhum acende só com operação.** (Era exatamente isso que o relatório inicial
errava.)

---

## 16. Arquivos novos

```
apps/web/src/lib/section-absence.ts              fronteira de ausência (puro)
apps/web/src/lib/awards-presenter.ts             parser de Awards (puro)
apps/web/app/_components/section-boundary.tsx    decide E loga na mesma linha
apps/web/app/_components/awards-band.tsx         pronto, NÃO importado
apps/web/scripts/qa-detail-responsive.ts         auditoria por medição
apps/web/scripts/tsconfig.json                   jsx: react-jsx para as dev tools
apps/web/types/react-dom-server.d.ts             tipagem mínima p/ testes de DOM
docs/frontend/DESIGN-DELTA-detalhe.md            as divergências, escritas
tests/governance/rating-suffix-by-source.test.ts
tests/governance/original-screen-absent.test.ts
apps/web/app/_components/__tests__/ratings-panel.test.tsx
apps/web/app/_components/__tests__/section-boundary.test.tsx
apps/web/src/lib/__tests__/awards-presenter.test.ts
```

---

## 17. Próximos passos (do dono)

1. **Merge da #163** depois do CI. (No fechamento deste relatório: `Backup +
   restore` ✅ passou; Docker e Typecheck/lint/test ainda rodando.)
2. **Rodar a consulta dos prêmios** (§8). Se voltar `tem = t`, os prêmios saem
   quase de graça — o parser está pronto.
3. **Decidir o Cinerie Score** (§5). Sem fórmula e peso, aquele "82" grande não
   existe.
4. **Abrir um prompt para a cadeia de streaming** (§9). Não é operação.
