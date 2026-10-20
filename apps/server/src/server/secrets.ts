/**
 * Seals small secrets, such as the Binary Garden refresh token, before they are
 * stored in the database. Electron supplies an implementation backed by
 * `safeStorage`; dev and tests use one that stores values unsealed.
 */
export type Secrets = {
  seal(plain: string): string;
  open(sealed: string): string;
};

export const plainSecrets: Secrets = {
  seal: (s) => s,
  open: (s) => s,
};
