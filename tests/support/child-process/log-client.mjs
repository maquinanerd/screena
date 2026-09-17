/**
 * log-client.mjs — O "cliente" do experimento do pipe cheio: o papel do
 * `prisma migrate deploy`.
 *
 * Pede ao `log-server.mjs` que escreva N linhas de log e so sai depois da
 * resposta. Sai 0 com "ok"; 1 se a conexao fechou sem "ok"; 2 em erro de rede.
 *
 * Uso: node log-client.mjs <porta> <linhas>
 */

import net from 'node:net'

const [porta, linhas] = process.argv.slice(2)
const socket = net.connect(Number(porta), '127.0.0.1', () => {
  socket.write(`${linhas}\n`)
})
let resposta = ''
socket.on('data', (dados) => {
  resposta += String(dados)
})
socket.on('end', () => {
  process.exit(resposta.startsWith('ok') ? 0 : 1)
})
socket.on('error', () => {
  process.exit(2)
})
