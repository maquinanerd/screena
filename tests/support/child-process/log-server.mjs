/**
 * log-server.mjs — Um "PostgreSQL" de mentira para o experimento do pipe cheio.
 *
 * Faz, do servidor real, SO o que importa para o defeito de 16/09/2026: escreve o
 * LOG no stderr com `write()` que ESPERA o pipe aceitar (como o backend do
 * Postgres) e so responde ao cliente depois de escrever. Quem o sobe le o stderr
 * por evento `data`, exatamente como o `embedded-postgres`. Se o laco de eventos
 * do pai congelar, o pipe enche, a escrita para e o cliente espera para sempre.
 *
 * Nunca toca `process.stderr`/`process.stdout`: a stream do Node pode deixar o
 * descritor nao bloqueante. Por isso `escreverTudo` trata EAGAIN esperando e
 * tentando de novo — o servidor continua sem responder enquanto o log nao sai,
 * que e o comportamento do write() bloqueante que se quer reproduzir.
 *
 * Uso: node log-server.mjs <bytes por linha>
 * Imprime a porta no stdout; cada conexao manda "<linhas>\n" e recebe "ok\n".
 */

import { writeSync } from 'node:fs'
import net from 'node:net'

const bytesPorLinha = Number.parseInt(process.argv[2] ?? '1024', 10)
const prefixo = 'WARNING:  '
const linha = Buffer.from(`${prefixo}${'x'.repeat(bytesPorLinha - prefixo.length - 1)}\n`)
const pausa = new Int32Array(new SharedArrayBuffer(4))

function escreverTudo(fd, buffer) {
  let escrito = 0
  while (escrito < buffer.length) {
    try {
      escrito += writeSync(fd, buffer, escrito)
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error
      Atomics.wait(pausa, 0, 0, 5)
    }
  }
}

const servidor = net.createServer((socket) => {
  // O cliente pode ter sido morto (controle negativo): responder a ele falha, e
  // isso nao e defeito do servidor.
  socket.on('error', () => undefined)
  socket.once('data', (dados) => {
    const linhas = Number.parseInt(String(dados), 10)
    for (let i = 0; i < linhas; i += 1) escreverTudo(2, linha)
    socket.end('ok\n')
  })
})

servidor.listen(0, '127.0.0.1', () => {
  escreverTudo(1, Buffer.from(`${servidor.address().port}\n`))
})
