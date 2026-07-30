# CMS no EasyPanel: segredos somente em runtime

O EasyPanel pode encaminhar variaveis configuradas em **Ambiente** para o comando
de build como `--build-arg`. Por isso, `PAYLOAD_DATABASE_URL` e `PAYLOAD_SECRET`
nao devem ser cadastradas como variaveis do servico `cinerie-cms`.

No EasyPanel, crie duas **Montagens de Arquivo**:

| Caminho no container | Conteudo |
| --- | --- |
| `/run/secrets/payload_database_url` | URL interna completa do `cinerie-cms-db` |
| `/run/secrets/payload_secret` | segredo aleatorio do Payload com pelo menos 32 caracteres |

Os arquivos devem conter somente o valor, sem nome de variavel e sem aspas.

As demais configuracoes nao secretas permanecem em **Ambiente**:

```env
NODE_ENV=production
PORT=3002
PAYLOAD_PUBLIC_SERVER_URL=https://cms.cinerie.com
PAYLOAD_UPLOAD_STORAGE_DRIVER=local
PAYLOAD_UPLOAD_LOCAL_ROOT=/data/cms-uploads
PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true
EDITORIAL_AUTO_PUBLISH_ENABLED=false
```

O `Dockerfile.cms` usa placeholders fixos durante `next build`. No start do
container, ele carrega os dois arquivos somente quando as variaveis equivalentes
nao estiverem presentes, executa `payload migrate` e depois inicia o CMS.

O hostname interno do EasyPanel pode carregar o prefixo do projeto, como
`rss_prime_cinerie-cms-db`. Esse prefixo nao transforma um database isolado em
banco publico. A validacao continua bloqueando hosts `screen-db` e nomes de
database publicos conhecidos.
