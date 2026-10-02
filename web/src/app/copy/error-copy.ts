import type { EngineErrorCode } from '../engine/engine-errors';
import type { ParseErrorCode, ParseErrorDetails } from '../engine/parse-errors';
import type { EngineFailure } from '../worker/engine-protocol';
import { isoDateLong } from './format';

/** Failures the app itself can produce before the engine runs. */
export type AppFailure = EngineFailure | { kind: 'file'; code: 'FILE_UNREADABLE' };

/**
 * How the user recovers:
 * - `choose-file`: pick another file (the upload screen shows the banner above the upload zone);
 * - `edit-settings`: change the setup form and calculate again (the banner sits above the form);
 * - `retry`: run the last submitted file and settings again.
 */
export type RecoveryPath = 'choose-file' | 'edit-settings' | 'retry';

export interface ErrorCopy {
  title: string;
  detail: string;
  recovery: RecoveryPath;
}

export interface ErrorCopyContext {
  /** Dates covered by the catalogue access tariffs (ISO), when known. */
  cataloguePeriod?: { from: string; to: string };
}

const EXPORT_AGAIN =
  'Exporte de novo os consumos de 15 em 15 minutos no Balcão Digital da E-Redes e carregue o ficheiro sem o alterar.';

const PARSE_COPY: Record<ParseErrorCode, { title: string; detail: string }> = {
  NOT_XLSX: {
    title: 'Este ficheiro não é uma folha de cálculo .xlsx',
    detail:
      'No Balcão Digital escolha Exportar excel e carregue o ficheiro .xlsx descarregado, sem o abrir nem guardar noutro formato.',
  },
  FILE_TOO_LARGE: {
    title: 'O ficheiro é demasiado grande',
    detail: 'Aceitamos ficheiros até 25 MB. Exporte um período mais curto, por exemplo 12 meses.',
  },
  DECOMPRESSED_TOO_LARGE: {
    title: 'O conteúdo do ficheiro é demasiado grande',
    detail: 'Exporte um período mais curto, por exemplo 12 meses, e carregue esse ficheiro.',
  },
  MALFORMED_XLSX: {
    title: 'Não conseguimos abrir este ficheiro',
    detail: `O ficheiro parece danificado, incompleto ou protegido por palavra-passe. ${EXPORT_AGAIN}`,
  },
  MISSING_COLUMNS: {
    title: 'Não conseguimos ler este ficheiro',
    detail: `Faltam as colunas Data, Hora ou consumo. ${EXPORT_AGAIN}`,
  },
  UNKNOWN_COLUMN: {
    title: 'O ficheiro tem uma coluna que não conhecemos',
    detail: `Carregue o ficheiro tal como foi exportado, sem colunas acrescentadas. ${EXPORT_AGAIN}`,
  },
  NOT_15_MINUTE: {
    title: 'As leituras não são de 15 em 15 minutos',
    detail:
      'Ao exportar no Balcão Digital escolha os dados de 15 em 15 minutos. Ficheiros com leituras horárias ou diárias não servem.',
  },
  INVALID_DATE: {
    title: 'Há uma data ou hora que não conseguimos ler',
    detail: EXPORT_AGAIN,
  },
  INVALID_VALUE: {
    title: 'Há um valor de consumo que não conseguimos ler',
    detail: EXPORT_AGAIN,
  },
  TOO_MANY_ROWS: {
    title: 'O ficheiro tem demasiadas linhas',
    detail: 'Exporte um período mais curto, por exemplo 12 meses, e carregue esse ficheiro.',
  },
  NO_DATA: {
    title: 'O ficheiro não tem leituras',
    detail:
      'Confirme no Balcão Digital que o período escolhido tem consumos e exporte de novo os dados de 15 em 15 minutos.',
  },
};

function engineCopy(code: EngineErrorCode, context: ErrorCopyContext): ErrorCopy {
  switch (code) {
    case 'UNSUPPORTED_CATALOGUE':
      return {
        title: 'A lista de tarifas não pôde ser usada',
        detail: 'Recarregue a página e tente de novo.',
        recovery: 'retry',
      };
    case 'UNSUPPORTED_POWER':
      return {
        title: 'Esta potência contratada não é suportada',
        detail: 'Escolha a potência que aparece na sua fatura, de 1,15 a 20,7 kVA, e calcule de novo.',
        recovery: 'edit-settings',
      };
    case 'UNKNOWN_OFFER':
      return {
        title: 'Não encontrámos a tarifa escolhida',
        detail: 'Escolha de novo a sua tarifa atual na lista, ou indique os preços da sua fatura.',
        recovery: 'edit-settings',
      };
    case 'CURRENT_OFFER_UNAVAILABLE':
      return {
        title: 'A sua tarifa não tem preço para esta potência',
        detail: 'Confirme a potência contratada, ou indique os preços que aparecem na sua fatura.',
        recovery: 'edit-settings',
      };
    case 'INVALID_MANUAL_PRICES':
      return {
        title: 'Os preços indicados não são válidos',
        detail:
          'Indique os preços sem IVA, em €/kWh para a energia e em €/dia para a potência, como aparecem no tarifário.',
        recovery: 'edit-settings',
      };
    case 'PERIOD_OUTSIDE_CATALOGUE': {
      const range = context.cataloguePeriod
        ? `de ${isoDateLong(context.cataloguePeriod.from)} a ${isoDateLong(context.cataloguePeriod.to)}`
        : 'para todo o período do ficheiro';
      return {
        title: 'O período do ficheiro não está coberto',
        detail: `Só temos as tarifas de acesso à rede ${range}. Exporte um período dentro destas datas e carregue esse ficheiro.`,
        recovery: 'choose-file',
      };
    }
  }
}

function location(details: ParseErrorDetails): string {
  if (details.row && details.column) {
    return ` Linha ${details.row}, coluna ${details.column}.`;
  }
  if (details.row) {
    return ` Linha ${details.row}.`;
  }
  if (details.column) {
    return ` Coluna ${details.column}.`;
  }
  return '';
}

/** Portuguese copy and recovery path for every failure the analysis can end with. */
export function errorCopy(failure: AppFailure, context: ErrorCopyContext = {}): ErrorCopy {
  switch (failure.kind) {
    case 'parse': {
      const copy = PARSE_COPY[failure.code];
      return {
        title: copy.title,
        detail: copy.detail + location(failure.details),
        recovery: 'choose-file',
      };
    }
    case 'engine':
      return engineCopy(failure.code, context);
    case 'data':
      return {
        title: 'Não foi possível carregar os preços',
        detail:
          'Os preços OMIE ou a lista de tarifas não chegaram a carregar. Verifique a ligação à internet e tente de novo.',
        recovery: 'retry',
      };
    case 'file':
      return {
        title: 'Não conseguimos ler o ficheiro',
        detail: 'O navegador não conseguiu abrir o ficheiro escolhido. Escolha-o de novo.',
        recovery: 'choose-file',
      };
    case 'internal':
      return failure.code === 'WORKER_FAILED'
        ? {
            title: 'O cálculo parou a meio',
            detail:
              'O navegador interrompeu o cálculo, talvez por falta de memória. Feche outros separadores e tente de novo.',
            recovery: 'retry',
          }
        : {
            title: 'Algo correu mal no cálculo',
            detail: 'Tente de novo. Se o erro se repetir, recarregue a página.',
            recovery: 'retry',
          };
  }
}
