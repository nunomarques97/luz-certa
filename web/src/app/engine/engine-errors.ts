/**
 * Typed rejection reasons for the cost engine. The UI maps each code to its own copy.
 */
export const ENGINE_ERROR_CODES = [
  /** The catalogue has an unsupported schema version or shape. */
  'UNSUPPORTED_CATALOGUE',
  /** The contracted power is not one of the standard BTN values in the access tariffs. */
  'UNSUPPORTED_POWER',
  /** The current tariff refers to an offer id that is not in the catalogue. */
  'UNKNOWN_OFFER',
  /** The current catalogue offer has no price for the selected contracted power. */
  'CURRENT_OFFER_UNAVAILABLE',
  /** Manually entered prices are missing, not finite or outside the plausible range. */
  'INVALID_MANUAL_PRICES',
  /** Some consumption dates fall outside the periods covered by the catalogue access tariffs. */
  'PERIOD_OUTSIDE_CATALOGUE',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode) {
    super(code);
    this.name = 'EngineError';
    this.code = code;
  }
}

export function isEngineError(error: unknown): error is EngineError {
  return error instanceof EngineError;
}
