import BlockIdField from '../../../src/admin/BlockIdField.js'
import CinerieIcon from '../../../src/admin/CinerieIcon.js'
import CinerieLogo from '../../../src/admin/CinerieLogo.js'
import EditorialDashboard from '../../../src/admin/EditorialDashboard.js'
import MediaLicenseNotice from '../../../src/admin/MediaLicenseNotice.js'
import MediaReleaseControl from '../../../src/admin/MediaReleaseControl.js'
import OriginCell from '../../../src/admin/OriginCell.js'
import ParagraphTextField from '../../../src/admin/ParagraphTextField.js'
import QaApprovalField from '../../../src/admin/QaApprovalField.js'
import SlugField from '../../../src/admin/SlugField.js'
import WorkflowTransitionBar from '../../../src/admin/WorkflowTransitionBar.js'

/**
 * A CHAVE PRECISA DO SUFIXO `#<export>`. NAO REMOVA.
 *
 * O Payload monta a chave de busca em `getFromImportMap` como
 * `path + '#' + exportName`, e `parsePayloadComponent` usa `'default'` quando a
 * string da configuracao nao traz `#`. Ou seja: um `Field` declarado na
 * collection SEM sufixo e procurado aqui COM `#default`.
 *
 * Sem o sufixo a busca simplesmente NAO ENCONTRA — e esse e o problema: o
 * componente nao renderiza, o campo some do formulario e **nao ha erro no
 * navegador**. O aviso do Payload sai no console do SERVIDOR, onde ninguem
 * estava olhando. Foi assim que a marca, o dashboard e os seis componentes
 * novos ficaram inertes com a tela parecendo normal.
 *
 * A travessia esta coberta por `src/__tests__/import-map.test.ts`, que compara
 * estas chaves com o que a configuracao realmente pede.
 */
export const importMap = {
  '/src/admin/BlockIdField#default': BlockIdField,
  '/src/admin/CinerieIcon#default': CinerieIcon,
  '/src/admin/CinerieLogo#default': CinerieLogo,
  '/src/admin/EditorialDashboard#default': EditorialDashboard,
  '/src/admin/MediaLicenseNotice#default': MediaLicenseNotice,
  '/src/admin/MediaReleaseControl#default': MediaReleaseControl,
  '/src/admin/OriginCell#default': OriginCell,
  '/src/admin/ParagraphTextField#default': ParagraphTextField,
  '/src/admin/QaApprovalField#default': QaApprovalField,
  '/src/admin/SlugField#default': SlugField,
  '/src/admin/WorkflowTransitionBar#default': WorkflowTransitionBar,
}
