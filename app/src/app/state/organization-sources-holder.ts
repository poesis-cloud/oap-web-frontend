import { Injectable } from '@angular/core';
import type { OrganizationSources } from '../infrastructure/workspace-manager/organization-sources';

/**
 * Holds the organization sources fetched before bootstrap (`provideAppInitializer` in
 * `app.config.ts`), so that the mocked workspace can seed them synchronously when the store
 * is created. Null when the fetch failed: the workspace then holds the manifest only.
 */
@Injectable({ providedIn: 'root' })
export class OrganizationSourcesHolder {
  sources: OrganizationSources | null = null;
}
