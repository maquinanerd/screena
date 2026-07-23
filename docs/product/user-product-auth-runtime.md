# Runtime de autenticação por e-mail (Backend C — C7C)

> A primeira unidade da user platform que **executa**: quatro endpoints HTTP
> reais, um provedor de e-mail transacional, throttle durável e a composição que
> liga tudo ao PostgreSQL.
>
> As unidades anteriores entregaram domínio puro (C7A/C7B0) e adapters Prisma
> (C7B1/C7B2). Nenhuma delas tinha chamador em runtime. Esta tem.
>
> Configuração operacional e diagnóstico:
> [`docs/operations/brevo-transactional-email.md`](../operations/brevo-transactional-email.md).

---

## 1. Endpoints

| Método e rota | O que faz | Resposta de sucesso |
| --- | --- | --- |
| `POST /api/auth/password-reset/request` | pede recuperação de senha | **202** genérico |
| `POST /api/auth/password-reset/confirm` | consome o token e troca a senha | **200** `{ ok, status: "confirmed" }` |
| `POST /api/auth/email-verification/request` | pede (re)envio da verificação | **202** genérico |
| `POST /api/auth/email-verification/confirm` | consome o token e carimba o e-mail | **200** `{ ok, status: "confirmed" }` |

As páginas que recebem os links:

- `/pt/verificar-email/` — confirma na montagem;
- `/pt/redefinir-senha/` — pede a nova senha e só então confirma.

**Nenhum e-mail é enviado no login.** O login não faz parte desta unidade.

### Por que link abre página e a página faz POST

Um `GET` que consumisse o token seria disparado por qualquer pré-fetch de cliente
de e-mail, antivírus corporativo ou scanner de link — queimando o link **antes**
de o usuário clicar. O link abre uma página; a mutação é sempre `POST`.

Na página de **recuperação** o token não é consumido na montagem, e sim no envio
do formulário: consumi-lo antes de a pessoa digitar a senha queimaria o link à
toa.

### O token sai da URL

As duas páginas, ao montar, leem o token da query e o removem da barra de
endereços com `history.replaceState`, sem recarregar e sem criar entrada nova no
histórico. As duas declaram `referrer: no-referrer` e `noindex, nofollow`.

Motivo: a barra de endereços é copiada e compartilhada, o valor fica no histórico
mesmo depois do uso, e qualquer navegação seguinte poderia levá-lo num `Referer`.

---

## 2. Arquitetura em camadas

```
apps/web/app/api/auth/**/route.ts        delegador de 3 linhas
        |
apps/web/src/server/auth/runtime.ts      ponte server-only (única de apps/web)
        |
services/user-platform/src/
  auth-runtime/composition.ts            LÊ process.env, cria Prisma e Brevo
        |
  http/handlers.ts                       (Request) => Response, sem framework
        |
  auth-runtime/{email-verification,password-recovery}.ts
        |                                orquestração; nenhuma regra própria
        +-- auth/*                       decisores PUROS (C7B)
        +-- persistence/ports.ts         portas (C7A)
        +-- email/types.ts               port de e-mail (agnóstico)
                |
  providers/brevo/transactional-email.ts ÚNICO arquivo que conhece a Brevo
```

### O que cada fronteira garante

| Fronteira | Garantia | Como é provada |
| --- | --- | --- |
| domínio ⇏ Brevo | nenhum domínio puro cita Brevo, endpoint ou `api-key` | varredura de fonte + controle negativo |
| persistência ⇏ Brevo | idem | varredura |
| provedor ⇏ Prisma | `providers/` não importa driver, banco nem `process.env` | allowlist de imports |
| `process.env` | lido **só** em `auth-runtime/composition.ts` | varredura com igualdade exata |
| chave da Brevo | só em provider + config + composição | varredura com igualdade exata |
| render ⇏ user platform | página/layout/client component nunca importam | `tests/governance/user-platform-privacy.test.ts` |

Todas em
[`services/user-platform/src/auth-runtime/__tests__/boundary.test.ts`](../../services/user-platform/src/auth-runtime/__tests__/boundary.test.ts)
e em `tests/governance/user-platform-privacy.test.ts`, cada uma com controle
negativo — uma fonte sintética que a guarda **precisa** acusar.

### Por que a borda HTTP mora em `services/`, não em `apps/web`

O vitest do monorepo **não** roda `apps/web`. Qualquer regra escrita numa rota do
Next nasceria sem teste. Os handlers são `(Request) => Promise<Response>` puros de
framework, testados com `Request`/`Response` de verdade; as rotas do Next são
arquivos de três linhas que delegam.

### Isto não é render

A invariante 3 governa o **render de página pública indexável**: essas páginas
leem apenas PostgreSQL/cache local. Os quatro endpoints são **mutações `POST`**
sob `/api/`, bloqueadas no robots (`Disallow: /api/`) e nunca alcançadas por
página indexável. Um endpoint de autenticação que precisa entregar um e-mail não
tem como ser worker offline sem uma tabela de **outbox** — que esta unidade
deliberadamente não cria.

---

## 3. Ordem canônica: banco primeiro, fornecedor depois

```
1. parse do comando (contracts/, allow-list estrita)
2. throttle durável
3. localizar identidade
4. o DOMÍNIO decide se emite
5. gerar token CRU  ->  6. hash  ->  7. persistir (transação curta)
8. COMMIT
9. montar o link
10. AGENDAR a entrega       <- fora da transação E fora da resposta
11. responder genérico      <- não espera o fornecedor
12. (em paralelo) chamar a Brevo e registrar o resultado, redigido
```

Dois trabalhos caros ficam **fora** da transação, pelo mesmo motivo — prender
uma conexão do pool é caro e aproxima o timeout de transação interativa do
Prisma (`P2028`):

- a **chamada ao fornecedor** (rede de terceiro, até 8 s);
- o **hash scrypt da nova senha** na confirmação de recuperação (`N=2^15`,
  ~100 ms de CPU **síncrona**). Ele depende só da senha, nunca do `userId`,
  então é calculado antes e entregue pronto à porta que o domínio consome.
  Dentro da transação ele travaria o event loop do processo — atrasando toda
  requisição em voo, render incluído.

Duas guardas independentes travam isso: uma extrai o corpo do callback de
`runInTransaction` por contagem de parênteses e verifica que ele não menciona o
provedor; a outra prova que, fora do composition root, **nenhum** módulo de
runtime ou HTTP alcança o driver — fechando a fuga por alias ou por
`prisma.$transaction` direto, que a primeira, ancorada num literal, não veria.

### Falha de envio depois da persistência

Banco e fornecedor **não** participam da mesma transação. Quando o token já foi
comitado e o envio falha:

- a resposta pública **não muda** (nem status, nem corpo, nem cabeçalho);
- o erro é registrado como categoria interna;
- **não há retry** e **não há compensação automática**;
- o token permanece **válido porém não entregue**;
- o usuário pode pedir de novo.

Por que não compensar: `AuthTokenStore` só oferece `invalidatePending`, que queima
**todos** os tokens pendentes daquele propósito — inclusive links legítimos
anteriores. Não existe invalidação dirigida a **um** token, e criar uma exigiria
migration fora de escopo. **Limitação registrada, não resolvida.**

---

## 4. Anti-enumeração

Os dois endpoints de **pedido** respondem sempre `202` com corpo idêntico, para:

- conta ativa (enviou);
- conta inexistente;
- conta `disabled`, `pending_deletion`, `deleted`;
- e-mail já verificado (no fluxo de verificação);
- pedido barrado por throttle;
- fornecedor fora do ar.

A igualdade é verificada por **assinatura completa** (status + cabeçalhos + corpo),
não só pelo corpo: um `Cache-Control` diferente já seria sinal observável.

### O canal mais barulhento é o TEMPO

Status, corpo e cabeçalhos idênticos não bastam. Se a resposta esperasse o
envio, uma conta inexistente responderia em milissegundos (não há nada a enviar)
e uma conta real responderia depois de uma ida e volta HTTPS ao fornecedor — até
os **8 s** do teto quando ele está degradado. Essa separação é um oráculo muito
mais nítido do que qualquer um dos canais acima.

Por isso a entrega é **agendada**, não aguardada (`scheduleDelivery`): o serviço
retorna com o envio ainda em curso. O ramo "não há o que enviar" percorre o mesmo
agendamento, para que também não exista um caminho mais curto.

Provado com um fornecedor **travado**: se o serviço aguardasse a entrega, o teste
nunca resolveria (`flows.test.ts`, casos 31–33).

As **confirmações** colapsam token inexistente, expirado, já consumido, de
propósito errado e conta inelegível na mesma `401` com
`GENERIC_TOKEN_FAILURE_MESSAGE`. Uma mensagem própria para "conta inelegível"
transformaria a rota num oráculo: quem tivesse um token qualquer distinguiria
"token ruim" de "a conta existe mas está desativada".

O throttle conta **conta inexistente também** — se só contas reais gastassem
orçamento, o tempo até o bloqueio viraria o oráculo.

---

## 5. Confirmações: abortar é obrigatório

O token é consumido **antes** de a política de status ser aplicada, porque é o
consumo que revela de quem ele é. Se a política recusar depois disso, retornar
normalmente comitaria o consumo e **queimaria o link de uma conta que não foi
verificada**.

Por isso qualquer recusa posterior ao consumo **aborta a transação** (sinal
`AuthTransactionAbort`, que carrega só um rótulo categórico — nunca `userId`,
e-mail, token ou hash).

Provado em PostgreSQL real (checks 129–132) e nos testes de aplicação: conta
desativada depois da emissão não verifica, o token **continua pendente**, e
reabilitada a conta o **mesmo** link conclui.

### Recuperação: o que a confirmação faz na mesma transação

1. consome o token de `password_reset`;
2. checa elegibilidade pelo `userId` revelado;
3. lista as sessões ativas;
4. lê a **pré-imagem** do hash atual;
5. troca a senha por **compare-and-swap** sobre essa pré-imagem;
6. revoga **todas** as sessões;
7. queima os demais tokens de reset pendentes.

O **pedido** não invalida tokens pendentes: queimá-los a cada pedido daria a
qualquer pessoa que saiba um e-mail o poder de invalidar o link legítimo que o
dono acabou de receber. A invalidação em lote acontece só na confirmação, onde
`applyPasswordReset` a exige.

---

## 6. Throttle durável

`user_auth_throttles` já existia no schema desde `20260717150000`, e a política
pura (`evaluateThrottle`/`registerFailure`) desde C7B. Faltava o contrato entre as
duas — **`AuthThrottleStore` + adapter Prisma**. Nenhuma migration foi criada.

| Escopo | Chave | Limite (política existente) |
| --- | --- | --- |
| `email` | `<purpose>:<email normalizado>` | 5 / 15 min |
| `ip` | `<purpose>:<hash do IP>` | 20 / 15 min |

### Decisões

- **Cada pedido conta**, não só falhas. Se só falhas contassem, pedir mil vezes o
  reset de uma conta existente sairia de graça.
- **Namespace por finalidade.** A tabela tem `@@unique([scope, key])` e nenhuma
  coluna de propósito; sem o prefixo, um bloqueio de reset derrubaria o reenvio de
  verificação (e, no futuro, o login). Separador `:` — ASCII **visível**, porque
  chave composta com byte de controle já apareceu três vezes neste repositório.
- **Os dois escopos são consumidos sempre**, mesmo quando um já travou: senão,
  estourado um e-mail, o atacante atacaria outros e-mails de graça do mesmo IP.
- **Durante o lockout a contagem não avança** — senão recarregar a página
  transformaria 15 minutos em bloqueio perpétuo.
- **IP nunca em texto claro.** A borda HTTP hasheia antes de entregar; nenhuma
  camada abaixo vê o endereço cru.
- **Compare-and-swap com retentativa.** Sem pré-imagem, dois pedidos concorrentes
  leriam a mesma contagem e o segundo sobrescreveria o primeiro. O CAS elege um
  vencedor — provado em Postgres real (check 141) —, mas eleger um vencedor
  **não basta**: o perdedor precisa reler e contar de novo, senão a contagem dele
  simplesmente some e K pedidos simultâneos gastariam **uma** unidade de orçamento
  em vez de K. Por isso o conflito é **retentado** (até 4 tentativas), e contenção
  sustentada resulta em `locked` — **fail-closed**. Devolver "liberado" ao desistir
  transformaria a corrida numa forma de burlar o limite.

### Limitações registradas

- **Lockout progressivo não persiste.** `registerFailure` produz
  `previousLockouts`, mas a tabela não tem coluna para ele. Todo bloqueio dura a
  base de 15 min. Persistir exigiria migration.
- **A retentativa é limitada a 4 tentativas.** Sob contenção extrema o pedido é
  recusado (`locked`) em vez de contado — direção segura, mas um pico legítimo
  simultâneo pode receber recusa. O laço é curto de propósito: ele roda dentro de
  uma transação.
- **`X-Forwarded-For` é forjável** sem proxy confiável na frente. Por isso o
  escopo de IP é camada adicional, nunca a única: o orçamento por e-mail vale
  sozinho.

---

## 7. Segredos e observabilidade

O token **cru** existe em exatamente três lugares: memória do serviço, o link
enviado, e o navegador de quem abre o link. No banco existe **só o hash**
(sha256 hex, `^[0-9a-f]{64}$`, exigido por CHECK).

O evento de log é um **tipo fechado** — a defesa é estrutural, não disciplinar:

**Permitido:** `correlationId`, `purpose`, `provider`, `outcome`,
`internalReason`, `durationMs`, `failureCategory`, `providerMessageId`.

**Impossível (não há campo):** chave da Brevo, token bruto, `tokenHash`, senha,
`passwordHash`, e-mail completo, URL de ação, IP em texto claro, cabeçalhos e
corpo de resposta do fornecedor.

**Uma exceção, explícita:** a ponte do app publica um evento
`runtime_unavailable` quando o runtime **não consegue nem ser construído**. Ele
está fora do tipo fechado, então é tratado à parte: os detalhes só são
registrados quando o erro é `AuthRuntimeConfigurationError` — o único que
garantidamente carrega apenas **nomes de variável**. Qualquer outra falha de
construção é silenciada com um rótulo fixo, porque o mesmo `try` cobre a criação
do Prisma Client, e uma recusa do driver traz a `DATABASE_URL` (senha inclusa)
dentro de `error.message`.

O `X-Request-Id` de fora só é aceito se casar o formato opaco de
`normalizeRequestId` — senão um cliente injetaria o próprio e-mail nos nossos
logs.

### O custo da stack trace

Falha inesperada vira **500 com corpo fixo**, e o objeto de erro **não** é
repassado ao coletor: só o `correlationId`. Uma exceção de driver pode citar
parâmetros de query, e um deles pode ser o hash de um token. Trocamos a stack
trace pela garantia de que nenhum segredo alcança um log. **Decisão consciente.**

---

## 8. TTL: a configuração manda, o domínio protege

`buildEmailVerificationIssue` e `buildPasswordResetIssue` ganharam um parâmetro
**opcional** `ttlMinutes`, com default nos valores do domínio
(`EMAIL_VERIFICATION_TTL_HOURS = 24`, `PASSWORD_RESET_TTL_HOURS = 2`).

Sem ele, o runtime calcularia `expiresAt` sozinho e existiriam **duas** fórmulas
de validade, livres para divergir. Valor inválido cai no default
(`auth/ttl.ts`) — fail-safe, nunca "sem expiração".

A configuração padrão (`PASSWORD_RESET_EXPIRATION_MINUTES=30`) é **mais estrita**
que o default do domínio (120 min). Janela curta é a direção segura.

---

## 9. Higiene da requisição

| Regra | Motivo |
| --- | --- |
| só `POST` (405 nos demais) | mutação nunca por `GET` |
| `content-type: application/json` obrigatório | barra POST de formulário HTML entre origens (CSRF clássico) |
| teto de 4096 bytes | limita memória antes de qualquer validação |
| `Content-Length` **e** tamanho real conferidos | o cabeçalho é informado pelo cliente e pode mentir |
| corpo vazio recusado | os quatro comandos exigem campos |
| allow-list estrita de chaves | mass-assignment (`status`, `userId`, `isAdmin`) |
| `__proto__`/`constructor` recusados | prototype pollution |
| `no-store`, `no-referrer`, `nosniff` em toda resposta | cache, `Referer`, sniffing |

Erro de sintaxe JSON **não** ecoa o corpo: a mensagem do `JSON.parse` cita um
trecho, e esse trecho pode ser a senha.

---

## 10. O que esta unidade NÃO fez

- newsletter, campanha, importação de contatos, automação de marketing;
- webhook de abertura/clique;
- **outbox** (tabela de fila) e reenvio automático;
- fila externa, cron, SMS, WhatsApp;
- `templateId` no painel da Brevo;
- login, signup ou cookie de sessão (C7B3 em diante);
- qualquer migration — schema e as 12 migrations seguem byte-idênticos;
- frontend redesenhado: as duas páginas são shell técnico mínimo.

## 10b. Limites conhecidos, não resolvidos

- **As confirmações não são limitadas por throttle.** Só os dois endpoints de
  pedido são. Tokens de 256 bits tornam a força bruta irrelevante, mas as rotas
  seguem sem teto de requisições.
- **`X-Forwarded-For` é forjável** sem proxy confiável na frente, o que anula o
  escopo de origem. O orçamento por e-mail continua valendo sozinho.
- **`provider` é fixo em `"brevo"`** no evento de log (`dispatch.ts`) e no tipo
  (`observability.ts`). O `dispatch` recebe o port agnóstico, mas o rótulo do log
  não é derivado dele — um segundo fornecedor exigiria mudar os dois.
- **`services/user-platform` não tem `src/index.ts`**, embora o `package.json` o
  declare como `main`/`exports["."]`. Pré-existente; só o subcaminho
  `./auth-runtime` é usado, então nada quebra hoje. Um `import` do pacote pela
  raiz falharia.

## 11. Próximos endurecimentos

1. **Outbox** com reenvio idempotente, fechando a janela "token válido porém não
   entregue".
2. **Invalidação dirigida a um token**, permitindo compensar um envio falho sem
   queimar links anteriores.
3. **Coluna de lockouts anteriores** em `user_auth_throttles`, ligando o lockout
   progressivo que a política pura já calcula.
4. **Webhook de bounce/spam** para suspender envio a endereço inválido.
5. **Auditoria em `user_auth_audit_logs`**: os eventos já têm nome no enum
   (`password_reset_requested`, `email_verified`, …), mas esta unidade só emite
   log de processo, não linha de auditoria.
