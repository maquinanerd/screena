/**
 * language-vocabulary.ts — O DICIONARIO DE IDIOMAS DO MUNDO (ISO 639-1).
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * `languages` tinha TRES linhas: `pt-BR`, `en`, `es`. Ela era, ao mesmo tempo:
 *
 *   - o dicionario de idiomas (alvo da FK `movies.original_language`), e
 *   - a politica de autoria (em que idioma a ingestao cria slug/traducao).
 *
 * Conflacao com preco medido: como o dicionario so tinha os idiomas em que a
 * Cinerie ESCREVE, `normalizeOriginalLanguage` precisava descartar todo idioma
 * fora dele para nao violar a FK. Em 2026-08-31 a coluna estava NULA em 20.825
 * filmes (43%) e 20.680 series (60%), e a coluna inteira tinha exatamente TRES
 * valores possiveis: `en`, `es` e nulo. O portugues nem isso: o TMDB emite `pt`,
 * a tabela tinha `pt-BR`, e todo titulo brasileiro caiu para NULL.
 *
 * A politica mudou de casa (`CONTENT_AUTHORING_LOCALES` em @screena/config).
 * Esta tabela volta a ser o que o nome dela diz: um dicionario.
 *
 * ============================================================================
 * O VOCABULARIO E O DO TMDB, NAO O DA ISO PURA
 * ============================================================================
 * O TMDB publica `original_language` em ISO 639-1, com tres desvios que a norma
 * nao tem e que aparecem no catalogo de verdade:
 *
 *   `cn` — cantones (a ISO 639-1 nao tem; o codigo ISO 639-3 seria `yue`)
 *   `sh` — servo-croata (RETIRADO da ISO 639-1 em 2000, ainda emitido)
 *   `xx` — "sem idioma" (filme mudo / sem dialogo)
 *
 * Omitir os tres reintroduziria o defeito exatamente onde ele e menos visivel:
 * num punhado de titulos, calados de novo por uma lista fechada.
 *
 * Nenhuma linha daqui e "idioma publicado". `isPublished`/`indexDefault` sao
 * `false` para o vocabulario inteiro; quem publica e `PUBLISHED_LOCALES`.
 */

/** Uma entrada do dicionario: codigo ISO 639-1 + nome em pt e en. */
export interface LanguageVocabularyEntry {
  readonly code: string
  readonly namePt: string
  readonly nameEn: string
}

/**
 * Vocabulario ISO 639-1 completo + os tres desvios do TMDB.
 *
 * Ordenado por codigo para que uma insercao futura seja um diff de UMA linha e
 * nao um reordenamento que esconde a mudanca.
 */
export const LANGUAGE_VOCABULARY: readonly LanguageVocabularyEntry[] = [
  { code: 'aa', namePt: 'Afar', nameEn: 'Afar' },
  { code: 'ab', namePt: 'Abcazio', nameEn: 'Abkhazian' },
  { code: 'ae', namePt: 'Avestico', nameEn: 'Avestan' },
  { code: 'af', namePt: 'Africaner', nameEn: 'Afrikaans' },
  { code: 'ak', namePt: 'Akan', nameEn: 'Akan' },
  { code: 'am', namePt: 'Amarico', nameEn: 'Amharic' },
  { code: 'an', namePt: 'Aragones', nameEn: 'Aragonese' },
  { code: 'ar', namePt: 'Arabe', nameEn: 'Arabic' },
  { code: 'as', namePt: 'Assames', nameEn: 'Assamese' },
  { code: 'av', namePt: 'Avaro', nameEn: 'Avaric' },
  { code: 'ay', namePt: 'Aimara', nameEn: 'Aymara' },
  { code: 'az', namePt: 'Azerbaijano', nameEn: 'Azerbaijani' },
  { code: 'ba', namePt: 'Bashkir', nameEn: 'Bashkir' },
  { code: 'be', namePt: 'Bielorrusso', nameEn: 'Belarusian' },
  { code: 'bg', namePt: 'Bulgaro', nameEn: 'Bulgarian' },
  { code: 'bi', namePt: 'Bislama', nameEn: 'Bislama' },
  { code: 'bm', namePt: 'Bambara', nameEn: 'Bambara' },
  { code: 'bn', namePt: 'Bengali', nameEn: 'Bengali' },
  { code: 'bo', namePt: 'Tibetano', nameEn: 'Tibetan' },
  { code: 'br', namePt: 'Bretao', nameEn: 'Breton' },
  { code: 'bs', namePt: 'Bosnio', nameEn: 'Bosnian' },
  { code: 'ca', namePt: 'Catalao', nameEn: 'Catalan' },
  { code: 'ce', namePt: 'Checheno', nameEn: 'Chechen' },
  { code: 'ch', namePt: 'Chamorro', nameEn: 'Chamorro' },
  { code: 'cn', namePt: 'Cantones', nameEn: 'Cantonese' },
  { code: 'co', namePt: 'Corso', nameEn: 'Corsican' },
  { code: 'cr', namePt: 'Cree', nameEn: 'Cree' },
  { code: 'cs', namePt: 'Tcheco', nameEn: 'Czech' },
  { code: 'cu', namePt: 'Eslavo eclesiastico', nameEn: 'Church Slavic' },
  { code: 'cv', namePt: 'Chuvache', nameEn: 'Chuvash' },
  { code: 'cy', namePt: 'Gales', nameEn: 'Welsh' },
  { code: 'da', namePt: 'Dinamarques', nameEn: 'Danish' },
  { code: 'de', namePt: 'Alemao', nameEn: 'German' },
  { code: 'dv', namePt: 'Divehi', nameEn: 'Divehi' },
  { code: 'dz', namePt: 'Dzonga', nameEn: 'Dzongkha' },
  { code: 'ee', namePt: 'Ewe', nameEn: 'Ewe' },
  { code: 'el', namePt: 'Grego', nameEn: 'Greek' },
  { code: 'en', namePt: 'Ingles', nameEn: 'English' },
  { code: 'eo', namePt: 'Esperanto', nameEn: 'Esperanto' },
  { code: 'es', namePt: 'Espanhol', nameEn: 'Spanish' },
  { code: 'et', namePt: 'Estoniano', nameEn: 'Estonian' },
  { code: 'eu', namePt: 'Basco', nameEn: 'Basque' },
  { code: 'fa', namePt: 'Persa', nameEn: 'Persian' },
  { code: 'ff', namePt: 'Fula', nameEn: 'Fulah' },
  { code: 'fi', namePt: 'Finlandes', nameEn: 'Finnish' },
  { code: 'fj', namePt: 'Fijiano', nameEn: 'Fijian' },
  { code: 'fo', namePt: 'Feroes', nameEn: 'Faroese' },
  { code: 'fr', namePt: 'Frances', nameEn: 'French' },
  { code: 'fy', namePt: 'Frisio ocidental', nameEn: 'Western Frisian' },
  { code: 'ga', namePt: 'Irlandes', nameEn: 'Irish' },
  { code: 'gd', namePt: 'Gaelico escoces', nameEn: 'Scottish Gaelic' },
  { code: 'gl', namePt: 'Galego', nameEn: 'Galician' },
  { code: 'gn', namePt: 'Guarani', nameEn: 'Guarani' },
  { code: 'gu', namePt: 'Guzerate', nameEn: 'Gujarati' },
  { code: 'gv', namePt: 'Manes', nameEn: 'Manx' },
  { code: 'ha', namePt: 'Hausa', nameEn: 'Hausa' },
  { code: 'he', namePt: 'Hebraico', nameEn: 'Hebrew' },
  { code: 'hi', namePt: 'Hindi', nameEn: 'Hindi' },
  { code: 'ho', namePt: 'Hiri motu', nameEn: 'Hiri Motu' },
  { code: 'hr', namePt: 'Croata', nameEn: 'Croatian' },
  { code: 'ht', namePt: 'Crioulo haitiano', nameEn: 'Haitian Creole' },
  { code: 'hu', namePt: 'Hungaro', nameEn: 'Hungarian' },
  { code: 'hy', namePt: 'Armenio', nameEn: 'Armenian' },
  { code: 'hz', namePt: 'Herero', nameEn: 'Herero' },
  { code: 'ia', namePt: 'Interlingua', nameEn: 'Interlingua' },
  { code: 'id', namePt: 'Indonesio', nameEn: 'Indonesian' },
  { code: 'ie', namePt: 'Interlingue', nameEn: 'Interlingue' },
  { code: 'ig', namePt: 'Igbo', nameEn: 'Igbo' },
  { code: 'ii', namePt: 'Yi de Sichuan', nameEn: 'Sichuan Yi' },
  { code: 'ik', namePt: 'Inupiaque', nameEn: 'Inupiaq' },
  { code: 'io', namePt: 'Ido', nameEn: 'Ido' },
  { code: 'is', namePt: 'Islandes', nameEn: 'Icelandic' },
  { code: 'it', namePt: 'Italiano', nameEn: 'Italian' },
  { code: 'iu', namePt: 'Inuktitut', nameEn: 'Inuktitut' },
  { code: 'ja', namePt: 'Japones', nameEn: 'Japanese' },
  { code: 'jv', namePt: 'Javanes', nameEn: 'Javanese' },
  { code: 'ka', namePt: 'Georgiano', nameEn: 'Georgian' },
  { code: 'kg', namePt: 'Congoles', nameEn: 'Kongo' },
  { code: 'ki', namePt: 'Quicuio', nameEn: 'Kikuyu' },
  { code: 'kj', namePt: 'Kuanyama', nameEn: 'Kuanyama' },
  { code: 'kk', namePt: 'Cazaque', nameEn: 'Kazakh' },
  { code: 'kl', namePt: 'Groenlandes', nameEn: 'Kalaallisut' },
  { code: 'km', namePt: 'Khmer', nameEn: 'Khmer' },
  { code: 'kn', namePt: 'Canares', nameEn: 'Kannada' },
  { code: 'ko', namePt: 'Coreano', nameEn: 'Korean' },
  { code: 'kr', namePt: 'Canuri', nameEn: 'Kanuri' },
  { code: 'ks', namePt: 'Caxemira', nameEn: 'Kashmiri' },
  { code: 'ku', namePt: 'Curdo', nameEn: 'Kurdish' },
  { code: 'kv', namePt: 'Komi', nameEn: 'Komi' },
  { code: 'kw', namePt: 'Cornico', nameEn: 'Cornish' },
  { code: 'ky', namePt: 'Quirguiz', nameEn: 'Kyrgyz' },
  { code: 'la', namePt: 'Latim', nameEn: 'Latin' },
  { code: 'lb', namePt: 'Luxemburgues', nameEn: 'Luxembourgish' },
  { code: 'lg', namePt: 'Luganda', nameEn: 'Ganda' },
  { code: 'li', namePt: 'Limburgues', nameEn: 'Limburgish' },
  { code: 'ln', namePt: 'Lingala', nameEn: 'Lingala' },
  { code: 'lo', namePt: 'Laosiano', nameEn: 'Lao' },
  { code: 'lt', namePt: 'Lituano', nameEn: 'Lithuanian' },
  { code: 'lu', namePt: 'Luba-catanga', nameEn: 'Luba-Katanga' },
  { code: 'lv', namePt: 'Letao', nameEn: 'Latvian' },
  { code: 'mg', namePt: 'Malgaxe', nameEn: 'Malagasy' },
  { code: 'mh', namePt: 'Marshales', nameEn: 'Marshallese' },
  { code: 'mi', namePt: 'Maori', nameEn: 'Maori' },
  { code: 'mk', namePt: 'Macedonio', nameEn: 'Macedonian' },
  { code: 'ml', namePt: 'Malaiala', nameEn: 'Malayalam' },
  { code: 'mn', namePt: 'Mongol', nameEn: 'Mongolian' },
  { code: 'mr', namePt: 'Marata', nameEn: 'Marathi' },
  { code: 'ms', namePt: 'Malaio', nameEn: 'Malay' },
  { code: 'mt', namePt: 'Maltes', nameEn: 'Maltese' },
  { code: 'my', namePt: 'Birmanes', nameEn: 'Burmese' },
  { code: 'na', namePt: 'Nauruano', nameEn: 'Nauru' },
  { code: 'nb', namePt: 'Norueges bokmal', nameEn: 'Norwegian Bokmal' },
  { code: 'nd', namePt: 'Ndebele do norte', nameEn: 'North Ndebele' },
  { code: 'ne', namePt: 'Nepali', nameEn: 'Nepali' },
  { code: 'ng', namePt: 'Ndonga', nameEn: 'Ndonga' },
  { code: 'nl', namePt: 'Holandes', nameEn: 'Dutch' },
  { code: 'nn', namePt: 'Norueges nynorsk', nameEn: 'Norwegian Nynorsk' },
  { code: 'no', namePt: 'Norueges', nameEn: 'Norwegian' },
  { code: 'nr', namePt: 'Ndebele do sul', nameEn: 'South Ndebele' },
  { code: 'nv', namePt: 'Navajo', nameEn: 'Navajo' },
  { code: 'ny', namePt: 'Chichewa', nameEn: 'Chichewa' },
  { code: 'oc', namePt: 'Occitano', nameEn: 'Occitan' },
  { code: 'oj', namePt: 'Ojibwa', nameEn: 'Ojibwa' },
  { code: 'om', namePt: 'Oromo', nameEn: 'Oromo' },
  { code: 'or', namePt: 'Oria', nameEn: 'Oriya' },
  { code: 'os', namePt: 'Osseto', nameEn: 'Ossetian' },
  { code: 'pa', namePt: 'Panjabi', nameEn: 'Punjabi' },
  { code: 'pi', namePt: 'Pali', nameEn: 'Pali' },
  { code: 'pl', namePt: 'Polones', nameEn: 'Polish' },
  { code: 'ps', namePt: 'Pasto', nameEn: 'Pashto' },
  { code: 'pt', namePt: 'Portugues', nameEn: 'Portuguese' },
  { code: 'qu', namePt: 'Quiche', nameEn: 'Quechua' },
  { code: 'rm', namePt: 'Romanche', nameEn: 'Romansh' },
  { code: 'rn', namePt: 'Rundi', nameEn: 'Rundi' },
  { code: 'ro', namePt: 'Romeno', nameEn: 'Romanian' },
  { code: 'ru', namePt: 'Russo', nameEn: 'Russian' },
  { code: 'rw', namePt: 'Quiniaruanda', nameEn: 'Kinyarwanda' },
  { code: 'sa', namePt: 'Sanscrito', nameEn: 'Sanskrit' },
  { code: 'sc', namePt: 'Sardo', nameEn: 'Sardinian' },
  { code: 'sd', namePt: 'Sindi', nameEn: 'Sindhi' },
  { code: 'se', namePt: 'Sami do norte', nameEn: 'Northern Sami' },
  { code: 'sg', namePt: 'Sango', nameEn: 'Sango' },
  { code: 'sh', namePt: 'Servo-croata', nameEn: 'Serbo-Croatian' },
  { code: 'si', namePt: 'Cingales', nameEn: 'Sinhala' },
  { code: 'sk', namePt: 'Eslovaco', nameEn: 'Slovak' },
  { code: 'sl', namePt: 'Esloveno', nameEn: 'Slovenian' },
  { code: 'sm', namePt: 'Samoano', nameEn: 'Samoan' },
  { code: 'sn', namePt: 'Xona', nameEn: 'Shona' },
  { code: 'so', namePt: 'Somali', nameEn: 'Somali' },
  { code: 'sq', namePt: 'Albanes', nameEn: 'Albanian' },
  { code: 'sr', namePt: 'Servio', nameEn: 'Serbian' },
  { code: 'ss', namePt: 'Suazi', nameEn: 'Swati' },
  { code: 'st', namePt: 'Soto do sul', nameEn: 'Southern Sotho' },
  { code: 'su', namePt: 'Sundanes', nameEn: 'Sundanese' },
  { code: 'sv', namePt: 'Sueco', nameEn: 'Swedish' },
  { code: 'sw', namePt: 'Suaili', nameEn: 'Swahili' },
  { code: 'ta', namePt: 'Tamil', nameEn: 'Tamil' },
  { code: 'te', namePt: 'Telugo', nameEn: 'Telugu' },
  { code: 'tg', namePt: 'Tadjique', nameEn: 'Tajik' },
  { code: 'th', namePt: 'Tailandes', nameEn: 'Thai' },
  { code: 'ti', namePt: 'Tigrinia', nameEn: 'Tigrinya' },
  { code: 'tk', namePt: 'Turcomano', nameEn: 'Turkmen' },
  { code: 'tl', namePt: 'Tagalo', nameEn: 'Tagalog' },
  { code: 'tn', namePt: 'Tsuana', nameEn: 'Tswana' },
  { code: 'to', namePt: 'Tonganes', nameEn: 'Tongan' },
  { code: 'tr', namePt: 'Turco', nameEn: 'Turkish' },
  { code: 'ts', namePt: 'Tsonga', nameEn: 'Tsonga' },
  { code: 'tt', namePt: 'Tartaro', nameEn: 'Tatar' },
  { code: 'tw', namePt: 'Twi', nameEn: 'Twi' },
  { code: 'ty', namePt: 'Taitiano', nameEn: 'Tahitian' },
  { code: 'ug', namePt: 'Uigur', nameEn: 'Uyghur' },
  { code: 'uk', namePt: 'Ucraniano', nameEn: 'Ukrainian' },
  { code: 'ur', namePt: 'Urdu', nameEn: 'Urdu' },
  { code: 'uz', namePt: 'Uzbeque', nameEn: 'Uzbek' },
  { code: 've', namePt: 'Venda', nameEn: 'Venda' },
  { code: 'vi', namePt: 'Vietnamita', nameEn: 'Vietnamese' },
  { code: 'vo', namePt: 'Volapuque', nameEn: 'Volapuk' },
  { code: 'wa', namePt: 'Valao', nameEn: 'Walloon' },
  { code: 'wo', namePt: 'Uolofe', nameEn: 'Wolof' },
  { code: 'xh', namePt: 'Xhosa', nameEn: 'Xhosa' },
  { code: 'xx', namePt: 'Sem idioma', nameEn: 'No Language' },
  { code: 'yi', namePt: 'Iidiche', nameEn: 'Yiddish' },
  { code: 'yo', namePt: 'Ioruba', nameEn: 'Yoruba' },
  { code: 'za', namePt: 'Zhuang', nameEn: 'Zhuang' },
  { code: 'zh', namePt: 'Chines', nameEn: 'Chinese' },
  { code: 'zu', namePt: 'Zulu', nameEn: 'Zulu' },
]
