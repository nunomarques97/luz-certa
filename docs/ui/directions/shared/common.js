/* Shared helpers and draft Portuguese copy for the three design prototypes. Static, no network. */
window.LC = (() => {
  const data = window.LC_DATA;

  const eurFormat = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
  const eur0Format = new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
  const numFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
  const num1Format = new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MONTHS_LONG = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  const ranking = data.ranking;
  const current = ranking.find((t) => t.isCurrent);
  const best = ranking[0];

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function eur(value) {
    return eurFormat.format(value);
  }

  function eur0(value) {
    return eur0Format.format(value);
  }

  /** Signed amount with a real minus sign, e.g. "−38,63 €" or "+19,41 €". */
  function signedEur(value) {
    if (Math.abs(value) < 0.005) return '0,00 €';
    return (value < 0 ? '−' : '+') + eurFormat.format(Math.abs(value));
  }

  function kwh(value) {
    return numFormat.format(value) + ' kWh';
  }

  function name(t) {
    if (t.isCurrent) return 'A sua tarifa atual';
    if (t.name.startsWith(t.supplier)) return t.name;
    return t.supplier + ' ' + t.name;
  }

  function offerName(t) {
    if (t.isCurrent) return 'Preços que indicou';
    return t.name.startsWith(t.supplier) ? t.name.slice(t.supplier.length).trim() || t.name : t.name;
  }

  function cycleLabel(t) {
    if (t.tariffType === 'simple') return 'simples';
    return t.cycle === 'weekly' ? 'bi-horária, ciclo semanal' : 'bi-horária, ciclo diário';
  }

  function kindLabel(t) {
    const pricing = t.pricing === 'omie_indexed' ? 'Indexada ao OMIE' : 'Preço fixo';
    return pricing + ', ' + cycleLabel(t);
  }

  /** "menos 38,63 € do que a sua tarifa atual" style sentence fragment. */
  function deltaSentence(t) {
    if (t.isCurrent) return 'a sua tarifa atual';
    const amount = eur(Math.abs(t.diff));
    return t.diff < 0 ? amount + ' menos do que a atual' : amount + ' mais do que a atual';
  }

  function monthShort(key) {
    return MONTHS_SHORT[Number(key.slice(5, 7)) - 1];
  }

  function monthLong(key) {
    return MONTHS_LONG[Number(key.slice(5, 7)) - 1];
  }

  const period = {
    label: '1 de janeiro a 31 de dezembro de 2025',
    short: 'jan. a dez. 2025',
    days: data.period.days,
    totalKwh: data.consumption.totalKwh,
    kva: '6,9 kVA',
    fileName: 'Consumos_20260102.xlsx',
  };

  const verifiedOn = '2 de outubro de 2026';

  /** Assumptions shown on every result, in reading order. */
  const generalAssumptions = [
    'Cada mês civil conta como um período de faturação.',
    'Ofertas de preço fixo: os preços atuais do catálogo (versão 2026.10.02) são aplicados ao consumo passado. O preço real em 2025 pode ter sido outro.',
    'Ofertas indexadas: preços OMIE históricos e tarifas de acesso à rede (TAR) em vigor em cada dia.',
    'Os preços OMIE são publicados na hora de Espanha. A hora de Lisboa é uma hora a menos.',
    'Até 30 de setembro de 2025 o OMIE publicava preços por hora: cada preço vale para os quatro quartos de hora dessa hora.',
    '66 leituras marcadas como estimadas pela E-Redes foram usadas tal como estão. Não falta nenhum quarto de hora.',
    'IVA a 23 %, e a 6 % sobre a energia até 200 kWh por 30 dias (potência até 6,9 kVA, desde 1 de janeiro de 2025).',
    'IEC 0,001 €/kWh, taxa DGEG 0,07 € por mês e contribuição audiovisual 0,09363 € por dia, valores atuais, sem isenções.',
    'Ofertas bi-horárias: horários atuais dos ciclos da ERSE em todo o período. Feriados contam como dias normais.',
    'A sua tarifa atual: os preços que indicou são lidos sem IVA e já com as tarifas de acesso.',
  ];

  /** Assumptions that qualify one offer. */
  const offerNotes = {
    'coopernico-unico-simple': [
      'Fator de perdas indicativo de 15 %.',
      'Custos de sistema sem valor publicado não estão incluídos: a fatura real seria mais alta.',
      'Preço de potência e taxas extra atuais aplicados a todo o período.',
    ],
    'goldenergy-index-04-25-simple': [
      'Fator de perdas não publicado: calculado sem perdas, a fatura real seria mais alta.',
      'Média aritmética mensal dos preços OMIE.',
    ],
    'edp-indexada-media-dd-fe-simple': [
      'Média mensal dos preços OMIE por período tarifário.',
      'Potência: TAR em vigor em cada dia mais 0,1171 € por dia.',
    ],
    'edp-indexada-horaria-dd-fe-bi-hourly': [
      'Fator de perdas indicativo de 16,4 %.',
      'Potência: TAR em vigor em cada dia mais 0,1171 € por dia.',
    ],
  };

  function sourceHost(t) {
    if (!t.sourceUrl) return '';
    return new URL(t.sourceUrl).host.replace(/^www\./, '');
  }

  const guide = [
    'Entre no Balcão Digital da E-Redes (balcaodigital.e-redes.pt) com a sua conta.',
    'Abra Consumos, escolha a sua instalação e um período de 12 meses.',
    'Escolha os dados de 15 em 15 minutos e carregue em Exportar excel.',
    'Traga para aqui o ficheiro Consumos_AAAAMMDD.xlsx que descarregou.',
  ];

  const privacy = 'O ficheiro não sai do seu dispositivo.';
  const privacyDetail =
    'A leitura e as contas são feitas neste navegador. Nada do seu consumo é enviado para nenhum servidor.';

  return {
    data,
    ranking,
    current,
    best,
    esc,
    eur,
    eur0,
    signedEur,
    kwh,
    num1: (v) => num1Format.format(v),
    pct: (v) => numFormat.format(v * 100) + ' %',
    name,
    offerName,
    kindLabel,
    cycleLabel,
    deltaSentence,
    monthShort,
    monthLong,
    period,
    verifiedOn,
    generalAssumptions,
    offerNotes,
    sourceHost,
    guide,
    privacy,
    privacyDetail,
  };
})();
