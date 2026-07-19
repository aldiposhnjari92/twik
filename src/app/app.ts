import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { NetworkStatus } from './notifications/network-status';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  /** Instantiates the singleton so it starts listening for connectivity changes app-wide. */
  private readonly networkStatus = inject(NetworkStatus);
}
