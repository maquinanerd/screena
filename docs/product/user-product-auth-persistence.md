# Persistência de sessões e tokens de autenticação (Backend C — C7B2)

> Sessões, verificação de e-mail e recuperação de senha. Contratos, adapters
> Prisma e o que foi **deliberadamente deixado de fora**.
>
> Não há HTTP, cookie, middleware, CSRF, geração de token, envio de e-mail nem
> composição de runtime nesta unidade — só persistência.

## Models reais

| Conceito | Model | Tabela | Unique | FK | Expiração | Consumo |
| --- | --- | --- | --- | --- | --- | --- |
| Sessão | `UserSession` | `user_sessions` | `token_hash`, `rotated_from_id` | `user_id`→`users` CASCADE | `expires_at` | `revoked_at` |
| Token de uso único | `VerificationToken` | `user_verification_tokens` | `token_hash` | `user_id`→`users` CASCADE | `expires_at` | `consumed_at` |

Três CHECKs do schema moldam o desenho e os testes:

- `token_hash` e `csrf_token_hash` devem casar `^[0-9a-f]{64}$` — o banco recusa
  qualquer coisa que não seja sha256 hex, o que é uma defesa estrutural contra
  gravar token em claro;
- `expires_at > created_at` — **não existe** como inserir algo já vencido. A
  expiração é provada avançando o `now` **injetado**, que é exatamente como o
  domínio a avalia;
- `revoked_at`/`consumed_at` `>= created_at`.

## Por que UM store de token para dois fluxos

O schema tem **uma** tabela discriminada por um enum **fechado**
(`AuthTokenPurpose = email_verification | password_reset`), e o domínio produz a
**mesma** struct (`VerificationTokenRecord`) nos dois fluxos, mudando só o
`purpose`. Dois stores sobre a mesma tabela seriam duplicação; um store "de token
genérico" seria abstração sem dono. `AuthTokenStore` segue o schema.

O `purpose` é **pré-condição de consumo**, não rótulo: entra no `WHERE` do
`UPDATE`. Um token de verificação nunca redefine senha e um de reset nunca
verifica e-mail — provado pelos checks 72 e 85.

## Critério de existência dos métodos

Nenhuma função pura de `auth/` tem chamador em runtime hoje: a camada de
orquestração é C7C. O mesmo já valia para `IdentityStore` em C7B0/C7B1. O
critério aplicado é o que sustentou aquelas unidades: **o método existe quando
uma struct pura já publicada exige exatamente aquela leitura ou escrita.**

| Método | Struct/consumidor que o exige |
| --- | --- |
| `SessionStore.create` | `buildSessionCreation`/`buildSessionRotation` → `SessionRecord` |
| `SessionStore.findByTokenHash` | `evaluateSessionAccess` consome `{ expiresAt, revokedAt }` |
| `SessionStore.revoke` | `planLogout`, `planRevokeAll`, `planRevokeAllAfterSensitiveEvent` → `revokeSessionIds` |
| `SessionStore.listActiveIds` | `planRevokeAll` e `buildPasswordChange` **consomem** `activeSessionIds` |
| `AuthTokenStore.issue` | `buildEmailVerificationIssue`/`buildPasswordResetIssue` → `VerificationTokenRecord` |
| `AuthTokenStore.consume` | `evaluateTokenConsumption` + uso único do schema |
| `AuthTokenStore.invalidatePending` | `applyPasswordReset` → `invalidateAllPendingResetTokens: true` |

**Descartados por falta de consumidor**: `touch`/`lastUsedAt`, `deleteExpired`,
`purgeTokens`, `rotate` (é composição de `create` + `revoke`), `revokeAllForUser`
(subsumido por `listActiveIds` + `revoke`), e `findByTokenHash` no store de
token — ler para depois decidir e escrever abriria a janela de replay que
`consume` fecha atomicamente.

As colunas `last_used_at`, `revoked_reason` e `ip_hash` existem no schema e **não
são escritas**: nenhuma função pura as produz. Campo não se preenche só porque a
tabela o tem.

## Quem decide o quê

`evaluateSessionAccess` recebe `{ expiresAt, revokedAt }` e o status da conta e
decide — com `now >= expiresAt` já expirado. Por isso `findByTokenHash`
**não filtra**: sessão expirada e revogada voltam como `found`. Filtrar no adapter
duplicaria a política em dois lugares e apagaria a distinção entre "expirada" e
"revogada" que alimenta o motivo interno de auditoria.

Já no **consumo de token** a decisão é do banco, e a razão é diferente: uso único
sob concorrência não pode ser decidido em memória. As quatro pré-condições (hash,
purpose, não-consumido, não-expirado) vivem no `WHERE` do `UPDATE` que grava
`consumedAt`. Zero linhas são então classificadas por uma sonda mínima, na mesma
ordem que `evaluateTokenConsumption` usa: `not_found` → `wrong_purpose` →
`already_consumed` → `expired`.

## Tempo

`now` **sempre** entra por parâmetro — `revoke`, `listActiveIds`, `consume` e
`invalidatePending` o recebem. Nenhum adapter lê o relógio. Isso mantém o teste
determinístico e impede uma segunda fonte de "agora" divergindo da política pura.

`listActiveIds` usa `gt` (não `gte`), espelhando `evaluateSessionAccess`: no
instante exato do vencimento a sessão já não é ativa em nenhuma das duas camadas.

## Segredo

O token **cru** nunca chega à persistência: o domínio já o transformou em hash
(`SecretHasherPort`). Os adapters não geram token, não geram hash, não
interpretam e não comparam nada em claro.

`SessionAccessRecord` devolve `{ id, userId, expiresAt, revokedAt }` e mais nada
— sem `tokenHash`, sem `csrfTokenHash`: quem consultou já tem o hash, e devolvê-lo
ampliaria a superfície do segredo sem leitor. O `userId` do consumo de token sai
do **próprio** consumo, porque é a única leitura que amarra o token ao passo
atômico que já venceu.

`csrf_token_hash` é `NOT NULL` sem default, e seria um `PORT_GAP` se o domínio
não o produzisse — mas `buildSessionRecord` o produz. Persistir esse hash **não**
é implementar CSRF.

Nenhum IP em texto claro — e a defesa é **dupla**, de propósito. O domínio
rejeita em `buildSessionRecord`, mas `SessionRecord.ipHash` é `string | null` e a
coluna `ip_hash` **não tem CHECK** no banco: uma composição que montasse o record
à mão gravaria PII em claro em silêncio. O adapter valida a forma antes de
escrever e **falha fechado** (check 90). A revisão adversarial provou que sem essa
segunda linha o IP cru chegava ao disco.

## Conflitos e transações

Vale a regra herdada de C7B1.1 — **expected conflicts must not poison an
interactive transaction**. As duas inserções usam
`createManyAndReturn({ skipDuplicates: true })`; o alvo do conflito é
**confirmado por leitura**, nunca presumido, e uma unique fora do contrato
**falha fechado** (checks 68 e a contraparte de token).

Garantia sob `READ COMMITTED`, com os mesmos limites já documentados em
[`user-product-persistence-adapters.md`](./user-product-persistence-adapters.md):
`REPEATABLE READ` devolve o aborto (`P2034`), e não-abortivo não é
não-bloqueante (`P2028`, `40P01`).

## Composição do reset (provada, não implementada)

`applyPasswordReset` exige três efeitos: trocar a credencial, revogar as sessões
e queimar os demais links pendentes. O reset **não recebe a senha atual**, então
a pré-imagem do CAS vem de `findForVerification` **no mesmo escopo transacional**
— nenhum método novo foi criado para isso.

Provado em PostgreSQL real: consumo + troca comitam juntos (80); uma falha após o
consumo desfaz o consumo e o token **volta a valer** (79); depois do commit o
token é uso único (82); as sessões caem (83). A composição em si é C7C.

## Anti-enumeração

Preservada onde já estava: `evaluateVerificationResend` e
`evaluatePasswordResetRequest` têm um `return` único e sempre devolvem
`{ notice: "sent_if_applicable" }`. Os stores distinguem estados internamente —
`not_found`, `wrong_purpose`, `already_consumed`, `expired` — e nada disso
atravessa DTO público.

Fica registrado um risco que **não** é fechado aqui: o adapter não introduz
atraso artificial, então um oráculo **temporal** continua possível se a
composição fizer mais trabalho no caminho "usuário existe". Mitigação de timing
pertence à borda, não a esta camada.

## Login não é bloqueado por e-mail não verificado

`decideLogin` não recebe nenhuma entrada de verificação. O gate vive em
`canPublishList`, `validateProfileVisibilityTransition` e
`validateContentVisibilityTransition`, que consomem o **carimbo**
`emailVerifiedAt: Date | null` — não um booleano. Esta unidade não altera isso.

## Limitações registradas

- **Tokens de verificação permitem N válidos ao mesmo tempo.** O schema não tem
  unique por `(user, purpose)` e `evaluateVerificationResend` autoriza emitir sem
  olhar pendentes. Queimar o anterior no adapter seria inventar política. Para
  reset a queima existe e é explícita (`invalidatePending`), pedida pelo domínio.
- **`StoredTokenRecord` (domínio) não carrega `userId`.** O contrato de
  persistência o devolve no consumo; o domínio continua recebendo só os três
  campos que conhece, por tipagem estrutural. Nenhum contrato puro foi alterado.
- `TransactionScope` continua um marcador de compilação (ver C7B1).
- **Violação de CHECK aborta a transação.** A garantia de não-abortividade
  cobre *unique* (via `ON CONFLICT DO NOTHING`), não CHECK. Os três `updateMany`
  desta unidade escrevem um `now` vindo do chamador em colunas com
  `>= created_at`: um `now` atrasado em relação à criação da linha viola o CHECK
  e envenena o escopo. Quem compõe deve garantir `now` monotônico.

## Identidade fechada em C7B2.1

O C7B2 entregou sessão e token mas registrou um PORT_GAP: os dois `userId` que
esta camada devolve não tinham destino. **C7B2.1 fechou os dois**, ampliando o
`IdentityStore` existente em vez de criar um store novo — as duas operações são
persistência de identidade.

| Método | Consumidor que o exige | Forma |
| --- | --- | --- |
| `IdentityStore.findById` | `evaluateSessionAccess` exige `userStatus`; `SessionAccessRecord.userId` existe para chegar até aqui | devolve o **mesmo** `IdentityLookupResult` da busca por e-mail — `{ id, status }` e nada mais |
| `IdentityStore.markEmailVerified` | `applyEmailVerification`, após o consumo atômico do token | `verified` / `already_verified` / `not_found` |

`findById` **não filtra** conta desativada: quem decide elegibilidade é
`accountCanHoldSession`. Devolver `not_found` para uma conta que existe mentiria
sobre a existência dela e apagaria a distinção `account_ineligible ≠ not_found`
que alimenta o motivo interno de auditoria (checks 94 e 97).

`markEmailVerified` põe `emailVerifiedAt: null` na **pré-condição** do `UPDATE`.
Isso faz duas coisas de uma vez: torna a operação atômica (duas marcações
concorrentes → uma só grava, check 103) e **preserva o primeiro carimbo**, que é
exatamente a idempotência que `applyEmailVerification` define (`changed=false`
mantém o instante original, check 101). Não há leitura prévia — ler para depois
gravar abriria a janela em que a segunda requisição sobrescreve o carimbo da
primeira.

A taxonomia não foi inventada: `verified`/`already_verified` são o `changed` do
domínio, e o teste contratual (4) prova que as duas camadas concordam.

**Composições provadas em PostgreSQL real:**

- sessão + identidade: sessão ativa e usuário ativo autenticam (95); usuário
  desativado não (97); sessão vencida não (98); e **e-mail não verificado não
  bloqueia** (96);
- token + marcação: os dois efeitos comitam juntos (105); uma falha depois do
  consumo desfaz **os dois** — o token volta a valer e o usuário continua não
  verificado (104); o token é uso único após o commit (106); token de
  `password_reset`, inexistente ou vencido não verificam ninguém (107, 108);
- `already_verified` é outcome esperado e **não envenena** a transação: a query
  seguinte no mesmo escopo funciona (109).

## Leitura do estado de verificação (C7B2.2)

`evaluateVerificationResend` é decisor do **domínio de autenticação** e já era
consumidor publicado — pelo mesmo critério que criou todos os ports anteriores, a
leitura que o alimenta pertence a este bloco, não a listas ou privacidade.

**Identificador: `email_normalized`, não `userId`.** O comando público do reenvio
(`RequestEmailVerificationCommand`) chega **sem sessão**, só com o e-mail — o
`userId` é o que esta leitura *descobre*, não o que ela recebe. Escolher a chave
pela conveniência do adapter teria produzido um método que o fluxo real não
consegue chamar.

A normalização acontece em `parseRequestEmailVerificationCommand`, que chama
`normalizeEmail`. O adapter **não normaliza** — fazê-lo criaria uma segunda
definição de "normalizado", divergente da coluna e do cadastro (check 118 prova
que o e-mail bruto não encontra a conta).

### Método próprio, não ampliação do lookup existente

`findEmailVerificationStateByNormalizedEmail` devolve
`{ userId, emailVerifiedAt }` — um tipo **separado** de `IdentityLookupResult`.
Ampliar aquele resultado faria o caminho de **sessão** e o de **cadastro**
carregarem um carimbo que não consomem; o custo de um tipo a mais é menor que o
de PII trafegando sem leitor.

`userId` está lá porque o passo seguinte (`buildEmailVerificationIssue`) precisa
dele para emitir o token. `status` **entrou** quando `evaluateVerificationResend` passou a aplicar
`accountCanHoldSession` — antes dessa decisão seria campo sem leitor, e não
existir era o correto.

### Fato, não política

O adapter devolve o **carimbo** (`Date | null`), nunca `alreadyVerified: boolean`.
A derivação `alreadyVerified = emailVerifiedAt !== null` é do consumidor. Três
razões:

- o carimbo é o dado persistido real, e o booleano é uma leitura dele;
- converter no adapter faria a persistência decidir política no lugar do domínio;
- o booleano **descarta o quando** — exatamente a informação que
  `markEmailVerified` preserva de propósito ao nunca sobrescrever o primeiro
  instante.

Um teste contratual usa `toBeInstanceOf(Date)` como controle negativo desse
desenho: se alguém trocar o carimbo por booleano, ele reprova.

### Anti-enumeração

A persistência distingue três estados (não verificada / já verificada /
inexistente); a borda **não**. `evaluateVerificationResend` tem um `return`
único e devolve sempre `{ notice: "sent_if_applicable" }`. O check 116 e o teste
contratual (4) provam isso serializando as três respostas públicas e exigindo que
o conjunto tenha **um** elemento, enquanto os motivos internos têm três.

`emailVerifiedAt` não atravessa DTO público — `CurrentUserDto` deriva
`emailVerified: boolean` e descarta o timestamp.


### PORT_GAP remanescente (outro domínio)

`canPublishList`, `validateProfileVisibilityTransition` e
`validateContentVisibilityTransition` consomem o mesmo carimbo, mas por
`userId` e fora de autenticação. Nasce com listas/privacidade (C7B3/C7B4), que
podem reusar o fato já persistido — a escrita e a leitura por e-mail já existem.

## Próximos adapters

Privacidade/LGPD (C7B3), listas e tracking (C7B4), ratings e reviews (C7B5),
recomendações (C7B6). A composição transacional de cadastro, login e reset é C7C.

## Elegibilidade por status — decisão aprovada e fechada

**Só conta elegível por `accountCanHoldSession(status)` recebe token de
verificação ou conclui a verificação.**

| Status | Reenviar | Confirmar |
| --- | ---: | ---: |
| `active` | Sim | Sim |
| `disabled` | Não | Não |
| `deleted` / anonimizada | Não | Não |
| `pending_deletion` | Não | Não |
| Inexistente | Não | Não |

O predicado é o **mesmo** já usado pelo reset de senha — de propósito. Uma
segunda matriz de status para verificação divergiria da de sessão e de reset com
o tempo, e ninguém perceberia até virar bug.

Motivo da regra: marcar o e-mail de uma identidade que já não pode autenticar
recriaria atividade num registro inelegível — no caso de `deleted`, num túmulo
LGPD que existe apenas para auditoria.

Internamente, `disabled` e `deleted` produzem `account_ineligible`; externamente,
**todos** os casos continuam devolvendo a mesma resposta genérica. A recusa da
confirmação usa `GENERIC_TOKEN_FAILURE_MESSAGE`, a **mesma** de
`evaluateTokenConsumption`: uma mensagem própria para "conta inelegível"
transformaria a confirmação num oráculo — quem tivesse um token qualquer
distinguiria "token ruim" de "a conta existe mas está desativada".

Na ordem de avaliação do reenvio, `account_ineligible` vem **antes** de
`already_verified`: uma conta anonimizada pode ter carimbo antigo, e o motivo que
importa registrar é a inelegibilidade.

### A política ficou no domínio

`markEmailVerified` **não filtra status** e continua uma operação atômica e
idempotente de persistência. `accountCanHoldSession` não entra em
`persistence/prisma/`. O adapter entrega o fato (`status` no resultado da
leitura); quem recusa é `evaluateVerificationResend` e `applyEmailVerification`.

`status` passou a existir em `EmailVerificationState` **porque ganhou consumidor
real**. Até esta decisão ele não existia — e não existir era o correto.

### Composição da confirmação: abortar é obrigatório

A ordem é: consumir o token → carregar a identidade pelo `userId` → aplicar a
política com status → marcar **só se elegível**.

Se a política recusar **depois** do consumo, a transação tem de ser **abortada
deliberadamente**. Retornar normalmente comitaria o consumo e queimaria o token
de uma conta que não foi verificada — o usuário perderia o link sem ganhar nada.

Provado em PostgreSQL real: um token emitido antes de a conta ser desativada não
verifica, **e o token continua pendente** com `emailVerifiedAt` ainda `null`
(checks 129–131). Reabilitada a conta, o **mesmo** token conclui a verificação
(check 132) — que é a prova de que o rollback preservou o token de verdade, e não
apenas de que nada aconteceu.

### Dívida registrada, não bloqueante

`users.email_verified_at` não tem CHECK de coerência temporal, embora
`user_sessions` e `user_verification_tokens` tenham os equivalentes. Entra numa
migration de **hardening** futura, não nesta correção.

---

## Atualização C7C — o consumidor de runtime existe

Quando este documento foi escrito, nenhuma função pura de `auth/` tinha chamador
em runtime: a camada de orquestração era "C7C". **C7C existe agora** — ver
[`user-product-auth-runtime.md`](./user-product-auth-runtime.md).

O que mudou aqui:

- **`AuthTokenStore.issue`/`consume`/`invalidatePending`** e
  **`SessionStore.listActiveIds`/`revoke`** deixaram de ser contrato sem leitor:
  são chamados pelos quatro endpoints `/api/auth/**`.
- **A composição da confirmação descrita acima ("abortar é obrigatório") foi
  implementada como descrita**, com o sinal `AuthTransactionAbort`. Os checks
  129–132 continuam sendo a prova em banco real.
- **`AuthThrottleStore` entrou como port novo** (contrato + adapter Prisma sobre
  `user_auth_throttles`, que já existia no schema). Nenhuma migration foi criada.
  Checks 133–141 cobrem o compare-and-swap, o unique `(scope, key)`, o
  `@updatedAt` e a regra de conflito não-abortivo.
- **`buildEmailVerificationIssue`/`buildPasswordResetIssue`** ganharam
  `ttlMinutes` **opcional** (default = as constantes de `policy.ts`), para que o
  prazo venha da configuração de ambiente sem criar uma segunda fórmula de
  validade.

Segue **fora** desta camada, como antes: cookie, sessão HTTP, CSRF e login.
