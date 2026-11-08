import type { Routes } from '@angular/router';

/**
 * One short menu, four surfaces (Clément, 2026-11-08): Workspace, Organization,
 * Conversations, Supervisor. Runs are reached from Supervisor and from conversations; the
 * organization of the workspace has its own surface since 2026-11-08 (it was a tab of
 * Workspace). Home is Supervisor (F18 open decision).
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'supervisor' },
  { path: 'workspace/organization', pathMatch: 'full', redirectTo: 'organization' },
  {
    path: 'workspace',
    loadComponent: () => import('./features/workspace/workspace-page').then((m) => m.WorkspacePage),
    title: 'Workspace · OAP',
  },
  {
    path: 'workspace/:view',
    loadComponent: () => import('./features/workspace/workspace-page').then((m) => m.WorkspacePage),
    title: 'Workspace · OAP',
  },
  {
    path: 'organization',
    loadComponent: () => import('./features/organization/organization-page').then((m) => m.OrganizationPage),
    title: 'Organization · OAP',
  },
  {
    path: 'organization/:view',
    loadComponent: () => import('./features/organization/organization-page').then((m) => m.OrganizationPage),
    title: 'Organization · OAP',
  },
  {
    path: 'conversations',
    loadComponent: () => import('./features/conversations/conversations-page').then((m) => m.ConversationsPage),
    title: 'Conversations · OAP',
  },
  {
    path: 'conversations/:id',
    loadComponent: () => import('./features/conversations/conversation-page').then((m) => m.ConversationPage),
    title: 'Conversation · OAP',
  },
  {
    path: 'supervisor',
    loadComponent: () => import('./features/supervisor/supervisor-page').then((m) => m.SupervisorPage),
    title: 'Supervisor · OAP',
  },
  {
    path: 'supervisor/runs/:id',
    loadComponent: () => import('./features/supervisor/run-page').then((m) => m.RunPage),
    title: 'Run · OAP',
  },
  {
    path: 'supervisor/:view',
    loadComponent: () => import('./features/supervisor/supervisor-page').then((m) => m.SupervisorPage),
    title: 'Supervisor · OAP',
  },
  { path: '**', redirectTo: 'supervisor' },
];
