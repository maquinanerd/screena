# Prêmios da OMDb — de quem é o crédito? (**decisão PENDENTE**)

> Registro de uma pergunta que **não foi respondida com evidência**, e do que
> depende dela. Idioma: pt-BR. Nenhum valor de chave, token ou senha aparece
> aqui.
>
> **Estado: BLOQUEADO.** O dado está no banco, o pipeline está pronto e testado,
> e a faixa de prêmios **não aparece** — porque não sabemos a quem creditar o
> fato. A decisão é do proprietário.

---

## 1. A pergunta

O campo `Awards` da OMDb é uma frase:

```
Won 4 Oscars. 160 wins & 220 nominations total
```

Não é uma nota. É um **fato editorial sobre a obra** — e todo fato exibido na
Cinerie é creditado a **quem o afirmou** (invariantes 1, 2 e 6).

A pergunta que precede a licença é, portanto:

> **Quem contou os 4 Oscars, as 160 vitórias e as 220 indicações?**

A OMDb é o **fornecedor técnico** — foi ela que entregou o JSON, e isso está
provado: `provider_api = 'omdb'`, `api_cache.request_key = 'i=tt…'`. Mas
`provider_api` nunca é `rating_source` (invariante 2), e o mesmo princípio vale
para qualquer afirmação: **quem transportou o byte não é quem fez a afirmação.**

---

## 2. A evidência levantada

### 2.1 O payload NÃO declara fonte para este campo

Esta é a evidência mais forte, e ela é verificável sem sair do repositório.

O mesmo payload da OMDb traz, para **notas**, um array em que **cada item nomeia
a sua fonte**:

```json
"Ratings": [
  { "Source": "Internet Movie Database", "Value": "7.6/10" },
  { "Source": "Rotten Tomatoes",         "Value": "85%"    },
  { "Source": "Metacritic",              "Value": "67/100" }
]
```

É exatamente por isso que a Cinerie consegue reatribuir cada nota à sua fonte
editorial ([`services/ratings/src/omdb/sources.ts`](../../services/ratings/src/omdb/sources.ts)).

`Awards` é uma **string de topo, sem rótulo nenhum**:

```json
"Awards": "Won 4 Oscars. 160 wins & 220 nominations total"
```

O mesmo fornecedor que sabe nomear a fonte quando está repassando uma **não
nomeia nenhuma aqui**. Essa assimetria é o fato central: ela não prova quem é a
fonte, mas prova que a OMDb **não a declarou**.

### 2.2 A documentação da OMDb reivindica o conteúdo como dela, e nega o IMDb

Da página da API (`https://www.omdbapi.com/`):

> "all content and images on the site are contributed and maintained by our
> users"

E, no rodapé:

> "This site is not endorsed by or affiliated with IMDb.com"

Dos Termos de Uso (`https://www.omdbapi.com/legal.htm`), que tratam o conteúdo
como **Contributions** dos próprios usuários da OMDb, licenciadas para ela.

### 2.3 O formato da frase é o do IMDb, e terceiros descrevem a OMDb como dado do IMDb

`Won 4 Oscars.` + `160 wins & 220 nominations total` é, palavra por palavra, o
formato do resumo de prêmios da página de título do IMDb. Levantamentos de
terceiros descrevem a OMDb como dado público do IMDb sistematizado ("unofficial
IMDb data"), já que o IMDb não expõe API pública.

Isto é **indício forte**. Continua sendo indício: nenhuma das duas partes
declara a relação para este campo.

### 2.4 O fato bruto não pertence a nenhuma das duas

"Inception venceu 4 Oscars" é um fato público da Academia. O que é obra de
alguém é a **contagem agregada** — "160 vitórias & 220 indicações" —, que exige
alguém ter varrido e tabulado prêmios do mundo inteiro. Essa tabulação tem um
autor. Não sabemos qual.

---

## 3. Por que isso não pode ser resolvido no chute

As duas saídas disponíveis são, ambas, afirmações que a evidência não sustenta:

| Saída | O que ela afirma | Por que não se sustenta |
| --- | --- | --- |
| **Creditar o IMDb** | "o IMDb publicou esta contagem e a repassou pela OMDb" | O IMDb nunca declarou isso, e a OMDb **desmente a afiliação por escrito**. Seria a mesma proveniência falsa que a PR #164 acabou de consertar no streaming (creditar "Movie of the Night" a dado que vinha do TMDB/JustWatch). |
| **Creditar a OMDb** | "a OMDb apurou esta contagem" | Colapsa fornecedor técnico e fonte editorial — o núcleo da invariante 2. E a frase "contributed by our users" é boilerplate de um site com formulário de contribuição, não prova de que **esta** contagem foi apurada lá. |

**Por isso a decisão parou aqui.** Não é excesso de zelo: um crédito errado é
pior que crédito ausente — ele afirma publicamente que uma organização disse
algo que ela não disse.

---

## 4. Uma observação separada, sobre os Termos da OMDb

Levantada no mesmo trabalho, **não é a decisão desta página** e não altera nada
do que já está no ar. Fica registrada porque é um fator que o proprietário
precisa ter à vista.

Os Termos de Uso da OMDb (`legal.htm`) contêm, entre outras cláusulas:

> "You may not build a business utilizing the Contributions, whether or not for
> profit."

> "The Site is made available to you only for your personal use, and you may not
> use the Site or any Contributions or Materials in connection with any
> commercial endeavors."

Isso **não é específico do campo `Awards`**: alcança igualmente as notas de
IMDb / Rotten Tomatoes / Metacritic que já são servidas pela OMDb desde a emenda
de 2026-08-12
([`ratings-streaming-provider-authorization.md`](./ratings-streaming-provider-authorization.md)).
A autorização vigente foi tomada "com ciência explícita do licenciamento de cada
fonte"; esta nota apenas deixa a cláusula escrita onde ela pode ser lida.

---

## 5. O que já está pronto, esperando a decisão

Tudo, exceto a decisão. **Nenhuma linha de código deste repositório nomeia a
fonte editorial do fato de premiação** — e isso é estrutural, não disciplina:

- **O dado está no domínio.** `entity_awards` guarda o literal bruto **e** a
  forma reconhecida (`outcome`, `highlight_count`, `award_name`, `wins`,
  `nominations`), com `provider_api = 'omdb'`, hash do payload e `fetched_at`.
- **Toda linha nasce fail-closed:** `display_allowed = false`,
  `license_status = 'unknown'`, `source_key = NULL`.
- **O worker DESCOBRE a fonte perguntando à licença.**
  [`awards-credit-lookup.ts`](../../services/ratings/src/persistence/awards-credit-lookup.ts)
  não recebe fonte como argumento: ele lê a licença vigente de premiação e usa o
  `source_key` **dela**. Sem licença → `no-license`, e o motivo é reportado.
  Duas licenças → `ambiguous`, e ele recusa em vez de sortear.
- **O banco trava.** O trigger `entity_awards_display_guard_trg` recusa
  `display_allowed = true` sem fonte nomeada, sem crédito, ou com decisão de
  outro `use_case` — provado contra PostgreSQL real por
  `pnpm --filter @screena/ratings validate:awards` (16/16 checks).
- **A faixa está ligada na página**, dentro de um `<SectionBoundary>`. Como não
  há licença, ela não renderiza e o log sai:
  `{"event":"section_absent","section":"premios","reason":"no_awards_source","actionable":true}`.

---

## 6. Como a decisão entra (uma linha)

Decidida a fonte, acrescente a chamada abaixo a `STATIC_AUTHORIZATION` em
[`services/legal/src/authorization-spec.ts`](../../services/legal/src/authorization-spec.ts):

```ts
awardsAuthorizationEntry({
  sourceKey: '<a fonte decidida>',
  attributionText: '<o crédito textual exigido por ela>',
  policyVersion: 'cinerie-source-auth/<fonte>/2026-08-v1',
  requiresLinkback: <true|false>,
  notes: '<por que, e sob que base>',
})
```

Três pontos que a decisão precisa cobrir:

1. **`sourceKey`** — a fonte editorial. Nunca `omdb` (o trigger recusa
   `source_key = provider_api`).
2. **`attributionText`** — o crédito exibido na faixa, ao lado do fato. Ele é
   obrigatório: sem ele nada aparece.
3. **`requiresLinkback`** — se `true`, a licença precisa de `terms_url` (é dela
   que sai o link do crédito; não há URL por título para um fato de premiação, e
   fabricar uma a partir do nome do filme está fora de questão).

Sobre `policy_version`: as fontes de rating usam versão **por fonte**
(`cinerie-source-auth/imdb/2026-08-v1`). Se a decisão exigir uma **leva nova**
(rótulo de lote, como `AUTHORIZATION_BATCH`), isso é decisão do proprietário —
não foi criada nenhuma aqui.

Depois de aplicar a licença (`pnpm legal apply --confirm`), o comando que faz a
primeira faixa aparecer está em
[`docs/operations/awards-promotion-runbook.md`](../operations/awards-promotion-runbook.md).

---

## 7. Resumo em uma frase

**O dado está guardado, o caminho inteiro está pronto e travado, e a faixa não
acende — porque a única coisa que falta é uma afirmação sobre o mundo que só o
proprietário pode fazer: de quem é o crédito.**
