import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormField, emailError, form, requiredError, validate } from '@angular/forms/signals';
import { ButtonDirective } from 'primeng/button';
import { Divider } from 'primeng/divider';
import { Fluid } from 'primeng/fluid';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { PasswordDirective } from 'primeng/password';
import { Auth } from '../auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-login',
  imports: [RouterLink, FormField, ButtonDirective, Divider, Fluid, InputText, Message, PasswordDirective],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly features = [
    'Centralized workspace for every project',
    'Granular, role-based permissions',
    'Real-time collaboration, zero lag',
  ];

  protected readonly credentials = signal({ email: '', password: '' });

  protected readonly loginForm = form(this.credentials, (path) => {
    validate(path.email, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Enter your email address' });
      if (!EMAIL_PATTERN.test(value)) return emailError({ message: 'Enter a valid email address' });
      return undefined;
    });
    validate(path.password, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Enter your password' });
    });
  });

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal(
    this.route.snapshot.queryParamMap.get('error') === 'invite-only'
      ? 'This workspace is invite-only. Ask an admin to send you an invitation.'
      : '',
  );

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.loginForm.email().markAsTouched();
    this.loginForm.password().markAsTouched();
    if (this.loginForm().invalid()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');
    const { email, password } = this.credentials();
    const success = await this.auth.login(email, password);
    this.submitting.set(false);

    if (success) {
      this.router.navigateByUrl('/dashboard');
    } else {
      this.errorMessage.set('Invalid email or password.');
    }
  }

  protected signInWithGoogle(): void {
    this.auth.loginWithGoogle();
  }
}
