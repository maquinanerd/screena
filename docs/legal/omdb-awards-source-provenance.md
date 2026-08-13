# Prêmios da OMDb — de quem é o crédito? (**DECIDIDO em 2026-08-13**)

> Registro de uma pergunta, da evidência levantada, e da decisão que a fechou.
> Idioma: pt-BR. Nenhum valor de chave, token ou senha aparece aqui.
>
> **Estado: DECIDIDO.** O crédito é da **OMDb**, com o texto
> **"Dados de premiação fornecidos por OMDb"**. As seções 1–4 são o histórico da
> pergunta — ficam como estão, porque é o que impede a próxima pessoa de reabrir
> isto do zero. A decisão e o raciocínio que a sustenta estão na **seção 5**.

---

## 0. A decisão, em uma tela

| Campo | Valor |
| --- | --- |
| **Quem decidiu** | Pablo Eduardo — proprietário da Cinerie |
| **Quando** | 2026-08-13 |
| **Crédito** | `Dados de premiação fornecidos por OMDb` |
| **`source_key`** | `omdb` |
| **`use_case`** | `awards_display` |
| **`content_type`** | `other` (prêmio não é nota, oferta, imagem nem notícia) |
| **`policy_version`** (da fonte) | `cinerie-source-auth/omdb/2026-08-v1` |
| **Leva** (`--policy-version` da CLI) | `cinerie-source-auth/2026-07-v1` — **nenhuma leva nova** |
| **Logo** | **não autorizado** (`logo_allowed = false`) |
| **Linkback** | dispensado (motivo mecânico — ver seção 5); crédito textual **obrigatório** |
| **Território** | `BR` |

Onde vive: [`services/legal/src/authorization-spec.ts`](../../services/legal/src/authorization-spec.ts),
travada por [`awards-authorization.test.ts`](../../services/legal/src/__tests__/awards-authorization.test.ts).

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

## 3. A decisão: o crédito é da OMDb — e por que isso não colapsa a invariante 2

**Decidido por Pablo Eduardo em 2026-08-13**, depois de o levantamento acima ter
parado sem resposta. O raciocínio, na íntegra:

### 3.1 A invariante 2 foi escrita para **opinião**, e prêmio não é opinião

`provider_api` nunca é `rating_source` — e está certo, porque **uma nota é uma
opinião**. `8,5/10` pertence a quem julgou. É por isso que IMDb, Rotten Tomatoes
e Metacritic são creditados separadamente mesmo chegando todos no mesmo payload
da OMDb, e por isso colapsá-los seria mentira.

Um prêmio **não é opinião. É fato público.** "Inception venceu 4 Oscars" é
verdade independentemente de quem conta. Quem premiou foi a Academia — não o
IMDb, não a OMDb, não a Cinerie. Não existe autoria editorial a proteger, porque
não existe juízo: existe um evento que aconteceu.

Então a pergunta que a invariante faz — *"de quem é essa opinião?"* — **não se
aplica**. A que sobra é *"quem entregou este dado?"*, e essa tem resposta única,
verificável e não contestada: a OMDb.

### 3.2 O verbo carrega a decisão

O crédito é **"Dados de premiação fornecidos por OMDb"**, e não a forma curta da
casa (`"Premiação fornecida por OMDb"`, no molde de *"Nota fornecida por IMDb"*).

A forma curta se leria como se a OMDb tivesse **premiado** alguém. A longa diz o
que de fato aconteceu: **fornecidos por** é transporte, não autoria. É mais feia
e está certa; a feiura fica, e há teste literal impedindo o "conserto".

### 3.3 Creditar o IMDb seria pior

Pelo motivo levantado na seção 2: o payload não o nomeia, e a OMDb nega a
afiliação por escrito. Seria afirmar uma proveniência que não se consegue provar
— a mesma família de defeito que a PR #164 consertou no streaming (creditar
"Movie of the Night" a dado que vinha do TMDB/JustWatch).

### 3.4 O que esta decisão **não** autoriza

- **Não** vale para notas. Para `external_ratings` a invariante 2 continua
  inteira, e o guard do banco que recusa `provider_api = rating_source` **não foi
  tocado**. Travado por
  [`awards-authorization.test.ts`](../../services/legal/src/__tests__/awards-authorization.test.ts),
  que verifica as duas metades: a licença de premiação existe **e** nenhuma
  licença de `rating` credita um fornecedor técnico.
- **Não** autoriza logo. `logo_allowed = false`: o nome da OMDb aparece em texto,
  nunca a marca gráfica.
- **Não** autoriza obra derivada (`derivative_allowed = false`).

### 3.5 O único ponto do código que contradizia a decisão — e foi removido

A migration `20260813120000_entity_awards_from_omdb_cache` nascia com um check
`source_key <> provider_api` no trigger de premiação. **Ele não vinha de nenhuma
invariante do projeto**: era uma extensão da regra de notas para um domínio que
ela não cobre, escrita por precaução antes de a decisão existir. Foi removido, com
o motivo registrado no próprio SQL. A trava real permanece: `source_key` tem de
casar com uma **licença vigente** que carregue uma decisão `awards_display`.

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

**Isto não é uma pendência aberta.** A decisão sobre usar a OMDb foi tomada pelo
proprietário, com informação completa, quando ela foi escolhida para as notas —
que estão no ar desde 2026-08-12. Estender o mesmo fornecedor à premiação é a
**mesma decisão**, não uma nova. O registro fica aqui; nenhuma tarefa foi aberta,
nenhum aviso foi adicionado ao código.

---

## 5. Como a decisão é executada pelo sistema

**Nenhuma linha de código nomeia a fonte de premiação por conta própria** — isso
não mudou com a decisão, e é o que a torna reversível:

- **O worker DESCOBRE a fonte perguntando à licença.**
  [`awards-credit-lookup.ts`](../../services/ratings/src/persistence/awards-credit-lookup.ts)
  não recebe fonte como argumento: lê a licença vigente de premiação e usa o
  `source_key` **dela**. Sem licença → `no-license`, motivo reportado. Duas
  licenças → `ambiguous`, e ele **recusa em vez de sortear**. Trocar a fonte um
  dia (um agregador de prêmios de verdade, por exemplo) é trocar os argumentos de
  `awardsAuthorizationEntry(...)`, não reescrever o pipeline.
- **O crédito é hidratado NA ESCRITA.** `entity_awards` guarda o literal bruto e
  a forma reconhecida; a licença entra no mesmo `upsert`. Consequência
  operacional que não pode ser esquecida: **aplicar a licença sozinho não acende
  nada** — é preciso reexecutar o worker (ver seção 6).
- **Toda linha nasce fail-closed** (`display_allowed = false`,
  `license_status = 'unknown'`, `source_key = NULL`) e só então a política decide
  se acende.
- **O banco trava.** `entity_awards_display_guard_trg` recusa
  `display_allowed = true` sem fonte nomeada, sem crédito, com hash divergente ou
  com decisão de outro `use_case`.

### Por que o linkback é dispensado (motivo mecânico, não de política)

`apply.ts` **não escreve `terms_url`** — a coluna não está no `INSERT` de
`source_licenses` —, e é dela que o lookup de premiação tira a URL de crédito.
Com `requires_linkback = true`, a faixa cairia em `missing-linkback` **para
sempre**, exatamente como aconteceria com Rotten Tomatoes e Metacritic antes da
dispensa nominal delas.

O crédito **textual** continua obrigatório: sem ele, nada aparece.

**Reversão automática, já armada:** `requires_linkback = false` significa "não
**exige** link", nunca "não **pode** ter". No dia em que `terms_url` for
preenchido, o lookup passa a devolver a URL e a faixa exibe **com link** no ciclo
seguinte do worker, sem nova decisão humana. A checagem de HTTPS continua
valendo, então um link ruim nunca passa.

---

## 6. Sequência para produção

Na ordem. **Sem `--`**: no pnpm 9.15.4 deste repositório o separador chega
literal e é recusado pelos parsers.

```bash
corepack pnpm legal sources review
```

```bash
corepack pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="cinerie-source-auth/2026-07-v1" --confirm
```

```bash
corepack pnpm --filter @screena/ratings awards:promote --apply
```

Notas sobre o segundo comando:

- `--policy-version` é a **leva** (`AUTHORIZATION_BATCH`), e a CLI **recusa
  qualquer outro valor**. A versão por fonte
  (`cinerie-source-auth/omdb/2026-08-v1`) vive dentro da entrada do spec, não
  na linha de comando. Nenhuma leva nova foi criada.
- `--confirm` exige `--reviewer` **e** `--policy-version`; sem elas o comando
  mostra o plano e não escreve.
- O terceiro comando **não é opcional**: o crédito é gravado na escrita da linha,
  então sem ele as linhas já promovidas continuam com `source_key = NULL`.
  Em produção ele exige `CINERIE_AWARDS_PROMOTION_AUTHORIZED=true`.

Runbook operacional completo (flags, motivos de recusa, diagnóstico):
[`docs/operations/awards-promotion-runbook.md`](../operations/awards-promotion-runbook.md).

---

## 7. Resumo em uma frase

**Prêmio é fato, não opinião: não há autoria editorial a proteger, então o
crédito é de quem entregou o dado — a OMDb —, com o verbo do transporte
("fornecidos por"), sem logo e sem link, e a invariante 2 segue intacta onde ela
foi escrita para valer: nas notas.**
