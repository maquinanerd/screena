import type { Metadata } from "next";

import { serializeJsonLd } from "@screena/seo";

import { LegalDocument } from "../../_components/legal-document";
import {
  LEGAL_CONSENT_PURPOSES,
  LEGAL_DATA_CATEGORIES,
  LEGAL_DOCUMENT_VERSION,
  LEGAL_LAST_UPDATED_ISO,
  legalDocumentShouldIndex,
} from "../../../src/lib/legal";
import {
  HOME_PATH,
  SITE_URL,
  canonicalPublicUrl,
  publicRobots,
} from "../../../src/lib/site";

/**
 * /pt/privacidade — Politica de Privacidade (LGPD).
 *
 * Par de `/pt/termos`: o cadastro exige o aceite dos dois e linkava para ca com
 * 404. Ver `src/lib/legal.ts`.
 *
 * O QUE TORNA ESTE TEXTO DIFERENTE DE UM MODELO GENERICO: as duas tabelas abaixo
 * sao geradas a partir do vocabulario que o codigo de privacidade realmente usa.
 * Quando alguem acrescentar uma finalidade de consentimento ou mudar a
 * classificacao de uma categoria de dado, `legal-documents.test.ts` acusa a
 * divergencia — o documento nao consegue envelhecer em silencio.
 *
 * A pagina NAO importa a plataforma de usuario (proibido no render publico); ela
 * le a copia espelhada de `src/lib/legal.ts`, e o teste de governanca compara as
 * duas fontes fora do caminho de render.
 *
 * IMPORTANTE: esta pagina descreve o tratamento; ela NAO e o painel de
 * privacidade. O painel onde o titular exerce os direitos e `/pt/conta/privacidade`.
 */

const TITLE = "Política de Privacidade";
const DESCRIPTION =
  "Quais dados a Cinerie trata, por quê, por quanto tempo e como você exerce seus direitos sob a LGPD.";
const PRIVACY_PATH = "/pt/privacidade/";

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(legalDocumentShouldIndex()),
    alternates: { canonical: canonicalPublicUrl(PRIVACY_PATH) },
  };
}

export default function PrivacyPage() {
  const canonicalUrl = canonicalPublicUrl(PRIVACY_PATH);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}${HOME_PATH}` },
      { "@type": "ListItem", position: 2, name: TITLE, item: canonicalUrl },
    ],
  };

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
        type="application/ld+json"
      />

      <LegalDocument
        resumo="O que fazemos com os seus dados, em português claro. Se algo aqui estiver ambíguo, escreva para o nosso encarregado — a dúvida é nossa para resolver, não sua para adivinhar."
        titulo={TITLE}
      >
        <h2>1. Quem trata os seus dados</h2>
        <p>
          O controlador dos dados é {"{{RAZAO_SOCIAL}}"}, CNPJ {"{{CNPJ}}"}, com sede em{" "}
          {"{{ENDERECO}}"}.
        </p>
        <p>
          Nosso encarregado pela proteção de dados (DPO) é {"{{NOME_ENCARREGADO}}"}, que
          você contata em <strong>{"{{EMAIL_ENCARREGADO}}"}</strong>. É o canal certo para
          qualquer pedido sobre seus dados pessoais.
        </p>

        <h2>2. Navegar sem conta</h2>
        <p>
          Você pode consultar o catálogo inteiro sem criar conta e sem se identificar.
          Nesse caso tratamos apenas o mínimo que qualquer servidor web registra para
          funcionar e se defender de abuso — e não montamos perfil de navegação seu.
        </p>

        <h2>3. O que coletamos quando você cria conta</h2>
        <p>
          Coletamos o que você digita: e-mail, senha e o que preencher de perfil. E o que
          a conta produz conforme você usa: listas, avaliações, itens marcados como
          assistidos, histórico.
        </p>
        <p>
          A senha nunca é guardada como você a digitou — armazenamos apenas uma derivação
          criptográfica dela, que não permite recuperar a original. O mesmo vale para os
          endereços de IP usados no login: guardamos um hash, não o endereço.
        </p>
        <p>
          <strong>Não vendemos seus dados. Não os cedemos para publicidade de terceiros.</strong>
        </p>

        <h2>4. Com que base legal, e para quê</h2>
        <p>
          A LGPD exige uma base legal para cada finalidade. Estas são as nossas, e é
          exatamente assim que a plataforma as registra:
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Finalidade</th>
                <th scope="col">Base legal</th>
                <th scope="col">Você pode revogar?</th>
                <th scope="col">O que significa</th>
              </tr>
            </thead>
            <tbody>
              {LEGAL_CONSENT_PURPOSES.map((purpose) => (
                <tr key={purpose.kind}>
                  <th scope="row">{purpose.titulo}</th>
                  <td>
                    <code>{purpose.base}</code>
                  </td>
                  <td>{purpose.base === "consent" ? "Sim, quando quiser" : "Não enquanto usar a conta"}</td>
                  <td>{purpose.explicacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Marketing e métricas são <strong>opcionais</strong>: recusar os dois não limita
          nada do que a conta faz. Guardamos o registro de cada consentimento — qual, em
          que versão do documento e quando — porque a lei exige poder demonstrá-lo.
        </p>

        <h2>5. O que acontece com cada tipo de dado</h2>
        <p>
          Esta é a parte que costuma ficar vaga nas políticas, então aqui ela é uma tabela.
          “Sai na exportação” responde ao seu direito de portabilidade; “se você encerrar a
          conta” responde ao de eliminação.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Tipo de dado</th>
                <th scope="col">Exemplo</th>
                <th scope="col">Sai na exportação?</th>
                <th scope="col">Se você encerrar a conta</th>
                <th scope="col">Por quê</th>
              </tr>
            </thead>
            <tbody>
              {LEGAL_DATA_CATEGORIES.map((item) => (
                <tr key={item.categoria}>
                  <th scope="row">{item.rotulo}</th>
                  <td>{item.exemplo}</td>
                  <td>{item.exportavel ? "Sim" : "Não"}</td>
                  <td>{item.aoEncerrar}</td>
                  <td>{item.porque}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>6. Seus direitos</h2>
        <p>A LGPD garante a você, e nós implementamos:</p>
        <ul>
          <li>
            <strong>Saber o que temos e obter uma cópia.</strong> Em Conta → Privacidade
            você gera uma exportação dos seus dados em formato legível por máquina.
          </li>
          <li>
            <strong>Corrigir o que estiver errado.</strong> Direto no seu perfil.
          </li>
          <li>
            <strong>Revogar consentimento.</strong> Marketing e métricas podem ser
            desligados a qualquer momento, sem justificar.
          </li>
          <li>
            <strong>Encerrar a conta.</strong> Também em Conta → Privacidade.
          </li>
          <li>
            <strong>Reclamar à ANPD.</strong> Você pode acionar a Autoridade Nacional de
            Proteção de Dados a qualquer momento — inclusive sem falar com a gente antes.
          </li>
        </ul>
        <p>
          Pedidos feitos pelo painel são atendidos na hora. Pedidos por e-mail respondemos
          em até 15 dias.
        </p>

        <h2>7. Encerramento de conta e o prazo de arrependimento</h2>
        <p>
          Ao pedir o encerramento, a conta entra numa <strong>janela de 14 dias</strong>{" "}
          antes da eliminação definitiva. A janela existe por dois motivos: arrependimento
          acontece, e pedido de exclusão é também um vetor de ataque — se alguém invadir
          sua conta e mandar apagá-la, os 14 dias são o tempo de você reverter.
        </p>
        <p>
          Passada a janela, seguimos a tabela da seção 5: o que é seu é apagado, sua
          identificação é anonimizada e os poucos registros que a lei manda guardar
          permanecem sem ligação com você.
        </p>

        <h2>8. Por quanto tempo guardamos</h2>
        <ul>
          <li>
            <strong>Dados da conta:</strong> enquanto ela existir, mais os 14 dias da
            janela.
          </li>
          <li>
            <strong>Registros de segurança</strong> (tentativas de login, bloqueios por
            abuso): <strong>365 dias</strong>. É o que permite investigar um ataque à sua
            conta depois que ele aconteceu.
          </li>
          <li>
            <strong>Prova de consentimento e pedidos de privacidade:</strong> mantidos,
            porque são a demonstração de que agimos com sua permissão.
          </li>
          <li>
            <strong>Estatísticas agregadas:</strong> mantidas indefinidamente, já sem
            ligação com você — deixam de ser dado pessoal.
          </li>
        </ul>

        <h2>9. Com quem compartilhamos</h2>
        <p>
          Com operadores que executam partes do serviço em nosso nome — hospedagem, banco
          de dados e envio de e-mail transacional (confirmação de cadastro, recuperação de
          senha) — cada um limitado ao necessário e proibido de usar seus dados para
          finalidade própria.
        </p>
        <p>
          Também compartilhamos quando houver ordem judicial ou obrigação legal. Se isso
          acontecer e a lei permitir avisar, avisaremos.
        </p>
        <p>
          Alguns operadores podem processar dados fora do Brasil. Nesses casos, exigimos
          garantias contratuais compatíveis com o que a LGPD determina para transferência
          internacional.
        </p>

        <h2>10. Cookies</h2>
        <p>
          Usamos cookie de <strong>sessão</strong>, indispensável para manter você logado —
          sem ele não há como saber que a próxima página é sua. Ele não rastreia navegação
          fora da Cinerie.
        </p>
        <p>
          Métricas de uso só ocorrem se você consentir (seção 4) e podem ser desligadas
          quando quiser. Não usamos cookies de publicidade de terceiros.
        </p>

        <h2>11. Segurança</h2>
        <p>
          Senhas são armazenadas apenas como derivação criptográfica; tokens de sessão e
          de recuperação, apenas como hash; endereços de IP, apenas como hash. Nenhum
          desses valores é devolvido em exportação, nem para você — devolver material de
          autenticação criaria um risco maior do que a transparência que resolveria.
        </p>
        <p>
          Nenhum sistema é inviolável. Se ocorrer incidente que possa acarretar risco
          relevante a você, comunicaremos você e a ANPD nos termos da lei.
        </p>

        <h2>12. Crianças e adolescentes</h2>
        <p>
          A Cinerie não é destinada a menores de 18 anos e não coletamos dados de crianças
          conscientemente. Se identificarmos uma conta nessa situação, ela será removida.
          Se você responde por um menor que criou conta aqui, escreva para{" "}
          {"{{EMAIL_ENCARREGADO}}"}.
        </p>

        <h2>13. Mudanças nesta Política</h2>
        <p>
          Publicaremos a nova versão aqui, com data e número. Mudança significativa é
          comunicada a quem tem conta antes de passar a valer, e o novo consentimento é
          registrado separadamente — a versão anterior que você aceitou continua no
          histórico.
        </p>

        <h2>14. Contato</h2>
        <p>
          Encarregado pela proteção de dados: {"{{NOME_ENCARREGADO}}"} —{" "}
          <strong>{"{{EMAIL_ENCARREGADO}}"}</strong>.
        </p>
        <p>
          Você também pode exercer boa parte dos seus direitos sozinho, sem escrever para
          ninguém, em <a href="/pt/conta/privacidade/">Conta → Privacidade</a>.
        </p>

        <p>
          <small>
            Versão {LEGAL_DOCUMENT_VERSION}, de {LEGAL_LAST_UPDATED_ISO}. Consulte também
            os <a href="/pt/termos/">Termos de Uso</a>.
          </small>
        </p>
      </LegalDocument>
    </>
  );
}
