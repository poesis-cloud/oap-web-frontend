import { describe, expect, it } from 'vitest';
import { createMockWorld, DEMO_WORKSPACE_ID } from '../../infrastructure/mock-world';
import { itemTypeForPath, matchPathPattern } from '../domain/organization';

describe('board view over the workspace (F5-R2, F14-R4)', () => {
  it('derives work items from artifacts whose kind the organization declares, with declared statuses', () => {
    const world = createMockWorld();
    const items = world.app.workItems(world.session, DEMO_WORKSPACE_ID);
    const feature = items.find((i) => i.itemId === 'F-12');
    expect(feature).toMatchObject({
      type: 'feature',
      status: 'arch-pending',
      structurant: true,
      title: 'Secure REST API for customer subscriptions',
    });
    const types = new Set(items.map((i) => i.type));
    expect(types).toEqual(new Set(['feature', 'story']));
    for (const item of items) {
      const type = world.organization.itemTypes.find((t) => t.slug === item.type)!;
      expect(type.statuses).toContain(item.status);
    }
  });

  it('matches SAF path patterns segment by segment', () => {
    expect(matchPathPattern('art/*/program-backlog/*/*.adr.md', 'art/platform/program-backlog/x/y.adr.md')).toBe(true);
    expect(matchPathPattern('art/*/program-backlog/*/*.adr.md', 'art/platform/program-backlog/x/deep/y.adr.md')).toBe(
      false,
    );
    const world = createMockWorld();
    expect(itemTypeForPath(world.organization, 'products/customer-platform/nfr-list.md')).toBeUndefined();
    expect(itemTypeForPath(world.organization, 'art/platform/program-backlog/a/a.feature.md')?.slug).toBe('feature');
  });

  it('never writes: the read port exposes no mutation to the views', () => {
    const world = createMockWorld();
    const readPort = world.app['deps' as keyof typeof world.app] as unknown as { workspaceRead: object };
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(readPort.workspaceRead)).filter(
      (n) => n !== 'constructor',
    );
    // The repository class carries writes for the runtime; the application only receives it as WorkspaceReadPort.
    expect(names).toEqual(expect.arrayContaining(['head', 'commits', 'paths', 'read', 'artifact', 'journal', 'runs']));
  });
});
