import type { OrganizationCatalog } from '../../core/ports';
import type { OrganizationPackage } from '../../core/domain/organization';

/** The organization packages the (mock) runtime hosts (F7). */
export class StaticCatalog implements OrganizationCatalog {
  constructor(private readonly packages: readonly OrganizationPackage[]) {}
  offered(): readonly OrganizationPackage[] {
    return this.packages;
  }
  get(id: string): OrganizationPackage | undefined {
    return this.packages.find((p) => p.id === id);
  }
}
