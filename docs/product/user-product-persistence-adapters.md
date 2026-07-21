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
| identity | `IdentityStore` | IMPLEMENTED (C7B0) | **IMPLEMENTED (C7B1)** | **VERIFIED (43/43)** | C7B1 |
| credential | `PasswordCredentialStore` | IMPLEMENTED (C7B0) | **IMPLEMENTED (C7B1)** | **VERIFIED (43/43)** | C7B1 |
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
| `error-mapping.ts` | Erro do driver → conflito tipado. |
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

#### Dentro de transação, conflito é TERMINAL

Achado desta unidade, reproduzido em PostgreSQL real (checks 42 e 43): quando
estes adapters **capturam** um P2002/P2003 e o convertem em valor de contrato
(`conflict` / `already_exists` / `user_not_found`), a transação do Postgres já
ficou **abortada**. O Prisma não emite `SAVEPOINT` por statement, então o erro do
banco não é desfeito só porque o adapter parou de propagá-lo. A partir dali:

- a próxima chamada no mesmo escopo lança `25P02` **cru**, em vez de devolver um
  resultado de contrato — o tipo de retorno passa a mentir;
- pior: se o callback apenas **retornar** depois de engolir o conflito, o
  `COMMIT` vira `ROLLBACK` e as escritas anteriores bem-sucedidas somem **sem
  nenhum erro**.

Isto **não é defeito dos adapters** — isolados, eles honram o contrato, e é
exatamente por isso que o problema é fácil de não ver. É uma propriedade do
Postgres que a composição precisa conhecer **antes** de ser escrita. Quem compuser
(C7C) deve encerrar o escopo ao receber conflito, propagando-o para fora da
transação, ou isolar a tentativa num savepoint próprio; o adapter não pode fazer
isso porque o executor deliberadamente não expõe `$executeRaw`.

Os dois checks são de **caracterização**: se um dia o driver passar a isolar cada
statement, eles falham de propósito — é o gatilho para reler esta seção antes de
alguém confiar no comportamento antigo.

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

`meta.target` não tem forma estável entre versões do driver: pode ser campo do
modelo, coluna do banco ou nome da constraint. O classificador normaliza as três
e casa por substring, **do mais específico para o menos**. Isso não é estilo:
`email_normalized` **contém** `email`, e testar `email` primeiro reportaria toda
colisão de e-mail normalizado como colisão de e-mail bruto — dois uniques
distintos colapsados num alvo só, com a guarda verde porque "algum alvo" foi
devolvido. Nesta versão do driver a forma observada é a lista de colunas
(`["email"]`), mas o adapter não depende disso.

Alvo irreconhecível vira `unique_violation` **sem** `target` (o campo é
opcional), nunca um chute. Nome de constraint, índice, tabela, SQL e código do
driver não saem do módulo. Erro que não seja P2002/P2003 **sobe intacto**:
traduzi-lo seria transformar falha de infraestrutura em resultado de negócio.

Os dois adapters tratam o alvo irreconhecível de forma **diferente**, e a
assimetria é do contrato, não descuido. Em identidade, `conflict` +
`unique_violation` continua verdadeiro seja qual for a coluna que barrou. Em
credencial, o kind é `already_exists`, que afirma algo específico — "já existe
credencial para este usuário (1:1)". Uma unique *diferente* (a PK, depois de um
restore que deixou a sequência dessincronizada) também chega como P2002, e
respondê-la com `already_exists` afirmaria um fato **falso**: o cadastro seria
abortado por causa errada e nenhuma retentativa corrigiria. Sem representação no
contrato, esse erro sobe intacto.

Só dois dos três alvos de identidade são exercitáveis contra o banco: o adapter
nunca escreve `handle`, então `users_handle_key` não tem como ser violado por
ele. A classificação de `identity.handle` existe (o alvo é reservado em C7B0) e
é coberta por teste com erro sintético — não por PostgreSQL real. Dizer o
contrário seria vender como verificado algo que não é.

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

43/43 em PostgreSQL 16 efêmero. Cobre: e-mail bruto e normalizado persistidos
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
6. **Dentro de transação, conflito é terminal**: um P2002/P2003 capturado por um
   adapter deixa a transação abortada (o Prisma não usa savepoint por statement).
   Ao receber conflito, encerre o escopo propagando-o — continuar a usar o mesmo
   `tx` produz `25P02` cru ou, pior, `COMMIT` que vira `ROLLBACK` silencioso.
   Provado pelos checks 42 e 43.

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
