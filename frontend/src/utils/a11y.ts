import type { KeyboardEvent } from 'react';

/** Activate a clickable non-button element on Enter or Space, mirroring native button behavior. */
export function handleKeyboardActivate(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    (e.currentTarget as HTMLElement).click();
  }
}
