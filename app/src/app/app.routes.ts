import type { Routes } from '@angular/router';

/**
 * One short menu, three surfaces (Clément, 2026-11-08; F18-R1 narrowed): Workspace,
 * Conversations, Supervisor. Runs are reached from Supervisor and from conversations; the
 * organization packages are a tab of Workspace. Home is Supervisor (F18 open decision).
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'supervisor' },
  {
    path: 'workspace',
    loadComponent: () => import('./features/workspace/workspace-page').then((m) => m.WorkspacePage),
    title: 'Workspace · SAI',
  },
  {
    path: 'workspace/:view',
    loadComponent: () => import('./features/workspace/workspace-page').then((m) => m.WorkspacePage),
    title: 'Workspace · SAI',
  },
  {
    path: 'conversations',
    loadComponent: () => import('./features/conversations/conversations-page').then((m) => m.ConversationsPage),
    title: 'Conversations · SAI',
  },
  {
    path: 'conversations/:id',
    loadComponent: () => import('./features/conversations/conversation-page').then((m) => m.ConversationPage),
    title: 'Conversation · SAI',
  },
  {
    path: 'supervisor',
    loadComponent: () => import('./features/supervisor/supervisor-page').then((m) => m.SupervisorPage),
    title: 'Supervisor · SAI',
  },
  {
    path: 'supervisor/runs/:id',
    loadComponent: () => import('./features/supervisor/run-page').then((m) => m.RunPage),
    title: 'Run · SAI',
  },
  { path: '**', redirectTo: 'supervisor' },
];
