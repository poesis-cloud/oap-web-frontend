import type { TenantId } from '../domain/types';
import type { Tenant } from '../domain/workspace';

/**
 * Port of **identity and access** (PIS IAM, served by Keycloak): the realm of a tenant (a PIS
 * Organization), its members with their permission and organization-declared roles, as
 * projected from OIDC claims (R9). SAI stores no credential and keeps no account registry.
 *
 * Mocked in `infrastructure/iam/`.
 */
export interface IdentityPort {
  tenant(id: TenantId): Tenant | undefined;
}
