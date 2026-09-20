import { useRef } from 'react';

// Idempotency key scoped to one logical submission. Generated once per hook
// instance (i.e. per dialog mount), stable across retries of the same
// submission, fresh for every new submission. A new key must never be minted
// per render or per retry — that would fork duplicate backend effects.
export function useIdempotencyKey() {
  const ref = useRef(null);
  if (ref.current === null) {
    ref.current = crypto.randomUUID();
  }
  return ref.current;
}
