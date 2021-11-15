import { PartialObserver, Subject } from 'rxjs';
import { PhoenixSerializer } from '../phoenix/serializer';
import { MessageFromSocket, MessageToSocket, SocketPayloadType } from './types';

// const DEFAULT_VSN = "2.0.0";
// const DEFAULT_TIMEOUT = 10000;
// const WS_CLOSE_NORMAL = 1000;

type SocketOptions<R extends SocketPayloadType, S extends SocketPayloadType> = {
  url: string;
  protocols?: string | string[];
  heartbeatInterval?: number;
  /**
   * A custom runner for hearbeats, that resolves when there is a response
   */
  heartbeatRunner: (socket: PhoenixSocket<R, S>) => Promise<void> | void;
  heartbeatTimeout?: number;
};

export class PhoenixSocket<
  R extends SocketPayloadType = SocketPayloadType,
  S extends SocketPayloadType = SocketPayloadType
> {
  private socket: WebSocket;
  private subject: Subject<MessageFromSocket<R>> = new Subject();

  private timer?: number;
  private interval?: number;
  private timeout?: number;
  private runner?: (socket: PhoenixSocket<R, S>) => Promise<void> | void;

  private queue: MessageToSocket<S>[] = [];

  private serializer: PhoenixSerializer = new PhoenixSerializer();

  constructor({ url, protocols, heartbeatRunner, heartbeatInterval = 30000, heartbeatTimeout }: SocketOptions<R, S>) {
    this.socket = new WebSocket(url, protocols);
    this.interval = heartbeatInterval;
    this.runner = heartbeatRunner;
    this.timeout = heartbeatTimeout;

    this.socket.addEventListener('close', () => {
      if (this.timer) clearTimeout(this.timer);
      this.subject.complete();
    });

    this.socket.addEventListener('message', e => {
      try {
        this.subject.next(this.serializer.decode(e.data));
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

  subscribe(observer: PartialObserver<MessageFromSocket<R>>) {
    return this.subject.subscribe(observer);
  }

  send(data: MessageToSocket<S>) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.queue.push(data);
    } else {
      this.socket.send(this.serializer.encode(data));
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
}
