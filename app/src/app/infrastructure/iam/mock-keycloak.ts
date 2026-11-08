import type { IdentityPort } from '../../core/ports';
import type { Tenant } from '../../core/domain/workspace';

/**
 * Mock of PIS IAM (Keycloak): one realm per tenant (a PIS Organization), members with their
 * SAI permission and the organization-declared roles they hold, as the OIDC claims would
 * carry them (R9). No password, no token: the UI picks the acting user to replay journeys.
 *
 * Production: Angular signs in with OIDC authorization code + PKCE against the Keycloak realm
 * and sends the access token to the backends; the frontend keeps it in memory only.
 */
export class MockKeycloak implements IdentityPort {
  private readonly realms = new Map<string, Tenant>();
  constructor(tenants: readonly Tenant[]) {
    for (const t of tenants) this.realms.set(t.id, t);
  }
  tenant(id: string): Tenant | undefined {
    return this.realms.get(id);
  }
  all(): readonly Tenant[] {
    return [...this.realms.values()];
  }
}
