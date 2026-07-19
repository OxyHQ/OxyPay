// Shared discriminated-union loading state for the three route loaders
// (Intent/Link/Session) — each fetches a different shape but goes through
// the same loading → error → ready progression.
export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };
