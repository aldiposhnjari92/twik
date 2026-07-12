import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormField, form, minLengthError, requiredError, validate } from '@angular/forms/signals';
import { ButtonDirective } from 'primeng/button';
import { Fluid } from 'primeng/fluid';
import { Message } from 'primeng/message';
import { PasswordDirective } from 'primeng/password';
import { Auth } from '../auth';

@Component({
  selector: 'app-reset-password',
  imports: [RouterLink, FormField, ButtonDirective, Fluid, Message, PasswordDirective],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  private readonly userId = this.route.snapshot.queryParamMap.get('userId') ?? '';
  private readonly secret = this.route.snapshot.queryParamMap.get('secret') ?? '';

  protected readonly linkInvalid = !this.userId || !this.secret;

  protected readonly credentials = signal({ password: '' });

  protected readonly resetForm = form(this.credentials, (path) => {
    validate(path.password, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Create a password' });
      if (value.length < 8) return minLengthError(8, { message: 'Use at least 8 characters' });
      return undefined;
    });
  });

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly errorMessage = signal('');

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.resetForm.password().markAsTouched();
    if (this.resetForm().invalid()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');
    const { password } = this.credentials();
    const success = await this.auth.completeRecovery(this.userId, this.secret, password);
    this.submitting.set(false);

    if (success) {
      this.submitted.set(true);
      setTimeout(() => this.router.navigateByUrl('/login'), 2000);
    } else {
      this.errorMessage.set('This link is invalid or has expired. Ask your workspace admin to invite you again.');
    }
  }
}
