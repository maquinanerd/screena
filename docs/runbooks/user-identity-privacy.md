# Runbook — Identidade e Privacidade (Backend C, C7D)

> Operacoes assistidas da camada de conta/privacidade. pt-BR. Toda operacao
> destrutiva ou de dado pessoal exige **decisao humana registrada** — nunca
> "system"/"agent" em `processed_by`.

## Regras gerais

- **NUNCA rode contra producao sem autorizacao explicita.** Confirme host,
  database, `NODE_ENV` e encoding antes de qualquer escrita.
- **NUNCA imprima** `DATABASE_URL`, senha, hash, token, cookie, chave de
  assinatura, link de redefinicao completo ou token de verificacao.
- `processed_by` em `user_data_requests` e SEMPRE identidade humana do operador.

## Revogar todas as sessoes de uma conta comprometida

Quando uma conta pode ter sessao roubada:

1. Confirme o `user_id` (por e-mail normalizado, nunca por e-mail bruto).
2. Revogue todas as sessoes ativas:
   ```sql
   UPDATE user_sessions
   SET revoked_at = now(), revoked_reason = 'admin_security'
   WHERE user_id = $1 AND revoked_at IS NULL;
   ```
3. Se houver suspeita de credencial vazada, force a troca de senha por fora
   (bloqueie login ate o titular redefinir via `/pt/recuperar-senha`).
4. Registre o incidente. A trilha em `user_auth_audit_logs` e append-only.

## Bloquear conta comprometida

```sql
UPDATE users SET status = 'disabled' WHERE id = $1 AND status = 'active';
```

`disabled` impede login imediatamente (`accountCanHoldSession` so aceita
`active`). As sessoes vivas continuam ate expirar/serem revogadas — revogue-as
tambem (passo acima).

## Reativar conta desativada

```sql
UPDATE users SET status = 'active' WHERE id = $1 AND status = 'disabled';
```

## Cancelar encerramento (arrependimento assistido)

O cancelamento NAO e endpoint do titular: uma conta em `pending_deletion` nao
autentica. Dentro da janela de carencia (`ACCOUNT_DELETION_GRACE_DAYS`), atenda
o pedido pela funcao de dominio:

- Chame `cancelAccountClosure(deps, { userId, userStatus: 'pending_deletion' }, operator)`
  via script de manutencao (o operador e sua identidade humana).
- Ela recusa fora da janela (`decideDeletionCancel`), volta o status a `active`,
  zera `deleted_at` e marca o pedido de deletion como `cancelled`.

## Executar exportacao de dados

A exportacao e sincrona e disponivel ao titular em `/pt/conta/privacidade`. Para
atender um pedido por canal de suporte, use o mesmo servico
(`requestDataExport`) autenticado como o titular — nunca monte o JSON a mao (o
`PrismaExportExecutor` garante, por tipo, que nenhum segredo entra).

## Concluir anonimizacao apos a carencia

Depois da janela de arrependimento, para uma conta em `pending_deletion`:

- Chame `anonymizeAccount(deps, userId, operator)` via script de manutencao.
- Ela exige `pending_deletion`, vira a linha em tumba (e-mail
  `deleted-<id>@anonymized.invalid`, handle/nome nulos, status `deleted`) e marca
  o pedido de deletion como `completed` com `processed_by = operator`.
- A prova de consentimento e a auditoria PERMANECEM (retencao LGPD).

## Rotacionar o sal de hash de IP

`CINERIE_IP_HASH_SALT` (>= 16 chars). Trocar quebra a correlacao de throttle por
IP entre o valor antigo e o novo (o orcamento por IP recomeca); o orcamento por
e-mail nao e afetado. IP cru nunca e persistido. Ausente, um sal efemero por
processo e gerado — configure a variavel para correlacao entre replicas.

## Reenviar verificacao de e-mail

O titular pede em `/pt/verificar-email` (fluxo publico com throttle proprio). Nao
ha reenvio administrativo direto — evita virar oraculo de existencia de conta.

## Recuperar job/entrega falho

O envio de e-mail acontece FORA da transacao e nao tem outbox: se o processo
morrer entre o commit e o envio, o token fica valido porem nao entregue. O
titular simplesmente pede de novo (o fluxo publico permite). Nao ha reprocesso
automatico a acionar.

## Desligar uma funcao opcional (tracking/analytics)

O consentimento e a fonte de verdade. Para um titular especifico, ele mesmo
retira em `/pt/conta/privacidade` (efeito imediato). Para desligar em massa uma
finalidade, isso e decisao de produto/juridica — nao ha chave global neste
runbook; ver as invariantes de tracking.
