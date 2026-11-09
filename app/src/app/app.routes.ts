import type { Routes } from '@angular/router';

/**
 * Menu with collapsible groups (Clément, 2026-11-08/09): Workspace (Explorer, Board),
 * Conversation, Supervision (Gates, Runs, Organization). Old paths redirect. Home: the gates
 * that wait for the user.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'supervision/gates' },
  { path: 'workspace', pathMatch: 'full', redirectTo: 'workspace/explorer' },
  {
    path: 'workspace/explorer',
    loadComponent: () => import('./features/workspace/explorer-page').then((m) => m.ExplorerPage),
    title: 'Explorer · OAP',
  },
  {
    path: 'workspace/board',
    loadComponent: () => import('./features/workspace/board-page').then((m) => m.BoardPage),
    title: 'Board · OAP',
  },
  { path: 'workspace/organization', redirectTo: 'workspace/explorer?dir=organization' },
  { path: 'workspace/:any', redirectTo: 'workspace/explorer' },
  { path: 'organization', redirectTo: 'supervision/organization' },
  { path: 'organization/:any', redirectTo: 'supervision/organization' },
  {
    path: 'conversation',
    loadComponent: () => import('./features/conversation/conversation-layout').then((m) => m.ConversationLayout),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/conversation/conversation-empty').then((m) => m.ConversationEmpty) },
      { path: 'new', loadComponent: () => import('./features/conversation/new-conversation').then((m) => m.NewConversation), title: 'New conversation · OAP' },
      { path: ':id', loadComponent: () => import('./features/conversation/chat-page').then((m) => m.ChatPage), title: 'Conversation · OAP' },
    ],
  },
  { path: 'conversations', redirectTo: 'conversation' },
  { path: 'conversations/:id', redirectTo: 'conversation/:id' },
  { path: 'supervision', pathMatch: 'full', redirectTo: 'supervision/gates' },
  {
    path: 'supervision/gates',
    loadComponent: () => import('./features/supervision/gates-page').then((m) => m.GatesPage),
    title: 'Gates · OAP',
  },
  {
    path: 'supervision/runs',
    loadComponent: () => import('./features/supervision/runs-page').then((m) => m.RunsPage),
    title: 'Runs · OAP',
  },
  {
    path: 'supervision/runs/:id',
    loadComponent: () => import('./features/supervision/run-page').then((m) => m.RunPage),
    title: 'Run · OAP',
  },
  {
    path: 'supervision/organization',
    loadComponent: () => import('./features/supervision/organization-page').then((m) => m.OrganizationPage),
    title: 'Organization · OAP',
  },
  { path: 'supervisor', redirectTo: 'supervision/gates' },
  { path: 'supervisor/runs/:id', redirectTo: 'supervision/runs/:id' },
  { path: 'supervisor/:any', redirectTo: 'supervision/gates' },
  { path: '**', redirectTo: 'supervision/gates' },
];
