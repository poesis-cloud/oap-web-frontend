import type { IsoDateTime } from '../domain/types';

/** Cross-cutting ports every adapter may need. */

export interface Clock {
  now(): IsoDateTime;
}

export interface IdMinter {
  /** Returns a safe slug (`[a-z0-9-]+`) unique within the session. */
  mint(prefix: string): string;
}
