# Identidade e Privacidade da Cinerie (Backend C, C7D)

> Documento canonico da camada EXECUTAVEL de identidade e privacidade. pt-BR;
> codigo e identificadores em ingles. Complementa
> [`user-product-auth-runtime.md`](./user-product-auth-runtime.md) (C7C, fluxos de
> e-mail) e [`user-product-decisions.md`](./user-product-decisions.md) (decisoes
> transversais). Onde houver conflito, `CLAUDE.md` e as 13 invariantes prevalecem.

## 1. O que C7D adiciona

O schema (`20260717150000`), o dominio puro (`auth/*`, `privacy/*`) e os cinco
ports de autenticacao ja existiam antes desta unidade. C7D fechou os elos
EXECUTAVEIS que faltavam:

- **Adapters Prisma novos:** perfil, consentimento, pedidos LGPD, auditoria,
  ciclo de vida da conta e leitura de exportacao.
- **Runtime de conta e sessao:** cadastro, login, logout, logout global, leitura
  de sessao, troca de senha.
- **Runtime de privacidade:** perfil/preferencias, consentimento versionado,
  exportacao, encerramento e anonimizacao.
- **Borda HTTP autenticada:** cookies (sessao `HttpOnly` + CSRF legivel), double
  submit, ownership estrutural.
- **UI funcional minima:** `/pt/entrar`, `/pt/criar-conta`, `/pt/recuperar-senha`,
  `/pt/conta`, `/pt/conta/privacidade` — nao e o frontend final.

**Nenhuma migration.** Todo o modelo necessario ja existia.

## 2. Estados da conta (`UserStatus`)

| Estado | Significado | Autentica? |
| --- | --- | --- |
| `active` | Conta operacional. | Sim (unico estado que `accountCanHoldSession` aceita). |
| `disabled` | Desativada por moderacao/seguranca. | Nao. |
| `pending_deletion` | Encerramento pedido; dentro da janela de arrependimento. | Nao. |
| `deleted` | Anonimizada (tumba: linha retida, PII removida). | Nao. |

O CHECK do schema amarra `status` e `deleted_at`: `pending_deletion`/`deleted`
exigem `deleted_at` coerente. Por isso as transicoes gravam status e carimbo na
MESMA escrita (o adapter `account-lifecycle-store.ts`).

## 3. Fluxos

### 3.1 Cadastro (`signup`)

Grava, na MESMA transacao: identidade, credencial, aceite dos documentos
obrigatorios (termos + privacidade), consentimentos opcionais (comunicacao,
analytics — inclusive o "nao" explicito), token de verificacao e auditoria.

- Resposta **sempre 202 generico**, exista ou nao o e-mail (anti-enumeracao).
- Aceite dos termos e **obrigatorio e explicito**: o parser exige `acceptedTerms: true`.
- Versao dos documentos e **sempre do servidor** (`policyVersions`); nunca do cliente.
- **Nao estabelece sessao** — cadastrar e autenticar sao decisoes separadas.
- Hash da senha (scrypt N=2^15) calculado FORA da transacao.

### 3.2 Login (`login`)

- Precedencia `decideLogin`: lockout > (existencia | status | senha). Toda falha
  de credencial produz a mesma 401.
- **Verifica a senha mesmo quando a conta nao existe** (custo de tempo igual —
  fecha o oraculo de enumeracao por latencia).
- **Session fixation impossivel por construcao**: o token nasce de
  `generateSecret()` a cada login; nao ha parametro por onde reaproveitar um
  identificador apresentado pelo cliente.
- Emite dois segredos de transporte: token de sessao + token CSRF.

### 3.3 Sessao (`resolveAuthenticatedContext`)

**Unico caminho de autenticacao do produto.** Nenhuma rota interpreta cookie por
conta propria. Busca pelo hash do token, resolve status pela identidade e decide
por `evaluateSessionAccess` (expirada/revogada/conta inelegivel falham fechado).

Nao faz `touch`/`lastUsedAt` — leitura de pagina autenticada nao vira escrita.

### 3.4 Troca de senha (`changePassword`)

Exige a senha ATUAL (sessao sozinha nao basta — sessao roubada nao vira posse
permanente). Revoga TODAS as sessoes, inclusive a corrente. Queima tokens de
reset pendentes.

### 3.5 Consentimento (`setConsent`, `hasActiveConsent`)

- **Append-only**: `user_consent_records` nunca sofre UPDATE/DELETE (prova LGPD).
- **Retirada tem efeito real e imediato**: o gate (`isConsentActive`) le sempre o
  registro mais recente; a linha `granted=false` ja nega a proxima consulta. Sem
  cache, sem job.
- Finalidade nao-revogavel (termos/privacidade) recusa retirada com `forbidden`.
- Versao de politica divergente NAO autoriza (fail-closed).
- **A propria linha e a auditoria**: consentimento NAO grava em
  `user_auth_audit_logs` (o enum `AuthAuditAction` e de eventos de autenticacao).

### 3.6 Exportacao (`requestDataExport`)

- **Sincrona** (volume de um titular e pequeno; assincrono exigiria outbox +
  storage + token de download + expurgo — quatro pecas fora de escopo). O pedido
  continua registrado em `user_data_requests` para auditoria.
- **Exclusao de segredo e ESTRUTURAL**: o `PrismaExportExecutor` e um `Pick` que
  nao contem `passwordCredential`, `userSession`, `verificationToken` nem
  `authAuditLog`. `assertExportContainsNoSecrets` roda por cima como rede de
  seguranca, nao como unica defesa.
- Idempotencia: pedido ATIVO bloqueia um segundo (`decideExportRequest`).

### 3.7 Encerramento e anonimizacao

- `requestAccountClosure`: reautentica por senha, cria pedido `deletion`, leva a
  `pending_deletion` e revoga TODAS as sessoes.
- **A anonimizacao NAO e endpoint do titular.** `SESSION_ELIGIBLE_STATUSES` e
  `["active"]`, entao `pending_deletion` nao autentica — nao existe
  `AuthenticatedContext` possivel para uma conta em encerramento. O cancelamento
  e a anonimizacao sao **operacoes assistidas** (runbook), com identidade humana
  em `processed_by`. Relaxar aquele gate foi recusado: bloquear login e o que
  protege uma conta com sessao roubada.
- `anonymizeAccount`: vira TUMBA — apaga e-mail/handle/nome, mantem `id`, status
  `deleted`. A linha NUNCA some (FK `Restrict` da auditoria + retencao da prova
  de consentimento).

## 4. Cookies e CSRF

| Cookie | HttpOnly | Papel |
| --- | --- | --- |
| `cinerie_session` / `__Host-cinerie_session` | **Sim** | Token de sessao; script nunca le. |
| `cinerie_csrf` / `__Host-cinerie_csrf` | **Nao** | Double submit; o cliente le e reapresenta em `X-CSRF-Token`. |

Ambos `Secure` + `SameSite=Lax` + `Path=/`; prefixo `__Host-` em producao.

Toda MUTACAO autenticada exige `requireCsrf` contra o `csrfTokenHash` daquela
sessao. Leitura (`GET`) nao exige. O CSRF nao e HttpOnly de proposito: um cookie
que o script nao le nao pode ser reapresentado, e o double submit deixaria de
existir. Isso nao enfraquece a sessao — o que o double submit fecha e o pedido
CROSS-SITE.

## 5. Ownership

Estrutural: nenhum servico ou handler de C7D recebe `userId` de fora. O titular
vem sempre do `AuthenticatedContext` resolvido do cookie. Nao existe assinatura
por onde um cliente escolha de quem e o dado — nao e uma checagem que alguem
possa esquecer, e a ausencia do parametro. O parser estrito ainda rejeita
qualquer `userId` injetado no corpo.

## 6. Configuracao (todas OPCIONAIS, com default seguro)

| Variavel | Default | Efeito |
| --- | --- | --- |
| `CINERIE_TERMS_POLICY_VERSION` | `2026-07` | Versao vigente dos termos. |
| `CINERIE_PRIVACY_POLICY_VERSION` | `2026-07` | Versao vigente da privacidade. |
| `SESSION_TTL_HOURS` | `720` | Vida da sessao (30 dias). |
| `ACCOUNT_DELETION_GRACE_DAYS` | `30` | Janela de arrependimento. |

Trocar uma versao de politica forca novo aceite (a tela marca `needsRenewal`) sem
apagar o historico.

## 7. Pontos que dependem de revisao juridica humana

Este documento descreve o COMPORTAMENTO tecnico. Os TEXTOS de termos e politica
de privacidade, as bases legais efetivas por finalidade, os prazos de retencao
por categoria e a conformidade final com a LGPD **exigem revisao juridica
humana**. O codigo nao declara conformidade legal; declara comportamento
auditavel.

## 8. Debitos registrados

- **`profile_updated` no enum de auditoria:** perfil editado nao gera entrada em
  `user_auth_audit_logs` porque o enum e fechado e emprestar um valor gravaria
  fato falso. Acrescentar o valor exige migration (fora de escopo desta unidade).
- **`previousLockouts` sem coluna:** o lockout progressivo entre janelas nao e
  persistivel hoje (herdado de C7C; ver `user-product-auth-runtime.md`).
- **Aviso ao dono no cadastro duplicado:** avisar por e-mail que alguem tentou
  cadastrar com um endereco ja registrado e desejavel, mas exige orcamento e
  template proprios — nao implementado.
