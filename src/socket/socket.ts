import { PartialObserver, Subject } from 'rxjs';

// const DEFAULT_VSN = "2.0.0";
// const DEFAULT_TIMEOUT = 10000;
// const WS_CLOSE_NORMAL = 1000;

type SocketOptions<Send, Receive> = {
  url: string;
  protocols?: string | string[];
  decoder: (data: any) => Receive;
  encoder: (data: Send) => any;
};

export class PhoenixSocket<Send, Receive> {
  private socket: WebSocket;
  private subject: Subject<Receive> = new Subject();
  private decoder: (data: any) => Receive;
  private encoder: (data: Send) => any;

  private timer?: number;
  private interval?: number;
  private timeout?: number;
  private runner?: () => Promise<void> | void;

  public hasRunner = false;

  private queue: Send[] = [];

  constructor({ url, protocols, decoder, encoder }: SocketOptions<Send, Receive>) {
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

  subscribe(observer: PartialObserver<Receive>) {
    return this.subject.subscribe(observer);
  }

  send(data: Send) {
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
        await Promise.race([this.runner(), new Promise((_, rej) => setTimeout(rej, this.timeout))]);
        this.timer = (setTimeout(() => this.heartbeat(), this.interval) as unknown) as number;
      } catch (err) {
        this.timer = (setTimeout(
          () => this.heartbeat(Math.min(backoff * 2, 1600)),
          this.interval
        ) as unknown) as number;
      }
    }
  }

  registerHeartbeatRunner(interval: number, timeout: number, runner: () => Promise<void> | void) {
    this.hasRunner = true;
    this.interval = interval;
    this.runner = runner;
    this.timeout = timeout;
    this.resetHeartbeat();
  }
}
