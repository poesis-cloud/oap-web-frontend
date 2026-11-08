import type { ApplicationConfig } from '@angular/core';
import { inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation, withInMemoryScrolling } from '@angular/router';
import Aura from '@primeuix/themes/aura';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';
import { getRuntimeConfig } from './core/config/runtime-config';
import { fetchOrganizationSources } from './infrastructure/workspace-manager/organization-sources';
import { OrganizationSourcesHolder } from './state/organization-sources-holder';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      // A preview served from a folder of a static site has no SPA fallback: hash URLs keep deep links working.
      ...(getRuntimeConfig().routing === 'hash' ? [withHashLocation()] : []),
    ),
    providePrimeNG({
      ripple: false,
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '[data-theme="dark"]',
          cssLayer: { name: 'primeng', order: 'theme, base, primeng, components, utilities' },
        },
      },
    }),
    MessageService,
    // The organization sources (SAF package files) are fetched before the first view so that the
    // mocked workspace git holds them from its nominal import (F16-R2).
    provideAppInitializer(async () => {
      const holder = inject(OrganizationSourcesHolder);
      holder.sources = await fetchOrganizationSources();
      if (!holder.sources) console.warn('Organization sources not available: the workspace holds the manifest only.');
    }),
  ],
};
