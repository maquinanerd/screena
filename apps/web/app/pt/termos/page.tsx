import type { Metadata } from "next";

import { serializeJsonLd } from "@screena/seo";

import { LegalDocument } from "../../_components/legal-document";
import {
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
 * /pt/termos — Termos de Uso.
 *
 * Existe porque o formulario de cadastro (`/pt/criar-conta`), que esta NO AR,
 * exige o aceite obrigatorio deste documento e linka para ca — e o link dava 404
 * em producao. Aceite de um documento inexistente nao vincula ninguem.
 *
 * O texto e MINUTA ate `LEGAL_DOCUMENTS_REVIEWED` virar `true`. Ver
 * `src/lib/legal.ts` para o porque de cada decisao.
 *
 * Estatica de proposito: sem banco, sem API externa, sem `force-dynamic`. O
 * conteudo nao depende de estado — e uma pagina institucional que muda quando um
 * humano decide muda-la, nao a cada request.
 */

const TITLE = "Termos de Uso";
const DESCRIPTION =
  "As regras de uso da Cinerie: o que você pode fazer na plataforma, o que nós garantimos e o que não prometemos.";
const TERMS_PATH = "/pt/termos/";

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(legalDocumentShouldIndex()),
    alternates: { canonical: canonicalPublicUrl(TERMS_PATH) },
  };
}

export default function TermsPage() {
  const canonicalUrl = canonicalPublicUrl(TERMS_PATH);

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
        resumo="Estas são as regras do serviço. Se você criou uma conta, elas valem para você."
        titulo={TITLE}
      >
        <h2>1. Quem opera a Cinerie</h2>
        <p>
          A Cinerie é operada por {"{{RAZAO_SOCIAL}}"}, inscrita no CNPJ sob o nº{" "}
          {"{{CNPJ}}"}, com sede em {"{{ENDERECO}}"}. Ao longo deste documento,
          “nós” e “Cinerie” se referem a essa empresa. Para falar com a gente sobre
          qualquer assunto destes Termos, escreva para {"{{EMAIL_CONTATO}}"}.
        </p>

        <h2>2. O que a Cinerie é</h2>
        <p>
          A Cinerie é uma base de informações sobre filmes, séries, temporadas,
          episódios e pessoas do audiovisual, com uma camada editorial própria. Você
          pode consultar fichas, acompanhar o que assistiu, montar listas e escrever
          avaliações.
        </p>
        <p>
          <strong>A Cinerie não exibe filmes nem séries.</strong> Não somos um serviço
          de streaming e não hospedamos, transmitimos nem disponibilizamos obras
          audiovisuais. Quando indicamos onde assistir a um título, apontamos apenas
          para serviços legalmente licenciados — e essa informação pode estar
          desatualizada ou não valer no seu país.
        </p>

        <h2>3. Sua conta</h2>
        <p>
          Criar conta é opcional: quase tudo na Cinerie pode ser consultado sem login.
          A conta existe para guardar o que é seu — listas, avaliações, histórico.
        </p>
        <p>
          Você é responsável por manter sua senha em segredo e por tudo que acontecer
          na sua conta. Se desconfiar de acesso indevido, troque a senha e nos avise em{" "}
          {"{{EMAIL_CONTATO}}"}.
        </p>
        <p>
          Para criar conta você precisa ter pelo menos 18 anos, ou ter autorização de
          quem responde legalmente por você.
        </p>

        <h2>4. O que você escreve</h2>
        <p>
          Avaliações, resenhas, listas e comentários continuam sendo seus. Ao publicá-los
          na Cinerie, você nos autoriza a exibi-los, armazená-los e distribuí-los dentro
          da plataforma enquanto o conteúdo estiver publicado — o suficiente para o
          serviço funcionar, e nada além disso. Você pode apagá-los quando quiser.
        </p>
        <p>Ao escrever na Cinerie, você concorda em não publicar:</p>
        <ul>
          <li>conteúdo ilegal, ou que incite violência, ódio ou discriminação;</li>
          <li>
            links para cópias piratas, torrents, IPTV irregular ou qualquer forma de
            acesso não licenciado a obras;
          </li>
          <li>material de terceiros sem o direito de usá-lo;</li>
          <li>dados pessoais de outras pessoas sem o consentimento delas;</li>
          <li>spam, propaganda disfarçada ou manipulação de notas.</li>
        </ul>
        <p>
          Conteúdo que viole estas regras pode ser removido. Se isso acontecer com algo
          seu, você será informado e poderá contestar pelo {"{{EMAIL_CONTATO}}"}.
        </p>

        <h2>5. Conteúdo de terceiros e conteúdo nosso</h2>
        <p>
          Boa parte das fichas — títulos, sinopses, elenco, imagens — vem de fontes
          licenciadas e pertence a quem as produziu. Notas de sites de avaliação
          pertencem a esses sites e aparecem sempre atribuídas à fonte, na escala
          original dela. Nós não convertemos nota de uma fonte para o formato de outra.
        </p>
        <p>
          O texto editorial escrito pela Cinerie, a organização do catálogo e a marca são
          nossos. Você pode citar trechos com atribuição e link; reproduzir integralmente
          ou raspar o acervo, não.
        </p>
        <p>
          Parte do conteúdo editorial é produzida com auxílio de inteligência artificial a
          partir de dados que já estão na nossa base, e passa por conferência antes de ser
          publicada. Ainda assim, erro é possível — ver a seção 7.
        </p>

        <h2>6. O que você não deve fazer</h2>
        <ul>
          <li>tentar burlar limites técnicos, autenticação ou controles de acesso;</li>
          <li>
            coletar dados em massa por robô, raspagem ou automação sem autorização por
            escrito;
          </li>
          <li>sobrecarregar a infraestrutura de propósito;</li>
          <li>usar a Cinerie para distribuir malware ou aplicar golpes;</li>
          <li>criar contas em massa ou fingir ser outra pessoa.</li>
        </ul>

        <h2>7. Sobre a precisão das informações</h2>
        <p>
          A Cinerie é oferecida como está. Trabalhamos para que datas, elenco, notas e
          disponibilidade estejam corretos, mas <strong>não garantimos que estejam</strong>:
          dados mudam, fontes erram e integrações falham. Não tome decisão relevante — uma
          assinatura, uma compra — com base apenas no que leu aqui, sem conferir na fonte.
        </p>
        <p>
          Também não garantimos que o serviço fique disponível sem interrupção. Podemos
          alterar, suspender ou descontinuar funcionalidades; quando a mudança for
          significativa e afetar sua conta, avisaremos com antecedência razoável.
        </p>

        <h2>8. Limite de responsabilidade</h2>
        <p>
          Na máxima extensão permitida pela lei brasileira, a Cinerie não responde por
          danos indiretos, lucros cessantes ou perda de dados decorrentes do uso da
          plataforma. Nada nesta seção afasta as garantias que o Código de Defesa do
          Consumidor assegura a você.
        </p>

        <h2>9. Encerramento</h2>
        <p>
          Você pode encerrar sua conta quando quiser, em Conta → Privacidade. O que
          acontece com cada tipo de dado está descrito na{" "}
          <a href="/pt/privacidade/">Política de Privacidade</a>.
        </p>
        <p>
          Podemos suspender ou encerrar uma conta que viole estes Termos de forma grave ou
          repetida. Salvo quando a lei impedir ou houver risco de segurança, avisaremos
          antes e explicaremos o motivo.
        </p>

        <h2>10. Mudanças nestes Termos</h2>
        <p>
          Quando o texto mudar, publicaremos a nova versão aqui com data e número de
          versão. Se a mudança for significativa, avisaremos quem tem conta antes de ela
          passar a valer. Continuar usando a Cinerie depois disso significa aceitar a
          versão nova; se você não concordar, pode encerrar a conta.
        </p>
        <p>
          Guardamos o registro de qual versão você aceitou e quando — é o que nos permite
          demonstrar que houve consentimento informado.
        </p>

        <h2>11. Lei aplicável</h2>
        <p>
          Estes Termos são regidos pela lei brasileira. Fica eleito o foro de{" "}
          {"{{FORO}}"} para dirimir controvérsias, sem prejuízo do direito do consumidor
          de acionar o foro do seu próprio domicílio.
        </p>

        <h2>12. Contato</h2>
        <p>
          Dúvidas sobre estes Termos: {"{{EMAIL_CONTATO}}"}. Assuntos de dados pessoais
          têm canal próprio, descrito na{" "}
          <a href="/pt/privacidade/">Política de Privacidade</a>.
        </p>

        <p>
          <small>
            Versão {LEGAL_DOCUMENT_VERSION}, de {LEGAL_LAST_UPDATED_ISO}.
          </small>
        </p>
      </LegalDocument>
    </>
  );
}
