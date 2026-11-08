/**
 * The organization sources (agents, workflows, conf, artifact schemas and templates, skills,
 * instructions) exported verbatim from the SAF organization repository by
 * `tools/import-saf-package.py` into `public/saf-package/organization-sources.json`.
 *
 * They are fetched once at startup (not bundled: ~850 kB of text) and seeded into the mocked
 * workspace git as the nominal import, so that the Organization surface browses the real
 * files in their native format (F16-R1, F16-R2, S61) and the Workspace explorer stays
 * focused on the work. Without them (fetch failure, tests) the workspace still holds the
 * package manifest and README.
 */
export interface OrganizationSources {
  readonly root: string;
  readonly package: string;
  readonly version: string;
  readonly folders: readonly string[];
  readonly files: Readonly<Record<string, string>>;
}

export const ORGANIZATION_SOURCES_URL = 'saf-package/organization-sources.json';

export async function fetchOrganizationSources(
  fetchImpl: typeof fetch = fetch,
  baseUri: string = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/',
): Promise<OrganizationSources | null> {
  try {
    const response = await fetchImpl(new URL(ORGANIZATION_SOURCES_URL, baseUri).toString(), { cache: 'force-cache' });
    if (!response.ok) return null;
    const data = (await response.json()) as OrganizationSources;
    return data && typeof data.files === 'object' ? data : null;
  } catch {
    return null;
  }
}
