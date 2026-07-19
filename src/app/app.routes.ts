import { Routes } from '@angular/router';
import { adminGuard } from './auth/admin-guard';
import { authGuard } from './auth/auth-guard';
import { guestGuard } from './auth/guest-guard';

export const routes: Routes = [
    {
        path: '',
        pathMatch: 'full',
        title: 'Twik — Project management for growing teams',
        canMatch: [guestGuard],
        loadComponent: () => import('./components/marketing/marketing').then(c => c.Marketing)
    },
    {
        path: '',
        loadComponent: () => import('./components/shell/shell').then(c => c.Shell),
        canActivate: [authGuard],
        children: [
            {
                path: '',
                redirectTo: 'dashboard',
                pathMatch: 'full'
            },
            {
                path: 'dashboard',
                title: 'Dashboard',
                loadComponent: () => import('./components/dashboard/dashboard').then(c => c.Dashboard)
            },
            {
                path: 'projects',
                title: 'Projects',
                children: [
                    {
                        path: '',
                        title: 'Projects',
                        loadComponent: () => import('./projects/project-list/project-list').then(c => c.ProjectList)
                    },
                    {
                        path: ':id/edit',
                        title: 'Edit project',
                        loadComponent: () => import('./projects/project-edit/project-edit').then(c => c.ProjectEdit)
                    }
                ]
            },
            {
                path: 'team',
                title: 'Team',
                loadComponent: () => import('./components/team/team').then(c => c.Team)
            },
            {
                path: 'audit-log',
                title: 'Audit Log',
                canActivate: [adminGuard],
                loadComponent: () => import('./components/audit-log/audit-log').then(c => c.AuditLogPage)
            },
            {
                path: 'settings',
                title: 'Settings',
                loadComponent: () => import('./components/settings/settings').then(c => c.Settings)
            },
            {
                path: 'profile',
                title: 'Profile',
                loadComponent: () => import('./components/profile/profile').then(c => c.Profile)
            }
        ]
    },
    {
        path: 'login',
        title: 'Sign in',
        loadComponent: () => import('./auth/login/login').then(c => c.Login)
    },
    {
        path: 'register',
        title: 'Create account',
        loadComponent: () => import('./auth/register/register').then(c => c.Register)
    },
    {
        path: 'reset-password',
        title: 'Set your password',
        loadComponent: () => import('./auth/reset-password/reset-password').then(c => c.ResetPassword)
    },
    {
        path: '**',
        title: 'Page not found',
        loadComponent: () => import('./components/page-not-found/page-not-found').then(c => c.PageNotFound)
    }
];
