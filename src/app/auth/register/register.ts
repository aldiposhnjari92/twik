import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormField, emailError, form, minLengthError, requiredError, validate } from '@angular/forms/signals';
import { ButtonDirective } from 'primeng/button';
import { Divider } from 'primeng/divider';
import { Fluid } from 'primeng/fluid';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { PasswordDirective } from 'primeng/password';
import { Auth } from '../auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-register',
  imports: [RouterLink, FormField, ButtonDirective, Divider, Fluid, InputText, Message, PasswordDirective],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class Register {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly features = [
    'Unlimited projects, every plan',
    'Enterprise-grade access controls',
    'Detailed activity history',
  ];

  protected readonly account = signal({ name: '', email: '', password: '' });

  protected readonly registerForm = form(this.account, (path) => {
    validate(path.name, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Enter your full name' });
    });
    validate(path.email, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Enter your email address' });
      if (!EMAIL_PATTERN.test(value)) return emailError({ message: 'Enter a valid email address' });
      return undefined;
    });
    validate(path.password, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Create a password' });
      if (value.length < 8) return minLengthError(8, { message: 'Use at least 8 characters' });
      return undefined;
    });
  });

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.registerForm.name().markAsTouched();
    this.registerForm.email().markAsTouched();
    this.registerForm.password().markAsTouched();
    if (this.registerForm().invalid()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');
    const { name, email, password } = this.account();
    try {
      await this.auth.register(name, email, password);
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'We could not create your account. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  protected signUpWithGoogle(): void {
    this.auth.loginWithGoogle();
  }
}
