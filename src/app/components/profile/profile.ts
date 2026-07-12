import { Component, computed, inject, signal } from '@angular/core';
import { FormField, form, minLengthError, requiredError, validate } from '@angular/forms/signals';
import { ButtonDirective } from 'primeng/button';
import { Avatar } from 'primeng/avatar';
import { Fluid } from 'primeng/fluid';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { PasswordDirective } from 'primeng/password';
import { Auth } from '../../auth/auth';

@Component({
  selector: 'app-profile',
  imports: [FormField, ButtonDirective, Avatar, Fluid, InputText, Message, PasswordDirective],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile {
  private readonly auth = inject(Auth);

  protected readonly currentUser = this.auth.currentUser;

  protected readonly initials = computed(() => {
    const name = this.currentUser()?.name.trim();
    if (!name) {
      return '?';
    }
    const parts = name.split(/\s+/);
    const chars = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
    return chars.map((part) => part[0]?.toUpperCase()).join('');
  });

  protected readonly profile = signal({ name: this.currentUser()?.name ?? '' });

  protected readonly profileForm = form(this.profile, (path) => {
    validate(path.name, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Enter your full name' });
    });
  });

  protected readonly savingProfile = signal(false);
  protected readonly profileError = signal('');
  protected readonly profileSuccess = signal(false);

  protected readonly passwords = signal({ currentPassword: '', newPassword: '', confirmPassword: '' });

  protected readonly passwordForm = form(this.passwords, (path) => {
    validate(path.currentPassword, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      return ctx.value() ? undefined : requiredError({ message: 'Enter your current password' });
    });
    validate(path.newPassword, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Create a new password' });
      if (value.length < 8) return minLengthError(8, { message: 'Use at least 8 characters' });
      return undefined;
    });
    validate(path.confirmPassword, (ctx) => {
      if (!ctx.state.touched()) return undefined;
      const value = ctx.value();
      if (!value) return requiredError({ message: 'Confirm your new password' });
      if (value !== ctx.valueOf(path.newPassword)) {
        return { kind: 'mismatch', message: 'Passwords do not match' };
      }
      return undefined;
    });
  });

  protected readonly savingPassword = signal(false);
  protected readonly passwordError = signal('');
  protected readonly passwordSuccess = signal(false);

  protected async onSubmitProfile(event: Event): Promise<void> {
    event.preventDefault();
    this.profileForm.name().markAsTouched();
    if (this.profileForm().invalid()) {
      return;
    }

    this.savingProfile.set(true);
    this.profileError.set('');
    this.profileSuccess.set(false);
    const { name } = this.profile();
    const success = await this.auth.updateName(name);
    this.savingProfile.set(false);

    if (success) {
      this.profileSuccess.set(true);
    } else {
      this.profileError.set('We could not update your name. Please try again.');
    }
  }

  protected async onSubmitPassword(event: Event): Promise<void> {
    event.preventDefault();
    this.passwordForm.currentPassword().markAsTouched();
    this.passwordForm.newPassword().markAsTouched();
    this.passwordForm.confirmPassword().markAsTouched();
    if (this.passwordForm().invalid()) {
      return;
    }

    this.savingPassword.set(true);
    this.passwordError.set('');
    this.passwordSuccess.set(false);
    const { currentPassword, newPassword } = this.passwords();
    const success = await this.auth.updatePassword(currentPassword, newPassword);
    this.savingPassword.set(false);

    if (success) {
      this.passwordForm().reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      this.passwordSuccess.set(true);
    } else {
      this.passwordError.set('We could not update your password. Check your current password and try again.');
    }
  }
}
