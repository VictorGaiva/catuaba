import { PartialObserver, Subject, } from "rxjs";
import { PhoenixChannel } from "./phoenix-channel";
import { PhoenixSerializer } from "./phoenix-serializer";


export enum MESSAGE_KIND {
  push = 0,
  reply = 1,
  broadcast = 2,
}

export type RawSocketMessage = string | ArrayBuffer;
export type SocketPayloadType = Object | ArrayBuffer;

export type PushSocketMessage<T> = {
  join_ref: string;
  topic: string;
  event: string;
  payload: T;
};
export type ReplySocketMessage<T> = {
  join_ref: string;
  ref: string;
  topic: string;
  event: string;
  payload: { response: T; status: string };
};
export type BroadcastSocketMessage<T> = {
  topic: string;
  event: string;
  payload: T;
};

export type MessageFromSocket<T extends SocketPayloadType = ArrayBuffer> =
  | PushSocketMessage<T>
  | ReplySocketMessage<T>
  | BroadcastSocketMessage<T>;

export type MessageToSocket<T extends SocketPayloadType> = {
  join_ref: string;
  ref: string;
  topic: string;
  event: string;
  payload: T;
};


export function isPushMessage<T extends SocketPayloadType>(data: MessageFromSocket<T>): data is PushSocketMessage<T> {
  const { join_ref, ref } = data as ReplySocketMessage<T>;
  return (join_ref !== undefined && join_ref !== null) && (ref === undefined || ref === null);
}

export function isReplyMessage<T extends SocketPayloadType>(data: MessageFromSocket<T>): data is ReplySocketMessage<T> {
  const { ref } = data as ReplySocketMessage<T>;
  return (ref !== undefined && ref !== null);
}

export function isBroadcastMessage<T extends SocketPayloadType>(data: MessageFromSocket<T>): data is BroadcastSocketMessage<T> {
  const { join_ref, ref } = data as ReplySocketMessage<T>;
  return (join_ref === undefined || join_ref === null) && (ref === undefined || ref === null);
}

const DEFAULT_VSN = "2.0.0";
const DEFAULT_TIMEOUT = 10000;
const WS_CLOSE_NORMAL = 1000;

export class PhoenixSocket<R extends SocketPayloadType = SocketPayloadType, S extends SocketPayloadType = SocketPayloadType> {
  private socket: WebSocket;
  private subject: Subject<MessageFromSocket<R>>;

  private heartbeatChannel: PhoenixChannel<R, S>;
  private heartbeatTimer: NodeJS.Timeout;
  private heartbeatPromise: Promise<void> | null;

  private queue: MessageToSocket<S>[];

  private serializer: PhoenixSerializer;

  constructor({ url, protocols }: { url: string; protocols?: string | string[] }) {
    this.socket = new WebSocket(url, protocols);
    this.subject = new Subject();
    this.serializer = new PhoenixSerializer();
    this.queue = [];
    // No need to join the channel for heartbeats
    this.heartbeatChannel = new PhoenixChannel<R, S>("phoenix", this);

    this.socket.addEventListener("close", (e) => {
      clearInterval(this.heartbeatTimer);
      this.subject.complete();
    });

    this.socket.addEventListener("message", (e: MessageEvent<RawSocketMessage>) => {
      try {
        this.subject.next(this.serializer.decode(e.data));
      } catch (err) {
        this.subject.error(err);
      }
    });

    this.socket.addEventListener("open", (e) => {
      this.heartbeatTimer = setInterval(() => {
        if (this.heartbeatPromise !== undefined) {
          this.subject.error(e);
          clearInterval(this.heartbeatTimer)
        }
        else {
          this.heartbeatPromise = this.heartbeatChannel.run("heartbeat", {} as S, { force: true }).then(result => {
            this.heartbeatPromise = undefined;
            if (result.payload.status !== "ok") {
              //TODO: Handle socket error?
            }
          })
        }
      }, 30000);
      let queued: MessageToSocket<S>;
      while (queued = this.queue.pop()) { this.send(queued); }
    })

    // Todo: Reconnecting attempt
    this.socket.addEventListener("error", (e) => {
      this.subject.error(e);
      clearInterval(this.heartbeatTimer)
    });
  }

  subscribe(observer: PartialObserver<MessageFromSocket<R>>) {
    return this.subject.subscribe(observer);
  }

  send(data: MessageToSocket<S>) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.queue.push(data)
    } else {
      this.socket.send(this.serializer.encode(data));
    }
  }
}