# Adapters de persistência da user platform (Backend C)

> Índice de estado da camada de persistência: qual domínio tem **contrato**
> (port) e qual já tem **adapter** concreto. Criado no C7B0, atualizado no C7B1.
>
> Regra de leitura: `IMPLEMENTED` em *Contrato* significa que o port existe e é
> testado; `PENDING_*` em *Adapter* significa que **não há** implementação
> Prisma — nada aqui deve ser lido como "pronto para uso". `VERIFIED` em
> *PostgreSQL real* significa que o adapter foi exercitado contra um banco de
> verdade, não contra um mock.

## Matriz

| Domínio | Port | Contrato | Adapter Prisma | PostgreSQL real | Unidade |
| --- | --- | --- | --- | --- | --- |
| identity | `IdentityStore` | IMPLEMENTED (C7B0) | **IMPLEMENTED (C7B1)** | **VERIFIED (53/53)** | C7B1 |
| credential | `PasswordCredentialStore` | IMPLEMENTED (C7B0) | **IMPLEMENTED (C7B1)** | **VERIFIED (53/53)** | C7B1 |
| recommendation snapshot | `RecommendationSnapshotStore` | IMPLEMENTED (C7A) | PENDING_C7B6 | PENDING_C7B6 | C7B6 |
| recommendation feedback | `RecommendationFeedbackStore` | IMPLEMENTED (C7A) | PENDING_C7B6 | PENDING_C7B6 | C7B6 |
| transação (genérico) | `TransactionRunner` | IMPLEMENTED (C7A) | PENDING_C7C | PENDING_C7C | C7C |
| sessões / tokens | — | **PENDING_C7B2** | PENDING_C7B2 | PENDING_C7B2 | C7B2 |
| verificação / recuperação | — | PENDING_C7B2 | PENDING_C7B2 | PENDING_C7B2 | C7B2 |
| privacidade / LGPD | — | PENDING_C7B3 | PENDING_C7B3 | PENDING_C7B3 | C7B3 |
| listas | — | PENDING_C7B4 | PENDING_C7B4 | PENDING_C7B4 | C7B4 |
| tracking | — | PENDING_C7B4 | PENDING_C7B4 | PENDING_C7B4 | C7B4 |
| ratings | — | PENDING_C7B5 | PENDING_C7B5 | PENDING_C7B5 | C7B5 |
| reviews | — | PENDING_C7B5 | PENDING_C7B5 | PENDING_C7B5 | C7B5 |

**Os dois primeiros adapters existem; não há composição de runtime.** Nenhum
`PrismaClient` é criado dentro da user platform, nenhuma conexão é aberta e
nenhuma transação é iniciada pelos adapters — montar cadastro e troca de senha
como operações atômicas é C7C.

## Fronteira arquitetural

```
dominio puro  ->  (não conhece persistência)
persistence/  ->  contratos: types.ts (DTOs/resultados) + ports.ts (interfaces)
persistence/prisma/  ->  (C7B1+) ÚNICO lugar autorizado a importar o client
```

Direção da dependência: `persistence -> domínio`, nunca o contrário. Travado por
`persistence/__tests__/boundary.test.ts`, que varre a fonte real.

O barrel de `persistence/` continua **livre de driver**: quem precisa só dos
contratos importa de lá sem arrastar o Prisma junto. Os adapters são exportados
por `persistence/prisma/index.ts` — separação deliberada, não esquecimento.

## Adapters do C7B1

Arquivos em `services/user-platform/src/persistence/prisma/`:

| Arquivo | Papel |
| --- | --- |
| `executor.ts` | Tipo do executor injetado. |
| `mappers.ts` | Linha do banco → DTO, campo a campo. |
| `identity-conflict.ts` | Qual unique barrou, por leitura (não por erro). |
| `identity-store.ts` | `IdentityStore` concreto. |
| `password-credential-store.ts` | `PasswordCredentialStore` concreto. |

### Executor injetado

`PrismaExecutor` é `Pick<PrismaClient, "user" | "passwordCredential">` — as duas
únicas delegações que esta unidade usa. A consequência importante é que
"o adapter não conecta, não desconecta e não abre transação" deixa de ser uma
promessa em comentário e passa a ser **impossibilidade estrutural**: esses
membros não existem no tipo, então chamá-los não compila. Uma varredura de regex
pode ser contornada por indireção; um tipo que não tem o membro, não.

O Prisma define o client de transação interativa como
`Omit<PrismaClient, ITXClientDenyList>`, e a lista negada contém apenas membros
de ciclo de vida — as delegações de model sobrevivem ao `Omit`. Por isso o
**mesmo** adapter serve o client completo e o client de transação, e a
composição futura escolhe o escopo sem que o adapter mude:

```ts
prisma.$transaction(async (tx) => {
  const identities  = createPrismaIdentityStore(tx)
  const credentials = createPrismaPasswordCredentialStore(tx)
})
```

Essa compatibilidade é verificada em **duas** camadas, porque nenhuma das duas
bastaria sozinha: uma prova de tipo em `prisma/__tests__/adapters.test.ts` (o
validador em `scripts/` é excluído do `tsconfig.json`, logo nenhum compilador o
olha) e o rollback conjunto exercitado em PostgreSQL real.

`TransactionScope` permanece um **marcador de compilação**: ele declara a
intenção de estar numa transação, mas não carrega o client e portanto não pode
*provar* a transacionalidade em runtime. Quem compõe é responsável por passar o
executor certo. Limitação conhecida, registrada aqui em vez de disfarçada.

#### Conflito esperado não envenena a transação

Regra da camada, obrigatória para C7B2–C7B6:

> **EXPECTED CONFLICTS MUST NOT POISON AN INTERACTIVE TRANSACTION.**

O C7B1 descobriu — e o C7B1.1 corrigiu — que converter uma exceção do driver em
resultado tipado **não** desfaz o estrago no banco. Uma violação de constraint
deixa a transação do Postgres em estado `aborted`, e o Prisma **não** emite
`SAVEPOINT` por statement. Capturar o P2002 apenas escondia o problema: a
chamada seguinte no mesmo escopo morria com `25P02`, e um callback que
simplesmente retornasse transformava o `COMMIT` em `ROLLBACK` **silencioso** —
escritas válidas anteriores sumiam sem erro algum.

A correção não é capturar melhor: é **não gerar a violação**.

| Operação | Estratégia | Aborta? |
| --- | --- | --- |
| `IdentityStore.create` | `createManyAndReturn` + `skipDuplicates` (`INSERT ... ON CONFLICT DO NOTHING RETURNING`) | Não |
| `PasswordCredentialStore.createInitial` — 1:1 | idem | Não |
| `PasswordCredentialStore.createInitial` — usuário ausente | sonda de existência **antes** do insert | Não |
| `replaceByPreimage` | `updateMany` com pré-imagem no `WHERE` | Não (já era) |
| Erro não previsto pelo contrato | propaga intacto | Sim — e **deve** |

**Duas ressalvas que a tabela acima não cobre, ambas medidas em banco real.**

*Não-abortivo não é não-bloqueante.* `ON CONFLICT DO NOTHING` **espera** o
inseridor concorrente terminar antes de decidir (medido: ~2,4 s com a outra
transação segurando). Sob contenção isso pode estourar o timeout de transação do
Prisma (`P2028`) ou entrar em **deadlock** (`40P01`) quando duas transações
inserem os mesmos e-mails em ordem oposta. Os dois abortam. Não é regressão — o
`create` cru bloqueava e deadlockava igual —, mas quem compuser precisa saber que
"não aborta por conflito" não significa "nunca aborta".

*A garantia é de `READ COMMITTED`.* Sob `REPEATABLE READ`/`SERIALIZABLE` o
próprio `INSERT` levanta `40001` (Prisma `P2034`) quando a linha conflitante foi
comitada depois do snapshot — o conflito volta a ser abortivo e nem chega às
sondas de rótulo (check 53). Endurecer o isolamento do cadastro invalida a regra
desta seção; a decisão exige reler isto antes.

Zero linhas devolvidas = conflito. Quem decide criado-ou-conflito continua sendo
o **banco**, atomicamente, no mesmo comando que grava — não há leitura prévia,
logo não há corrida introduzida. Nenhum adapter desta camada tem mais um `catch`
que retorna: **exceção deixou de ser fluxo de controle**, e o módulo
`error-mapping.ts` foi removido por ter ficado sem uso.

A única exceção deliberada é a **chave estrangeira**: `ON CONFLICT DO NOTHING`
neutraliza unicidade, não FK. Como `user_not_found` é um resultado previsto pelo
contrato, ele passou a vir de uma sonda de existência pela PK — a leitura mais
barata possível, sem PII. Isso **não** é um precheck de unicidade disfarçado: a
unicidade continua decidida pelo banco. Se o usuário sumisse entre a sonda e o
insert, o P2003 voltaria e **deve mesmo** falhar fechado, por ser violação de
invariante; na prática não ocorre, porque a exclusão LGPD anonimiza e mantém a
linha (`deleted_at`), nunca a apaga.

Provado em PostgreSQL real pelos checks 42–53: resultado tipado dentro da
transação, alvo semântico preservado, transação **usável** depois do conflito
(lê e escreve), `COMMIT` real com as escritas de antes **e** de depois, FK sem
abortar, erro inesperado ainda escapando com `ROLLBACK` — e uma **fixture
negativa** (check 50) que executa o padrão antigo de propósito e confirma que ele
*continua* envenenando. Sem ela, os outros oito poderiam estar verdes por
qualquer motivo.

### Mappers e selects

Todo acesso usa `select` explícito, e o DTO é montado **campo a campo** — sem
spread e sem `include`. Assim, acrescentar uma coluna ao schema não
vaza sozinho para o domínio. `create` também carrega `select`: sem ele o Prisma
devolveria a linha inteira da credencial, **com o hash**, para um chamador que
não pediu por ele.

O status é traduzido por um `Record<$Enums.UserStatus, UserStatus>`: um valor
novo no enum do Prisma passa a quebrar o **typecheck** em vez de cair num
`default` silencioso. Valor fora do domínio falha fechado — nunca vira `active`,
porque um status desconhecido tratado como ativo daria sessão a uma conta que o
produto talvez tenha desativado.

### Conflitos sem vazamento

`ON CONFLICT DO NOTHING` não diz **qual** unique barrou. O rótulo semântico passa
a vir de leitura, em `identity-conflict.ts`, e a troca é favorável: o
**resultado** (criou / não criou) continua decidido atomicamente pelo banco; as
leituras apenas rotulam um conflito que já aconteceu, e por isso não introduzem
corrida no controle de fluxo. Antes, o rótulo saía de `meta.target` — o que
exigia deixar a violação acontecer, e era exatamente o que abortava a transação.

A ordem das sondas é semântica, não estilo. Quando as **duas** colunas colidem —
o caso comum, porque o mesmo endereço costuma repetir bruto e normalizado — o
rótulo é `identity.emailNormalized`: é a chave de identidade da conta, a que
fecha o canal de enumeração e a que `decideSignup` consulta. Dizer
`identity.email` ali descreveria o acidente (a grafia) em vez do fato (a conta já
existe).

Nenhuma sonda encontrar **não** é "a vencedora ainda não está visível": sob
`READ COMMITTED` o `INSERT` só retorna depois que o inseridor concorrente termina,
e o statement seguinte enxerga o que ele comitou. Significa que a colisão veio de
uma unique que não é de e-mail. Como isso não tem resultado tipado possível, o
adapter falha fechado em vez de inventar um rótulo — ou, pior, de afirmar um
conflito de e-mail que não existe.

Nome de constraint, índice, tabela, SQL e código do driver não saem da camada —
agora trivialmente, porque a camada não olha mais para o erro do driver.

Na credencial o rótulo **também** é confirmado por leitura, e a primeira versão
desta unidade errava aqui: `ON CONFLICT DO NOTHING` sem alvo absorve **toda**
unique da tabela, **inclusive a PK**. Com a sequence dessincronizada (restore mal
feito), uma colisão de chave primária devolve zero linhas — e responder
`already_exists` afirmaria que o usuário já tem credencial quando ele **não**
tem: ele ficaria com identidade e sem senha, sem conseguir entrar, e toda
retentativa repetiria o mesmo diagnóstico errado.

Por isso, zero linhas sem credencial existente **falha fechado** (checks 51 e 52).
Vale a mesma regra do `count > 1` no CAS: estado sem resultado tipado possível
não vira valor de contrato. O mesmo se aplica à identidade — nenhuma sonda
encontrar significa "a colisão não foi de e-mail", e devolver `unique_violation`
ali diria ao usuário que o e-mail dele está tomado quando está livre.

`identity.handle` permanece na união para os adapters futuros, mas é
estruturalmente inalcançável aqui: este adapter nunca escreve `handle`, a coluna
nasce `NULL` e o índice único trata `NULL`s como distintos. Não é investigado
pelas sondas, e o documento não o vende como verificado.

### Compare-and-swap da senha

A pré-imagem entra no `WHERE`, não numa comparação em memória — ler-comparar-
gravar abriria uma janela TOCTOU em que duas trocas concorrentes leem o mesmo
hash e ambas gravam, e a segunda sobrescreveria a primeira em silêncio.

`updateMany` (não `update`) porque só ele aceita pré-condição além da chave; e,
ao contrário de SQL cru, honra o `@updatedAt` do modelo — `updated_at` é
`NOT NULL` **sem default** no banco, então SQL cru teria de preenchê-la à mão.

`count = 0` tem duas causas e o contrato as separa: uma sonda posterior lê
**apenas a existência** (`select: { id: true }`, jamais o hash) para distinguir
`not_found` de `stale_preimage`. A sonda nunca pode transformar corrida em
sucesso — qualquer resultado dela é conflito ou ausência. `count > 1` é
impossível sob o unique de `user_id`: falha fechado, com mensagem que não carrega
id, hash nem SQL.

### Cadastro não é idempotente (por ora)

Não há chave de idempotência em identidade nem em credencial, então **replay é
indistinguível de colisão real** — e o adapter trata os dois como conflito.
Converter `unique_violation` em "já existe, tudo certo" inventaria uma
idempotência que o contrato não tem. Registrado como PORT_GAP deliberado em
C7B0; se o C7C precisar distinguir, a chave terá de vir do comando.

### Validação

```bash
pnpm --filter @screena/user-platform validate:user-product
```

53/53 em PostgreSQL 16 efêmero. Cobre: e-mail bruto e normalizado persistidos
separadamente, defaults do banco, busca que **não** aceita o e-mail bruto como
fallback, FK, relação 1:1,
`algorithm` gravado a partir do port, CAS bem-sucedido e divergente,
`@updatedAt` aplicado pelo `updateMany`, disputa entre operações simultâneas
(identidade, credencial inicial e troca de senha, sempre com exatamente um
vencedor e a linha única no banco) e rollback conjunto das duas escritas do
cadastro.

Sobre os testes de disputa, uma precisão que vale registrar: eles são
despachados com `Promise.all` sobre um único client, e **não** garantem
sobreposição temporal — o pool pode serializá-los. Isso não enfraquece a prova,
porque o que garante o resultado não é o entrelaçamento e sim a **trava do
banco**: o `UNIQUE` rejeita o segundo `INSERT` e o `WHERE` da pré-imagem não
casa mais depois da primeira troca. O desenho é correto *independentemente* de
as operações se sobreporem — e é exatamente isso que os checks demonstram.
Afirmar "concorrência real" seria dizer mais do que o teste sustenta.

O gate levantado antes desta unidade está fechado: `algorithm` é
`TEXT NOT NULL DEFAULT 'scrypt'` — a coluna tem default no banco (check 18
prova), **e** os contratos de escrita (`CredentialCreateInput.algorithm`,
`CredentialReplaceInput.nextAlgorithm`) já carregam o rótulo. O que o C7B0
removeu foi apenas o `algorithm` do material de **verificação**, que é leitura.
Não há PORT_GAP: o adapter grava o valor recebido e **não** o infere do PHC.

## Detalhe por contrato

- **Identidade e credencial**: ver
  [`user-product-identity-credential-ports.md`](./user-product-identity-credential-ports.md)
  (DTOs, conflitos com alvo semântico, compare-and-swap da senha, método único
  autorizado a devolver o hash).
- **Recomendações**: ver
  [`user-product-persistence-decisions.md`](./user-product-persistence-decisions.md)
  §3 (snapshot vigente por `(user_id, context)`, `fingerprint` nullable) e §5.1
  (identidade idempotente dos eventos de tracking).

## Pré-condições que o C7B1+ **deve** honrar

1. `fingerprint IS NULL` num snapshot significa **não-equivalente** — jamais
   `noop` (serviria recomendação velha para sempre).
2. Replay de tracking compara **pré-imagem**; `occurredAt` participa da
   equivalência, não da identidade.
3. Identidade de viewing event = `(user_id, idempotency_key, event_type)`.
4. Ratings e reviews não têm coluna `version`: conflito por compare-and-swap
   sobre a pré-imagem.
5. `IdentityRecord` nunca carrega hash; só `findForVerification` o devolve.
6. **Conflito esperado não pode envenenar uma transação interativa.**
   Resultado previsto pelo contrato nunca nasce de `catch`: use operação
   não-abortiva (`ON CONFLICT DO NOTHING`, `updateMany` com pré-imagem,
   sonda de existência). Violação de constraint deixa a transação `aborted`
   e o Prisma não usa savepoint por statement — capturar não conserta.
   Vale sob `READ COMMITTED`; isolamento mais forte devolve o aborto (`P2034`).
   Travado por guarda de fronteira e pelos checks 42–53.
7. **Estado sem resultado tipado possível falha fechado.** Zero linhas de um
   `ON CONFLICT DO NOTHING` não identifica qual unique barrou: confirme o alvo
   por leitura antes de afirmá-lo. Sem confirmação, `throw` — nunca devolva um
   conflito que o chamador vai reportar como fato ao usuário.

## Próximos adapters

O roadmap por domínio continua na coluna *Unidade* da matriz. O que o C7B1
deixa pronto para as unidades seguintes:

- o diretório `persistence/prisma/` e sua fronteira (guardas com **controle
  negativo**, que reprovam fonte sintética defeituosa — antes elas só provavam
  que a varredura não estava vazia);
- o padrão de executor injetado, que C7B2..C7B6 devem seguir sem criar client;
- o padrão de conflito por alvo semântico e de CAS por pré-imagem;
- o validador em PostgreSQL real como script do próprio pacote.

Pendências conhecidas, **fora** do escopo desta unidade:

- não há alias do validador no `package.json` da raiz (os demais serviços têm);
  o `README.md` do pacote cita `pnpm validate:user-product-platform`, que não
  existe como script de raiz;
- `services/**/scripts/**` é excluído do `tsconfig.json`, então o validador não
  é typechecked — daí as provas de tipo viverem no teste.
