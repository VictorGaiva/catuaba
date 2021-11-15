import { PartialObserver, Subject } from 'rxjs';

// const DEFAULT_VSN = "2.0.0";
// const DEFAULT_TIMEOUT = 10000;
// const WS_CLOSE_NORMAL = 1000;

type SocketOptions<Send, Receive> = {
  url: string | (() => string);
  protocols?: string | string[];
  decoder: (data: any) => Receive;
  encoder: (data: Send) => any;
};

export class PhoenixSocket<Send, Receive> extends EventTarget {
  private socket: WebSocket;
  private subject: Subject<Receive> = new Subject();
  private decoder: (data: any) => Receive;
  private encoder: (data: Send) => any;

  private timer?: number;
  private interval?: number;
  private timeout?: number;
  private runner?: () => Promise<void> | void;
  private backoff = 100;
  private reconnecting = false;

  public hasRunner = false;

  private queue: Send[] = [];

  constructor(private opts: SocketOptions<Send, Receive>) {
    super();
    const url = typeof opts.url === 'function' ? opts.url() : opts.url;
    this.socket = new WebSocket(url, opts.protocols);
    this.decoder = opts.decoder;
    this.encoder = opts.encoder;

    this.socket.addEventListener('close', this.onClose.bind(this));
    this.socket.addEventListener('open', this.onOpen.bind(this));
  }

  private async onClose(_: Event) {
    this.reconnecting = false;
    if (this.timer) clearTimeout(this.timer);
    // Reconnect
    if (this.socket.readyState === WebSocket.CLOSED) {
      this.dispatchEvent(new Event('disconnected'));
      this.backoff = Math.min(this.backoff * 2, 8000);
      setTimeout(() => this.reconnect(), this.backoff);
    }
  }

  private onOpen(_: Event) {
    this.queue.forEach(queued => this.send(queued));
    this.queue = [];

    if (this.hasRunner && !this.timer) {
      this.timer = (setTimeout(() => this.heartbeat(), this.interval) as unknown) as number;
    }

    this.socket.addEventListener('error', this.onError.bind(this));
    this.socket.addEventListener('message', this.onMessage.bind(this));
    if (this.reconnecting) {
      this.reconnecting = false;
      this.dispatchEvent(new Event('reconnected'));
    }
  }

  private onError(e: Event) {
    if (this.timer) clearInterval(this.timer);

    if (this.socket.readyState !== WebSocket.CLOSED) {
      this.subject.error(e);
    }
  }

  private onMessage(e: MessageEvent) {
    this.reconnecting = false;
    try {
      this.subject.next(this.decoder(e.data));
    } catch (err) {
      this.subject.error(err);
    }
  }

  private reconnect() {
    if (!this.reconnecting) {
      const url = typeof this.opts.url === 'function' ? this.opts.url() : this.opts.url;

      this.socket = new WebSocket(url, this.opts.protocols);
      this.socket.addEventListener('close', this.onClose.bind(this));
      this.socket.addEventListener('open', this.onOpen.bind(this));
      this.reconnecting = true;
    }
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

  private async heartbeat(backoff = 100) {
    if (this.runner) {
      try {
        await Promise.race([this.runner(), new Promise((_, rej) => setTimeout(rej, this.timeout))]);
        this.timer = (setTimeout(() => this.heartbeat(), this.interval) as unknown) as number;
      } catch (err) {
        this.timer = (setTimeout(
          () => this.heartbeat(Math.min(backoff * 2, 8000)),
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
    this.timer = (setTimeout(() => this.heartbeat(), this.interval) as unknown) as number;
  }
}
