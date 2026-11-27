# Correcao dos RCEs de next, React, sharp e Payload (27/11/2026)

> Por que o site, o admin e o CMS subiram de versao de uma vez, por que o CMS
> foi para o **Next 16** e os outros dois ficaram no 15.5, o que o `pnpm audit`
> ainda acusa e como conferir se o servidor do EasyPanel foi invadido. Leia antes
> de **baixar** qualquer versao de `next`, `react`, `sharp` ou `payload`, de
> mexer em `pnpm.overrides` ou de trocar o bundler do CMS.

---

## 1. Contexto

Em 26/11/2026 o portal Maquina Nerd (outro repositorio, outro servidor) foi
invadido por execucao remota de codigo: `next` 15.5.4, vulneravel ao React2Shell
e aos RCEs do otimizador de imagem. Dentro do container ficaram um minerador
rodando da memoria (`memfd:kworkerd`), um Tor em `/var/tmp/.kworkerd/.d/tor` e um
watchdog em `/var/tmp/.guard`, com conexoes para `45.86.86.254` e `45.132.127.8`.

Uma auditoria so leitura deste repositorio em `606a4d1` achou a Cinerie exposta
as mesmas classes de falha:

| App | Antes | Falhas que importam |
| --- | --- | --- |
| `apps/web` (`cinerie.com`) | next 15.5.25, react 19.2.7, sharp 0.34.5 | GHSA-2464-fhr4-w9xw (RCE sem login no `/_next/image` com SVG, imagem glibc); GHSA-p3m5-59mp-jv5r (DoS por Server Actions); altos de sharp/libvips |
| `apps/admin` | next 15.5.25 | os mesmos do next 15.5.25 |
| `apps/cms` (`cms.cinerie.com`) | next 15.4.11, payload 3.86.0 | RCE do otimizador com AVIF (GHSA-2xp9-vwfh-vxw4) e SVG; ~12 altos do next; criticos do Payload: SQLi (GHSA-v49j-62m6-pgrr), bypass de acesso em auth (GHSA-vc4h-q48j-5hcx, GHSA-66wr-7vmr-p5jq) e update sem autorizacao (GHSA-f7hx-52q9-hcrf); alto "RCE through first-register" (GHSA-97rh-rhh2-7vjv) |

`pnpm audit --prod` em `606a4d1`: **8 criticos, 57 altos**, 51 moderados, 13 baixos.

O `/_next/image` do site esta ligado no padrao (sem `images.unoptimized`) e a
imagem e `node:22-bookworm-slim` (glibc): exatamente a superficie da
GHSA-2464-fhr4-w9xw.

## 2. O que mudou

| Onde | De | Para |
| --- | --- | --- |
| `apps/web`, `apps/admin` | next ^15.5.21 (15.5.25), react ^19.0.0 (19.2.7) | next ^15.5.29, react/react-dom ^19.2.9 |
| `apps/cms` | next 15.4.11, react 19.2.7, sharp 0.35.3, payload e `@payloadcms/*` 3.86.0 | next **16.4.6**, react 19.2.9, sharp 0.35.5, payload e `@payloadcms/*` 3.94.2 |
| `services/news-ingestion` (dev) | payload 3.86.0 | payload 3.94.2 |
| `packages/editorial-contracts` | zod 4.4.3 | zod 4.6.7 (GHSA-mrhx-c7xc-m3w5) |
| Imagem base dos 5 Dockerfiles | `node:22-bookworm-slim` com Node 22.23.1 | o mesmo tag, digest `be979e55...`, Node **22.23.5** |
| `pnpm.overrides` (raiz) | nenhum | ver secao 5 |

Sobre o React: o RCE de RSC GHSA-xqc2-xf4c-x3h3 (10/11/2026, "typed arrays")
esta nos pacotes `react-server-dom-webpack`/`-turbopack`/`-parcel`, corrigidos
na 19.2.9, e nao no pacote `react`. Nenhum `react-server-dom-*` esta instalado
direto no monorepo: o Next usa a copia que ele mesmo empacota em
`next/dist/compiled/`, e por isso quem corrige e a versao do `next`. O advisory
do Next para o RCE com typed arrays e o GHSA-673q-mjm6-r5xr, que lista so
16.0.0 a 16.4.0 (corrigido no 16.4.1); a linha 15.5 nao aparece como afetada.
O `pnpm audit` nao enxerga essa copia empacotada, entao "0 criticos" nao prova
nada sobre ela. `react`/`react-dom` sobem para 19.2.9, a versao do template do
Payload, para a arvore nao carregar uma 19.2.x anterior ao advisory.

### 2.1 Por que o CMS foi para o Next 16

O `@payloadcms/next` aceita `next` `>=15.4.11 <15.5.0 || >=16.4.5 <17.0.0`: a
linha **15.5 nunca foi suportada pelo Payload**, e a 15.4 acabou na 15.4.11, sem
as correcoes de AVIF, SVG e do `use cache`. O unico next corrigido que o Payload
aceita e o 16.4.x. O template oficial do Payload 3.94.2 usa exatamente
`next@16.4.6` e `react@19.2.9`.

### 2.2 O CMS continua no webpack

No Next 16 o `next build` e o `next dev` passaram a usar Turbopack por padrao, e o
Turbopack recusa o `webpack()` do `apps/cms/next.config.ts` (o `extensionAlias`
de `.js` para `.ts`). Para nao trocar de bundler num PR de seguranca:

- `build` e `dev` do `@screena/cms` rodam com `--webpack`;
- o harness de integracao (`apps/cms/src/__tests__/harness.ts`), que chama o
  binario do `next` direto, passa `--webpack` tambem. O E2E do painel e os
  canarios usam esse harness;
- `lint` do CMS virou `eslint .`: o `next lint` foi removido no Next 16. A CI usa
  o `pnpm lint` da raiz, que nao mudou.

Migrar o CMS para Turbopack e outra mudanca, com teste proprio.

### 2.3 Payload 3.86 para 3.94: o que exigiu codigo

- **Migration** `20261127_034638_payload_3_94_seguranca`: a 3.90 trouxe o campo
  `resetPasswordRequestedAt` nas colecoes de auth (limite no "esqueci a senha").
  So `editorial_users` ganha a coluna; `service-accounts` nao tem senha. O CMD da
  imagem ja roda `cms:migrations:deploy` antes do `next start`, entao a coluna e
  criada no proprio Implantar.
- **Tipos**: `payload-types.ts` regenerado (`resetPasswordRequestedAt` e
  `hasAPIKey`).
- **Senhas existentes continuam valendo**: a 3.90 aumentou as iteracoes do PBKDF2
  (GHSA-q6mq-ch85-c8mm). O advisory diz que o hash antigo e atualizado de forma
  transparente no primeiro login bem-sucedido; no codigo da 3.94.2,
  `authenticateLocalStrategy` le os parametros do hash gravado antes de comparar.
- Notas da 3.90 que **nao** atingem o CMS: `clientUploads`/`_objectKey` (nao
  usamos), SVG/XML (a colecao de midia so aceita png, jpeg, webp e avif), teto de
  50 MB no multipart (fotos ficam muito abaixo), Azure, GCS e Form Builder.
- A 3.94 exige Node `^22.23.5`: por isso o digest da imagem base mudou.

## 3. Auditoria depois da troca

`pnpm audit --prod` neste PR: **0 criticos, 1 alto, 1 moderado, 0 baixos**.

| Severidade | Pacote | Caminho | Por que ficou |
| --- | --- | --- | --- |
| alto | `deepmerge-ts` 7.1.5 (GHSA-ggr8-5vv4-36mx, estouro de pilha com objeto recursivo) | `@prisma/client` > `prisma` > `@prisma/config` | A correcao e a 8.0, que muda a semantica de merge (Maps passam a ser mesclados). So roda ao ler o config do proprio Prisma, entrada nossa, nunca do usuario. Some quando o Prisma subir a dependencia. |
| moderado | `esbuild` 0.18.20 (GHSA-67mh-4wv8-2f99, servidor de dev aceita requisicao de qualquer site) | `@payloadcms/db-postgres` > `drizzle-kit` > `@esbuild-kit/*` | So afeta o servidor de desenvolvimento do esbuild, que nao roda em producao. Correcao exige o esbuild 0.25 dentro do drizzle-kit. |

## 4. Como conferir depois do Implantar

1. `https://cinerie.com` e uma ficha de filme respondem 200.
2. O otimizador de imagem responde com o sharp novo. Nenhuma pagina usa
   `next/image`, entao a prova e direta:

   ```sh
   curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Accept: image/webp' \
     'https://cinerie.com/_next/image?url=%2Fbrand%2Fcinerie-logo.png&w=64&q=75'
   ```

   Esperado: `200 image/webp`.
3. `https://cms.cinerie.com/healthz` responde 200; login no painel funciona; os
   logs do container mostram a migration `20261127_034638_payload_3_94_seguranca`
   aplicada (ou "nada a migrar" num segundo deploy).
4. **O editor de paragrafo do CMS.** O Payload 3.94 traz o Lexical 0.50 (era
   0.41), e `apps/cms/src/admin/ParagraphTextField.tsx` monta um editor Lexical
   proprio que nenhum teste automatizado exercita digitando (os E2E criam
   paragrafos pela API). Num rascunho: digitar, Ctrl+B, Ctrl+I, Ctrl+K (link),
   Enter (cria bloco novo) e colar dois paragrafos (divide em blocos). Se algo
   quebrar, a redacao fica sem editor: avise antes de liberar o painel.
5. O admin interno abre com Basic Auth.
6. No console de cada container: `node -e "console.log(require('next/package.json').version)"`
   dentro do app (`/app/apps/web`, `/app/apps/admin`, `/app/apps/cms`) mostra
   15.5.29, 15.5.29 e 16.4.6.

## 5. `pnpm.overrides`

Todos dentro da mesma versao maior, exceto o `happy-dom` (20 para 21), so para
tirar a versao vulneravel da arvore:

| Override | Motivo |
| --- | --- |
| `sharp: 0.35.5` | Mitigacao do RCE do otimizador e altos de libvips/libheif/librsvg. O next 15.5.29 aceita `^0.34.3 \|\| ^0.35.5`; o override garante uma copia so, a corrigida |
| `js-yaml@^4: ^4.3.2` | 3 altos de CPU quadratica (via `json-schema-to-typescript` do Payload) |
| `fast-uri@^3: ^3.1.9` | 6 altos de SSRF/confusao de host (via `ajv` do Payload) |
| `nanoid@^3: ^3.3.18` e `postcss@^8: ^8.5.23` | Altos do postcss 8.4.31 que o next 15.5 fixa |
| `source-map-js@^1: ^1.2.2` | DoS por source map indexado |
| `effect@^3: ^3.22.1` | ReDoS (via `@prisma/config`) |
| `happy-dom@^20: ^21.0.4` | SSRF ao parsear HTML (via `@lexical/headless` do Payload). A 21 so muda o padrao: desliga carga de CSS e iframe. O `@lexical/headless` usa apenas `new Window()` |
| `dompurify@^3: ^3.4.17` e `fast-copy@^3: ^3.1.0` | Moderados/baixos do editor Monaco e do `pino-pretty` do Payload |

Ao remover um override, rode `pnpm audit --prod` e confira que a versao que volta
nao esta na lista de advisories.

## 6. O servidor do EasyPanel precisa ser examinado

Este PR fecha as portas; ele **nao** diz se alguem ja entrou. A Cinerie ficou
exposta as mesmas classes de RCE que derrubaram o portal Maquina Nerd, e o
servidor dela nunca foi examinado. Antes de considerar o incidente fechado, o dono
(ou uma sessao com SSH no servidor) roda os comandos abaixo, **todos so leitura**,
como root no host. Processos de container aparecem no `/proc` do host, entao os
passos 2 e 3 cobrem todos os servicos (`screen-app`, CMS, admin, workers) de uma
vez. A **rede** nao: cada container tem namespace de rede proprio, e o `ss` do
host nao ve as conexoes deles; o passo 4 entra em cada um.

```sh
# 0. Rootkit de LD_PRELOAD esconde processo da leitura do /proc e cegaria os passos 2 e 3.
#    O normal e o arquivo nao existir.
ls -la /etc/ld.so.preload 2>/dev/null && cat /etc/ld.so.preload

# 1. Carga e quem esta comendo CPU (o minerador do portal usava ~3 nucleos)
uptime
top -b -n 1 -o %CPU | head -25
docker stats --no-stream

# 2. Processo rodando de /tmp, /var/tmp, /dev/shm, da memoria (memfd) ou de binario apagado
for p in /proc/[0-9]*; do
  exe=$(readlink "$p/exe" 2>/dev/null) || continue
  case "$exe" in
    /tmp/*|/var/tmp/*|/dev/shm/*|*memfd:*|*'(deleted)'*)
      printf '%s\t%s\t%s\n' "${p#/proc/}" "$exe" "$(tr '\0' ' ' < "$p/cmdline" | cut -c1-200)" ;;
  esac
done

# 3. "Thread de kernel" com binario: no portal o watchdog se chamava [kworker/u16:2].
#    Thread de kernel de verdade nao tem exe; esta lista deve sair vazia.
for p in /proc/[0-9]*; do
  name=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null); exe=$(readlink "$p/exe" 2>/dev/null) || continue
  case "$name" in \[*|kworker*) printf '%s\t%s\t%s\n' "${p#/proc/}" "$name" "$exe" ;; esac
done

# 4. Conexoes para os IPs do portal: no host, no conntrack (o trafego dos containers
#    passa pelo NAT do host) e dentro do namespace de rede de cada container
ss -tnp | grep -E '45\.86\.86\.254|45\.132\.127\.8'
grep -E '45\.86\.86\.254|45\.132\.127\.8' /proc/net/nf_conntrack 2>/dev/null
for c in $(docker ps -q); do
  echo "== $(docker inspect -f '{{.Name}}' "$c")"
  nsenter -t "$(docker inspect -f '{{.State.Pid}}' "$c")" -n ss -tnp state established
done

# 5. Arquivos do mesmo kit no host e dentro de cada container
ls -la /var/tmp/.kworkerd /var/tmp/.guard 2>/dev/null
ls -la /tmp /var/tmp /dev/shm
for c in $(docker ps -q); do
  echo "== $(docker inspect -f '{{.Name}}' "$c")"
  docker top "$c" -eo pid,user,pcpu,etime,args | head -15
  docker exec "$c" sh -c 'ls -la /tmp /var/tmp /dev/shm /var/tmp/.kworkerd /var/tmp/.guard 2>/dev/null'
done

# 6. Persistencia no host
crontab -l; cat /etc/crontab; ls -la /etc/cron.* /var/spool/cron/crontabs 2>/dev/null
systemctl list-timers --all
systemctl list-units --type=service --state=running
ls -la /root/.ssh; cat /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys 2>/dev/null
last -a | head -20
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.CreatedAt}}\t{{.Status}}'
```

No banco do CMS (somente leitura), conta que ninguem criou e chave de API mexida
sem motivo (o GHSA-97rh-rhh2-7vjv era "RCE pelo first-register"; o
GHSA-238x-w2j9-gwwr expunha chave de API em leitura comum):

```sql
SELECT id, email, role, active, created_at, updated_at FROM editorial_users ORDER BY created_at DESC;
SELECT id, label, purpose, active, enable_a_p_i_key, created_at, updated_at FROM service_accounts ORDER BY updated_at DESC;
```

**Se qualquer item aparecer** (processo de `/tmp` ou memfd, conexao para esses
IPs, CPU alta sem explicacao, usuario ou chave desconhecidos):

1. Nao apague nada antes de copiar: `ls -la`, `cat /proc/<pid>/cmdline`,
   `ls -l /proc/<pid>/exe`, `ss -tnp` e os logs do container (o stdout some no
   proximo deploy).
2. Pare o container afetado e implante este PR; o container novo nasce limpo.
3. Troque os segredos daquele servico, considerando-os vazados: banco (senhas de
   `DATABASE_URL` e `PAYLOAD_DATABASE_URL`), `PAYLOAD_SECRET`, chaves S3 do
   storage do CMS, chaves das APIs de catalogo (TMDB, OMDb), chaves de API das
   `service-accounts` (MNScr) e de quem consome a rota `editorial-context`, Basic
   Auth do admin. Nenhum valor desses esta no repositorio.
4. Bloqueie no host a saida para `45.86.86.254` e `45.132.127.8`.

## 7. Nao desfazer

- **Nunca** voltar `next` para abaixo de 15.5.29 (web, admin) ou de 16.4.6 (CMS; o
  `@payloadcms/next` 3.94.2 exige pelo menos 16.4.5),
  `payload` para abaixo de 3.90.0, nem `sharp` para abaixo de 0.35.5.
- Rollback de imagem no EasyPanel para um build anterior a este PR **reabre os
  RCEs**. Se precisar voltar codigo, reverta o commit da funcionalidade, nao o
  das versoes.
