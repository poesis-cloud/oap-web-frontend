import { describe, expect, it } from 'vitest';
import type { Commit } from '../domain/artifact';
import {
  contentPaths,
  gapToNominal,
  organizationCategory,
  organizationHistory,
  organizationTree,
} from './organization-view';

function commit(sha: string, changes: Record<string, string | null>, tag: string | null = null): Commit {
  return {
    sha,
    parent: null,
    message: sha,
    sessionId: null,
    runId: null,
    stepSlug: null,
    author: { kind: 'installer' },
    timestamp: '2026-11-08T10:00:00.000Z',
    changes,
    tag,
  };
}

describe('organization view', () => {
  it('categorizes organization files by folder', () => {
    expect(organizationCategory('organization/agents/system-architect.agent.md')).toBe('agent');
    expect(organizationCategory('organization/workflows/program/pi-planning.workflow.conf.yaml')).toBe('workflow');
    expect(organizationCategory('organization/artifacts/system-architect/adr.artifact.schema.json')).toBe('schema');
    expect(organizationCategory('organization/artifacts/system-architect/adr.md')).toBe('template');
    expect(organizationCategory('organization/conf/workspace.conf.yaml')).toBe('configuration');
    expect(organizationCategory('organization/package.json')).toBe('manifest');
  });

  it('separates the organization folder from the workspace content', () => {
    const paths = ['organization/agents/a.agent.md', 'art/platform/x.feature.md', 'organization/package.json'];
    expect(contentPaths(paths)).toEqual(['art/platform/x.feature.md']);
    const tree = organizationTree(paths);
    expect(tree.map((e) => e.name)).toEqual(['agents', 'package.json']);
  });

  it('orders the main folders of the organization before the others', () => {
    const tree = organizationTree([
      'organization/conf/a.yaml',
      'organization/skills/s.skill.md',
      'organization/agents/a.agent.md',
      'organization/README.md',
    ]);
    expect(tree.map((e) => e.name)).toEqual(['agents', 'skills', 'conf', 'README.md']);
  });

  it('lists the history of the folder and the gap to the nominal import', () => {
    const commits = [
      commit('c1', { 'organization/package.json': '{}', 'organization/agents/a.agent.md': 'x' }, 'nominal-import/p@1'),
      commit('c2', { 'art/platform/x.feature.md': 'f' }),
      commit('c3', { 'organization/agents/a.agent.md': 'y' }),
    ];
    const history = organizationHistory(commits, 'c1');
    expect(history.map((h) => h.commit.sha)).toEqual(['c3', 'c1']);
    expect(history[1].nominal).toBe(true);
    expect(history[0].paths).toEqual(['organization/agents/a.agent.md']);
    expect(gapToNominal(commits, 'c1')).toEqual(['organization/agents/a.agent.md']);
    expect(gapToNominal(commits.slice(0, 2), 'c1')).toEqual([]);
    // A rollback that restores the nominal bytes closes the gap (content, not commits touched).
    const restored = [...commits, commit('c4', { 'organization/agents/a.agent.md': 'x' })];
    expect(gapToNominal(restored, 'c1')).toEqual([]);
    const deleted = [...commits, commit('c5', { 'organization/agents/a.agent.md': null })];
    expect(gapToNominal(deleted, 'c1')).toEqual(['organization/agents/a.agent.md']);
  });
});
