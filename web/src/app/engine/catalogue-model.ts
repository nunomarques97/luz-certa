/**
 * Shape of web/public/data/catalogue.json. The types are defined once, next to the build script
 * that produces the file, and only imported as types here (nothing from scripts/ is bundled).
 */
export type {
  AccessTariffPeriod,
  Catalogue,
  CycleId,
  DayType,
  Fee,
  IndexedFormula,
  Offer,
  OfferPrice,
  Season,
  TariffType,
  TimeInterval,
  VatRule,
} from '../../../scripts/catalogue/catalogue-types.mts';
