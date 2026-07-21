# Ports de persistência — identidade e credencial (Backend C — C7B0)

> Fecha o **PORT_GAP** que bloqueou o C7B1: os contratos de persistência de
> identidade e credencial **não existiam** (o C7A criou apenas os três contratos
> de recomendações). Esta unidade é **puramente contratual** — sem Prisma, sem
> adapter, sem SQL, sem migration, sem alteração de schema.

## 1. Objetivo

Dar ao C7B1 um alvo concreto: interfaces, DTOs e resultados tipados suficientes
para implementar os adapters Prisma de identidade e credencial **mecanicamente**,
sem inventar comportamento dentro da infraestrutura.

## 2. Fluxos consumidores (as operações foram DERIVADAS daqui)

Nenhum método foi criado sem consumidor real.

| Fluxo | Origem | Leitura necessária | Escrita necessária |
| --- | --- | --- | --- |
| Cadastro | `decideSignup` (`auth/flows.ts:47`) | existe identidade com este `emailNormalized`? | criar identidade + criar credencial inicial |
| Login | `decideLogin` (`auth/flows.ts:95`) | existência + `status`; hash para verificação | — |
| Verificação de senha | `authenticatePassword` (`auth/credentials.ts:58`) | `storedHash` | — |
| Troca de senha | `buildPasswordChange` (`auth/credentials.ts:80`) | hash atual (pré-imagem) | substituir credencial |

`SignupCommand` (`contracts/auth-commands.ts:41`) carrega `email`,
`emailNormalized`, `password` e `displayName` — **não** carrega `handle`.
`ChangePasswordCommand` carrega `currentPassword` e `newPassword`: a pré-imagem
do CAS é o hash que o chamador **acabou de ler e verificar**.

## 3. DTOs de identidade — shapes completos

### `IdentityRecord` (retorno)

```ts
interface IdentityRecord {
  readonly id: bigint;        // chave do dono: busca da credencial; futura sessão
  readonly status: UserStatus; // único campo que decideLogin consulta
}
```

**Excluídos por não terem consumidor** nestes fluxos: `email` bruto,
`emailNormalized` (quem consultou já o tem — devolvê-lo seria PII sem leitor),
`handle`, `displayName`, `role`, `emailVerifiedAt`, `createdAt`, `updatedAt`,
`deletedAt`, perfil, preferências, privacidade e estatísticas. **Nunca** contém
`passwordHash`, `algorithm` nem token — travado por teste falsificável.

### `IdentityCreateInput` (escrita)

```ts
interface IdentityCreateInput {
  readonly email: string;           // -> users.email            (unique próprio)
  readonly emailNormalized: string; // -> users.email_normalized (unique próprio)
  readonly displayName: string | null; // -> users.display_name
}
```

**E-mail bruto × normalizado:** os dois são passados **explicitamente** porque
são **colunas distintas com uniques distintos** (`users_email_key` e
`users_email_normalized_key`). O adapter do C7B1 **não pode** reconstruir um a
partir do outro nem gravar o mesmo valor nas duas colunas: recebe ambos prontos.
**O adapter não normaliza nada** — a normalização é do domínio
(`auth/identity.normalizeEmail`).

**`displayName`:** é coluna de `users` (`display_name`, nullable) e é
**persistido por `IdentityStore.create`** — não some entre `decideSignup` e a
persistência. Vem de `SignupCommand.displayName`. Não há port de perfil nesta
unidade e nenhum é necessário para este campo.

`status`/`role` **não** entram: o schema tem defaults (`active`/`user`) e
permitir defini-los criaria operação administrativa que nenhum fluxo pede.
`handle` **não** entra porque o cadastro não o define (`SignupCommand` não o tem).

## 4. Port de identidade — `IdentityStore`

| Método | Resultados |
| --- | --- |
| `create(scope, input)` | `created` \| `conflict` (com alvo semântico) |
| `findByNormalizedEmail(scope, emailNormalized)` | `found` \| `not_found` |

Deliberadamente **ausentes**: `update` genérico, `delete`, listagem, busca por
`handle`, `markEmailVerified` e `transitionStatus` — sem consumidor aqui
(verificação é C7B2; LGPD é C7B3). Sem CRUD genérico, sem método administrativo.

## 5. DTOs de credencial

O schema mantém **uma** credencial por usuário (1:1, unique em `user_id`).
Nenhum histórico, versão ou rotação foi inventado.

| Tipo | Uso |
| --- | --- |
| `CredentialCreateInput` | `{ userId, passwordHash, algorithm }` — cadastro |
| `CredentialVerificationMaterial` | `{ passwordHash }` — **único** portador do hash |
| `CredentialReplaceInput` | `{ userId, expectedPasswordHash, nextPasswordHash, nextAlgorithm }` — CAS |

`algorithm` é o rótulo derivado pelo **domínio** do prefixo do PHC
(`credentials.ts:48`); o port o trata como string opaca e **não** o interpreta.
Permanece `string` (não enum) porque nenhuma decisão de produto fixou o conjunto
e o schema também usa `String` — transformá-lo em enum aqui obrigaria o port a
validar/interpretar o PHC, contradizendo a regra do hash opaco.

`algorithm` aparece nas **entradas de escrita** (é coluna real que precisa ser
gravada) mas **não** no material de verificação: `authenticatePassword` só
recebe `storedHash`, e até um futuro *rehash-on-login* lê os parâmetros de
dentro do próprio PHC. Transportá-lo ampliaria a superfície do único struct que
carrega segredo, sem leitor.

## 6. Port de credencial — `PasswordCredentialStore`

| Método | Resultados |
| --- | --- |
| `createInitial` | `created` \| `already_exists` (alvo `credential.user`) \| `user_not_found` (FK) |
| `findForVerification` | `found` \| `not_found` |
| `replaceByPreimage` | `updated` \| `not_found` \| `conflict` (`stale_preimage`) |

Sem delete destrutivo, sem listagem, sem histórico, sem rotação automática, sem
geração de hash, sem validação de senha.

### Método autorizado a retornar o hash

**Somente `findForVerification`.** Existe para alimentar `authenticatePassword`,
que compara em tempo constante dentro da porta de verificação. O resultado nunca
deve ser logado nem embutido em mensagem de erro.

## 7. Compare-and-swap da senha

`user_password_credentials` **não tem coluna `version`** (registrado no C7A
§3.9), então a pré-imagem é o **próprio hash atual**:

```
replaceByPreimage({ userId, expectedPasswordHash, nextPasswordHash, nextAlgorithm })
  -> updated    quando o hash vigente == expectedPasswordHash
  -> conflict   (stale_preimage, alvo credential.passwordHash) caso contrário
  -> not_found  quando não há credencial
```

Isso elimina o *last-write-wins* silencioso: duas trocas concorrentes lendo o
mesmo hash produzem uma `updated` e uma `conflict`.

## 8. Conflitos — alvo semântico, sem vazar SQL

`users` tem **três** uniques concorrentes (`email`, `email_normalized`,
`handle`), então "duplicate" não basta. A escolha foi a **menor alteração
não-destrutiva**: manter `PersistenceConflictReason` intacto e acrescentar um
discriminador **opcional**, **acoplado à razão pelo próprio tipo**:

```ts
type UniqueConflictTarget =
  | "identity.email" | "identity.emailNormalized" | "identity.handle" | "credential.user";
type PreimageConflictTarget = "credential.passwordHash";
type PersistenceConflictTarget = UniqueConflictTarget | PreimageConflictTarget;

type PersistenceConflict =
  | { reason: "unique_violation"; target?: UniqueConflictTarget }
  | { reason: "stale_preimage";   target?: PreimageConflictTarget }
  | { reason: "expected_current_mismatch" | "idempotency_content_mismatch" };
```

- **Uniões fechadas**, nunca string livre.
- **Acoplamento real, não prometido em comentário:** o typecheck rejeita pares
  sem sentido (`expected_current_mismatch` + `identity.handle` não compila) e
  `credential.passwordHash` só existe sob `stale_preimage` — portanto **não
  sugere que o hash tenha unique**; é apenas o valor comparado no swap.
- **`stale_preimage` ≠ `unique_violation`**: razões distintas, alvos distintos.
- **Compatibilidade retroativa:** nenhuma razão foi removida ou renomeada e o
  alvo é opcional — os contratos de recomendações do C7A seguem válidos.
- **Sem campo de texto livre.** O antigo `detail?: string` foi **removido**: era
  um canal por onde um adapter poderia vazar hash ou e-mail em log/erro, fora do
  alcance de qualquer varredura de fonte. O alvo semântico já carrega o
  necessário.

**`identity.handle` está reservado, não em uso:** nenhum método desta unidade
cria ou atualiza `handle` (o cadastro não o define). O alvo existe porque o
unique é real (`users_handle_key`) e para que C7B2+ não precise mexer na
taxonomia. Isso é declarado, não implícito.

Nunca expor nome de constraint, índice, tabela, host, banco, SQL ou código do
driver. **Isto não é política de resposta pública**: a borda HTTP (unidade
futura) decidirá se reduz a informação para evitar enumeração de contas.

## 9. Not found, idempotência e concorrência

- `not_found` é **resultado normal**, nunca exceção, e é distinto de `conflict`.
- Nenhum retorno usa `null` para significar duas coisas.
- Idempotência do cadastro não é do port: `decideSignup` já converte e-mail
  existente em `notice_existing_email`; se ainda assim houver corrida, o port
  devolve `conflict` com alvo — o chamador decide.
- Concorrência real (duas criações simultâneas, duas trocas simultâneas) será
  provada em **PostgreSQL 16 no C7B1**; aqui ela é provada apenas como
  *contrato* (os resultados existem e são distinguíveis).

## 10. Transações futuras (C7C)

Os ports recebem `TransactionScope` (opaco, já existente) e **não** abrem
transação. As composições atômicas ficam para o C7C:

- **Cadastro**: criar identidade → criar credencial (mesma transação).
- **Troca de senha**: ler credencial → verificar → `replaceByPreimage` →
  revogar sessões (o port de sessões é C7B2).

`TransactionRunner` (de recomendações) não foi deformado: continua com sua
assinatura original.

## 11. Segredos

- Senha em texto claro **nunca** atravessa os ports — só `passwordHash`.
- O port não gera hash, não verifica senha, não interpreta PHC, não extrai
  parâmetros de scrypt.
- `IdentityRecord` não tem hash. **Falsificabilidade verificada por controle
  negativo**, em dois cenários distintos:
  - injetar `passwordHash` em `IdentityRecord` (interface) reprova os checks 9 e 10;
  - injetar `passwordHash` no ramo `found` de `IdentityLookupResult` (**type
    alias de união**) reprova o check 10 — a guarda varre `export interface`
    **e** `export type`, e detecta o hash como **campo declarado**, não como
    menção textual (senão o próprio rótulo `"credential.passwordHash"` seria
    falso positivo).
  - acrescentar `newPassword: string` (nome canônico do repo, vocabulário da
    C7B2) a qualquer contrato reprova o check 7 — a guarda proíbe **qualquer**
    campo terminado em `password`, permitindo apenas os terminados em `Hash`.
- Nenhum contrato menciona token de sessão, recuperação ou verificação.
- Nenhum contrato de conflito tem campo de texto livre (check 11).

## 12. Relação com o schema (nenhuma alteração)

| Contrato | Tabela | Constraint relevante |
| --- | --- | --- |
| `IdentityStore` | `users` | `users_email_key`, `users_email_normalized_key`, `users_handle_key` |
| `PasswordCredentialStore` | `user_password_credentials` | unique em `user_id` (1:1), FK → `users` |

Schema e migrations **intactos** nesta unidade.

## 13. Operações excluídas e lacunas

**POLICY_GAP** (não decididos; não inventados aqui): histórico de credenciais,
múltiplas credenciais ativas, provedores externos, troca de e-mail, definição de
`handle`, hard delete de identidade, reativação administrativa, MFA, passkeys,
rotação automática de senha.

**PORT_GAP remanescente (esperado)**: sessões, tokens, verificação, recuperação,
privacidade, listas, tracking, ratings e reviews continuam sem port — são as
unidades C7B2..C7B6.

**PORT_GAP registrado (não resolvido aqui, de propósito)**: identidade e
credencial **não têm chave de idempotência**, então uma re-tentativa do mesmo
cadastro é indistinguível de uma colisão real — ambas retornam `conflict` /
`already_exists`. Isso é fiel aos fluxos atuais (`SignupCommand` não carrega
chave de idempotência e `decideSignup` já converte e-mail existente em
`notice_existing_email` **antes** do port). Inventar uma chave aqui seria criar
política sem fluxo consumidor. Se o C7C precisar distinguir replay de colisão,
a decisão é dele — e exigirá uma chave vinda do comando.

**Assimetria deliberada**: a pré-existência aparece como `already_exists` (kind
próprio) na credencial e como `conflict` + `target` na identidade. Ambas são
tipadas e distinguíveis; a diferença existe porque a credencial tem **um** único
modo de colisão (1:1 por usuário) enquanto a identidade tem três.

**SCHEMA_GAP**: nenhum novo nesta unidade.

## 14. Plano do C7B1

1. `persistence/prisma/` com executor injetado (aceitando client e
   `TransactionClient`), sem criar `PrismaClient` nem conectar/desconectar.
2. Implementar `IdentityStore` e `PasswordCredentialStore` com `select`
   explícito e mappers (nunca devolver model Prisma).
3. Mapear erro do driver → `PersistenceConflict` com `target` correto,
   traduzindo a violação de unique **sem** expor o nome da constraint.
4. Provar em PostgreSQL 16: conflito por e-mail, por e-mail normalizado,
   `not_found`, FK, CAS bem-sucedido, CAS divergente e concorrência real.
