import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toast } from 'primeng/toast';
import { NetworkStatus } from './notifications/network-status';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('twik');

  /** Instantiates the singleton so it starts listening for connectivity changes app-wide. */
  private readonly networkStatus = inject(NetworkStatus);
}
