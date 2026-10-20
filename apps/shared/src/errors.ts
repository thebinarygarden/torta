/**
 * Every `error` code the api returns. The web app shows each one in the
 * reader's language, so a new code needs an entry in `web/src/i18n/*.json`.
 */
export const errorCodes = [
  'already_setup',
  'bad_backup',
  'bad_code',
  'bad_password',
  'bad_transition',
  'barcode_taken',
  'ingredient_choice',
  'insert_failed',
  'internal',
  'invalid_input',
  'item_unavailable',
  'modifier_count',
  'needs_setup',
  'not_found',
  'too_many_attempts',
  'unauthorized',
  'unknown_ingredient',
  'unknown_item',
  'unknown_modifier',
] as const;

export type ErrorCode = (typeof errorCodes)[number];
