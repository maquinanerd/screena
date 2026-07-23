# Brevo — e-mail transacional de autenticação (operação)

> Documento **operacional**. Descreve como a Cinerie envia os e-mails de
> verificação de e-mail e recuperação de senha, e como configurar isso no
> EasyPanel. A arquitetura e as decisões de produto estão em
> [`docs/product/user-product-auth-runtime.md`](../product/user-product-auth-runtime.md).
>
> Nenhum valor real de chave aparece aqui — apenas nomes de variável e
> placeholders. Uma chave commitada é uma chave vazada.

---

## 1. O que é usado (e o que não é)

| Item | Valor |
| --- | --- |
| Endpoint | `POST https://api.brevo.com/v3/smtp/email` |
| Autenticação | cabeçalho `api-key` |
| Cabeçalhos | `accept: application/json`, `content-type: application/json` |
| Sucesso | HTTP **201** com corpo `{ "messageId": "..." }` |
| SDK | **nenhum** — `fetch` nativo do Node 22 |
| Timeout | 8000 ms, com `AbortController` — cobre a resposta **inteira**, corpo incluso |
| Retry | **nenhum** (ver §4) |

**Não é usado, deliberadamente:**

- `POST /v3/emailCampaigns` e qualquer recurso de **campanha/newsletter**;
- `listIds`, `recipients` de campanha, `scheduledAt`, `EmailCampaignsApi`,
  `CreateEmailCampaign`;
- `sib-api-v3-sdk` ou qualquer SDK da Brevo;
- SMTP;
- cadastro de contato em lista;
- `templateId` criado no painel;
- webhook de abertura/clique, pixel de rastreio, automação de marketing.

### Por que não campanha

Campanha é marketing em lote: exige o destinatário **cadastrado como contato em
uma lista**, é agendada e passa pelas regras de opt-in comercial. Um link de
recuperação de senha precisa chegar **agora**, para uma pessoa que pode não ser
contato de nada. Cadastrar alguém numa lista de marketing só para conseguir
enviar um e-mail de segurança seria uso indevido de dado pessoal — e ainda
tornaria a entrega dependente do calendário de campanhas.

### Por que REST direto e não SDK

A integração tem **um** endpoint. Um SDK acrescentaria superfície de
dependência, esconderia o controle de timeout e mudaria o lockfile. Com `fetch`
nativo, o `pnpm-lock.yaml` não ganhou **nenhuma dependência externa** nesta
unidade.

---

## 2. Variáveis de ambiente

Serviço: **`screen-app`** (o app Next.js, `@screena/web`).

| Variável | Obrigatória | Exemplo / valor esperado |
| --- | --- | --- |
| `BREVO_API_KEY` | **sim** | `xkeysib-...` (nunca commitar) |
| `BREVO_SENDER_NAME` | **sim** | `Cinerie` |
| `BREVO_SENDER_EMAIL` | **sim** | `conta@cinerie.com` |
| `BREVO_REPLY_TO_EMAIL` | não | `suporte@cinerie.com` |
| `PUBLIC_APP_URL` | **sim** | `https://cinerie.com` |
| `PASSWORD_RESET_EXPIRATION_MINUTES` | **sim** | `30` |
| `EMAIL_VERIFICATION_EXPIRATION_MINUTES` | **sim** | `1440` |
| `CINERIE_IP_HASH_SALT` | recomendada | string opaca de **≥ 16 caracteres** |

### Regras inegociáveis

- **Nenhuma** delas começa com `NEXT_PUBLIC_`. Uma variável com esse prefixo é
  embutida no bundle do navegador — a chave da Brevo estaria pública.
- `BREVO_API_KEY` **nunca** chega ao browser: só o composition root e o adapter
  a conhecem, e ambos são server-only (provado por
  `services/user-platform/src/auth-runtime/__tests__/boundary.test.ts`).
- Nenhuma chave em arquivo versionado, em build-arg do Nixpacks ou no
  PostgreSQL.
- **Não existe default** para `BREVO_API_KEY`. Uma chave "presente porém vazia"
  transformaria erro de deploy em e-mail que nunca chega.
- Mensagens de erro de configuração citam **nomes de variável e regras**, nunca
  valores.

### Validação aplicada na subida

`PUBLIC_APP_URL` é recusada quando: não é URL absoluta; usa esquema diferente de
`http`/`https`; **não é HTTPS em produção**; carrega credenciais (`user:senha@`);
tem fragmento ou query; **tem prefixo de caminho** (os links usam caminho
absoluto — um prefixo sumiria em silêncio e todo e-mail apontaria para o lugar
errado); ou aponta para host local em produção.

Os prazos precisam ser inteiros positivos em minutos, com teto de `43200`
(30 dias) como detector de erro de digitação.

---

## 3. Como configurar no EasyPanel

1. Abra o projeto e selecione o serviço **`screen-app`**.
2. Vá em **Environment**.
3. Acrescente as variáveis da tabela acima, uma por linha:

   ```
   BREVO_API_KEY=<cole aqui a chave do painel da Brevo>
   BREVO_SENDER_NAME=Cinerie
   BREVO_SENDER_EMAIL=conta@cinerie.com
   BREVO_REPLY_TO_EMAIL=suporte@cinerie.com
   PUBLIC_APP_URL=https://cinerie.com
   PASSWORD_RESET_EXPIRATION_MINUTES=30
   EMAIL_VERIFICATION_EXPIRATION_MINUTES=1440
   CINERIE_IP_HASH_SALT=<string opaca de 32+ caracteres, gerada aleatoriamente>
   ```

4. **Salve.**
5. Faça **redeploy** do serviço (variáveis de runtime só valem no processo novo).

### Onde NÃO colocar

- **Não** em build-arg do Nixpacks (segredo em build-arg persiste na imagem).
- **Não** no PostgreSQL.
- **Não** no GitHub (nem em `.env` commitado, nem em secret de workflow que
  alimente o cliente).
- **Não** com prefixo `NEXT_PUBLIC_`.

A chave fica disponível **somente no runtime do servidor**.

### O remetente precisa estar validado na Brevo

`BREVO_SENDER_EMAIL` tem de ser um remetente **verificado** no painel da Brevo
(domínio ou endereço). Um remetente não validado produz recusa `4xx`, que o
adapter classifica como `provider_rejected` — o log mostra a categoria, e o
usuário continua vendo a mesma resposta genérica.

---

## 4. Erros, timeout e a ausência de retry

O adapter traduz a resposta do fornecedor para uma **categoria fechada**. O corpo
de erro da Brevo nunca é lido para log, retorno ou mensagem de exceção — ele pode
citar o destinatário.

| Situação | Categoria interna |
| --- | --- |
| 401, 403 | `configuration_error` |
| 429 | `rate_limited` |
| 5xx | `provider_unavailable` |
| demais 4xx (400, 402, 404, 422…) | `provider_rejected` |
| 2xx que não seja 201 | `malformed_provider_response` |
| 201 sem `messageId` válido, ou JSON inválido | `malformed_provider_response` |
| estouro de 8000 ms (cabeçalhos **ou** corpo) | `timeout` |
| falha de rede | `provider_unavailable` |

### Por que não há retry automático

Uma falha de rede **depois** de a requisição ter sido enviada é indistinguível de
uma falha **antes**: a mensagem pode já ter sido aceita. Sem idempotência do lado
do fornecedor, repetir é apostar em enviar **dois** e-mails. Quem quiser outra
tentativa pede de novo — e o fluxo público permite exatamente isso, dentro do
limite de throttle.

---

## 5. Diagnóstico

Toda operação emite um evento JSON em stdout com `scope: "auth-email"`:

```json
{"scope":"auth-email","correlationId":"...","purpose":"password_reset",
 "provider":"brevo","outcome":"sent","internalReason":"issue_token",
 "durationMs":412,"failureCategory":null,"providerMessageId":"<...@relay...>"}
```

| Campo | Uso |
| --- | --- |
| `outcome` | `sent`, `not_applicable`, `provider_failed`, `confirmed`, `rejected` |
| `internalReason` | `issue_token`, `user_not_found`, `account_ineligible`, `already_verified`, `throttled`, `expired`, `wrong_purpose`, … |
| `failureCategory` | categoria da tabela acima, quando `provider_failed` |
| `providerMessageId` | recibo técnico, para cruzar com o painel da Brevo |

**Nunca aparece em log:** `BREVO_API_KEY`, token bruto, `tokenHash`, senha,
`passwordHash`, e-mail completo, URL de ação, IP em texto claro, cabeçalhos ou
corpo de resposta da Brevo. Isso é **estrutural**: o tipo do evento é fechado e
não tem campo livre.

**Uma exceção, explícita.** O evento `runtime_unavailable` (emitido quando o
runtime nem consegue ser construído) está fora desse tipo. Nele, os detalhes só
são registrados quando o erro é de **configuração** — o único que garantidamente
carrega apenas nomes de variável. Qualquer outra falha de construção é registrada
com um rótulo fixo e **sem** a mensagem original, porque o mesmo caminho cobre a
criação do Prisma Client, e uma recusa do driver traz a `DATABASE_URL` (senha
inclusa) dentro dela.

### Sintomas comuns

| Sintoma | Causa provável |
| --- | --- |
| 500 em todos os endpoints, log `runtime_unavailable` | configuração ausente/inválida — a mensagem lista os nomes de variável |
| `outcome: provider_failed`, `configuration_error` | chave errada, revogada ou sem permissão |
| `outcome: provider_failed`, `provider_rejected` | remetente não validado, cota/crédito, payload recusado |
| `outcome: not_applicable`, `throttled` | limite atingido (5 pedidos/15 min por e-mail) |
| `outcome: not_applicable`, `user_not_found` | não há conta — comportamento correto, resposta pública idêntica |

---

## 6. Smoke test manual (envia e-mail de verdade)

```bash
BREVO_API_KEY=... BREVO_SENDER_NAME=Cinerie BREVO_SENDER_EMAIL=conta@cinerie.com BREVO_TEST_RECIPIENT=voce@exemplo.com BREVO_SMOKE_CONFIRM=yes corepack pnpm --filter @screena/user-platform smoke:brevo
```

- É **opt-in**: sem todas as variáveis (incluindo `BREVO_SMOKE_CONFIRM=yes`), o
  script imprime o que falta e sai com `0` — nunca envia por engano.
- **Não** roda no CI, **não** roda em `pnpm test`, **não** roda no build.
- **Não** tem destinatário embutido no código.
- **Não** usa token real: o link é um marcador inofensivo.
- Imprime **apenas** o `messageId` — nunca a chave, o corpo ou o destinatário.

---

## 7. Limites conhecidos desta unidade

- **Sem outbox.** Não existe tabela de fila nem reenvio automático. Se o
  fornecedor falhar depois de o token ter sido persistido, o token continua
  válido porém **não entregue**; o usuário pede de novo.
- **Sem webhook.** Abertura, clique, bounce e spam-report não são consumidos.
- **Sem cron/fila externa.** O envio acontece no processo do request, depois do
  commit.
- **Lockout progressivo não persiste.** `user_auth_throttles` não tem coluna
  para contar lockouts anteriores, então todo bloqueio dura a base de 15 min.
- **Sem `CINERIE_IP_HASH_SALT`,** o sal de hash de IP é gerado por processo: o
  orçamento por origem deixa de ser correlacionável entre reinícios e réplicas.
  O orçamento por e-mail continua íntegro.
