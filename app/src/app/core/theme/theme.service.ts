import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

const THEME_STORAGE_KEY = 'sai-theme';

/** Dark-first (Poesis brand) with a light theme on `data-theme`, remembered per browser. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly dark = signal(false);
  readonly isDark = this.dark.asReadonly();

  constructor() {
    const saved = this.readSaved();
    this.setDark(saved !== null ? saved === 'dark' : true);
  }

  toggle(): void {
    this.setDark(!this.dark());
  }

  setDark(isDark: boolean): void {
    this.dark.set(isDark);
    const value = isDark ? 'dark' : 'light';
    this.document.documentElement.setAttribute('data-theme', value);
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Storage can be unavailable (private window, embedded widget): the theme still applies.
    }
  }

  private readSaved(): string | null {
    try {
      return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }
}
