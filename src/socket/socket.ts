import { PartialObserver, Subject } from 'rxjs';
import { SocketPayloadType } from './types';

// const DEFAULT_VSN = "2.0.0";
// const DEFAULT_TIMEOUT = 10000;
// const WS_CLOSE_NORMAL = 1000;

type SocketOptions<R, S> = {
  url: string;
  protocols?: string | string[];
  decoder: (data: any) => R;
  encoder: (data: S) => SocketPayloadType;
};

export class PhoenixSocket<R, S> {
  private socket: WebSocket;
  private subject: Subject<R> = new Subject();
  private decoder: (data: any) => R;
  private encoder: (data: S) => SocketPayloadType;

  private timer?: number;
  private interval?: number;
  private timeout?: number;
  private runner?: (socket: PhoenixSocket<R, S>) => Promise<void> | void;

  private queue: S[] = [];

  constructor({ url, protocols, decoder, encoder }: SocketOptions<R, S>) {
    this.socket = new WebSocket(url, protocols);
    this.decoder = decoder;
    this.encoder = encoder;

    this.socket.addEventListener('close', () => {
      if (this.timer) clearTimeout(this.timer);
      this.subject.complete();
    });

    this.socket.addEventListener('message', e => {
      try {
        this.subject.next(this.decoder(e.data));
      } catch (err) {
        this.subject.error(err);
      }
    });

    this.socket.addEventListener('open', () => {
      this.resetHeartbeat();

      for (const queued of this.queue) {
        this.send(queued);
      }
      this.queue = [];
    });

    // Todo: Reconnecting attempt
    this.socket.addEventListener('error', e => {
      this.subject.error(e);
      if (this.timer) clearInterval(this.timer);
    });
  }

  subscribe(observer: PartialObserver<R>) {
    return this.subject.subscribe(observer);
  }

  send(data: S) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.queue.push(data);
    } else {
      this.socket.send(this.encoder(data) as any);
    }
  }

  private async resetHeartbeat() {
    if (this.interval && this.runner) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = (setTimeout(() => this.heartbeat(), this.interval) as unknown) as number;
    }
  }

  private async heartbeat(backoff = 25) {
    if (this.runner) {
      try {
        await Promise.race([this.runner(this), new Promise((_, rej) => setTimeout(rej, this.timeout))]);
        this.timer = (setTimeout(() => this.heartbeat(), this.interval) as unknown) as number;
      } catch (err) {
        this.timer = (setTimeout(
          () => this.heartbeat(Math.min(backoff * 2, 1600)),
          this.interval
        ) as unknown) as number;
      }
    }
  }

  registerHeartbeatRunner(
    interval: number,
    timeout: number,
    runner: (socket: PhoenixSocket<R, S>) => Promise<void> | void
  ) {
    this.interval = interval;
    this.runner = runner;
    this.timeout = timeout;
    this.resetHeartbeat();
  }
}
