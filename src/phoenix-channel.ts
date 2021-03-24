import { v4 as uuid } from "uuid";
import { Observable, PartialObserver, } from "rxjs";
import { filter, map } from "rxjs/operators";
import { BroadcastSocketMessage, isBroadcastMessage, isPushMessage, isReplyMessage, MessageFromSocket, MessageToSocket, PhoenixSocket, PushSocketMessage, ReplySocketMessage, SocketPayloadType } from "./phoenix-socket";

export enum CHANNEL_STATE {
  closed = "closed",
  errored = "errored",
  joined = "joined",
  joining = "joining",
  leaving = "leaving",
}

const TRANSPORTS = {
  longpoll: "longpoll",
  websocket: "websocket",
};

export enum CHANNEL_EVENT {
  phx_close = "phx_close",
  phx_error = "phx_error",
  phx_join = "phx_join",
  phx_reply = "phx_reply",
  phx_leave = "phx_leave",
}

export type ReplyChannelMessage<R extends SocketPayloadType> = Pick<ReplySocketMessage<R>, "event" | "payload"> & { type: "reply" };
export type BroadcastChannelMessage<R extends SocketPayloadType> = Pick<BroadcastSocketMessage<R>, "event" | "payload"> & { type: "broadcast" }
export type PushChannelMessage<R extends SocketPayloadType> = Pick<PushSocketMessage<R>, "event" | "payload"> & { type: "push" }

type ChannelMessage<R extends SocketPayloadType> =
  ReplyChannelMessage<R>
  | BroadcastChannelMessage<R>
  | PushChannelMessage<R>

export function isReplyChannelMessage<T extends SocketPayloadType>(data: ChannelMessage<T>): data is ReplyChannelMessage<T> {
  return data.type === "reply"
}

export function isBroadcastChannelMessage<T extends SocketPayloadType>(data: ChannelMessage<T>): data is BroadcastChannelMessage<T> {
  return data.type === "broadcast"
}

export function isPushChannelMessage<T extends SocketPayloadType>(data: ChannelMessage<T>): data is PushChannelMessage<T> {
  return data.type === "push"
}

export class PhoenixChannel<R extends SocketPayloadType = SocketPayloadType, S extends SocketPayloadType = SocketPayloadType> {
  private join_ref: string;
  private topic: string;
  private sequence: number;
  private _state: CHANNEL_STATE;

  private socket: PhoenixSocket<R, S>;

  private $rawData: Observable<MessageFromSocket<R>>;
  private $mappedData: Observable<ChannelMessage<R>>;

  private controlSequences: { event: CHANNEL_EVENT; ref: string }[];

  private queue: MessageToSocket<S>[]

  constructor(topic: string, socket: PhoenixSocket<R, S>) {
    this.sequence = 1;
    this.topic = topic;
    this._state = CHANNEL_STATE.closed;
    this.controlSequences = [];
    this.queue = [];

    this.socket = socket;

    // Messages for this Channel
    this.$rawData = new Observable<MessageFromSocket<R>>(subscriber => this.socket.subscribe(subscriber)).pipe(
      filter(({ topic }) => topic === this.topic),
    );

    this.$mappedData = this.$rawData.pipe(
      map(
        (message) => {
          if (isPushMessage(message))
            return {
              event: message.event,
              payload: message.payload,
              type: "push"
            }
          if (isBroadcastMessage(message))
            return {
              event: message.event,
              payload: message.payload,
              type: "broadcast"
            }
          if (isReplyMessage(message))
            return {
              event: message.event,
              payload: message.payload,
              type: "reply"
            }
        })
    );

    // Controller
    this.$rawData.subscribe({
      complete: () => {
        this._state = CHANNEL_STATE.closed;
      },
      error: () => {
        this._state = CHANNEL_STATE.errored;
      },
      next: () => { },
    });

    // Join the channel
  }

  get state() {
    return this._state;
  }

  subscribe(observer: PartialObserver<ChannelMessage<R>>) {
    return this.$mappedData.subscribe(observer);
  }

  toObservable() {
    return new Observable<ChannelMessage<R>>(subscriber => this.$mappedData.subscribe(subscriber));
  }

  async join() {
    this.join_ref = uuid();

    if (this._state !== CHANNEL_STATE.joined) {
      this._state = CHANNEL_STATE.joining;
      try {
        const result = await this.runCommand(CHANNEL_EVENT.phx_join);
        if (result.payload.status === "ok") {
          this._state = CHANNEL_STATE.joined;

          let queued: MessageToSocket<S>;
          while (queued = this.queue.pop()) { this.send(queued); }
        }
        else console.log(result);
      } catch (err) {
        if (err) this._state = CHANNEL_STATE.errored;
      }
    }
  }

  async leave() {
    if (this._state === CHANNEL_STATE.joined) {
      this._state = CHANNEL_STATE.leaving;
      try {
        const result = await this.runCommand(CHANNEL_EVENT.phx_leave);
        if (result.payload.status === "ok") this._state = CHANNEL_STATE.closed;
        else console.log(result);
      } catch (err) {
        if (err) this._state = CHANNEL_STATE.errored;
      }
    }
  }

  private send(data: MessageToSocket<S>) {
    this.socket.send(data);
  }

  next(event: string, payload: S) {
    if (this._state === CHANNEL_STATE.joined)
      this.send({ event, payload, join_ref: this.join_ref, ref: `${this.sequence++}`, topic: this.topic });
    else
      this.queue.push({ event, payload, join_ref: this.join_ref, ref: `${this.sequence++}`, topic: this.topic });
  }

  private async runCommand(event: CHANNEL_EVENT.phx_join | CHANNEL_EVENT.phx_leave, payload?: S) {
    // Keep the sequence within the scope
    const ref = `${this.sequence++}`;

    // Add to control sequence tracker
    this.controlSequences.push({ event, ref: ref });

    // Start the subscription
    const response = new Promise<ReplySocketMessage<R>>((res, rej) => {
      let resolved = false;
      // Keep the sequence within the scope
      const subscription = this.$rawData.subscribe({
        error: err => rej(err),
        //
        complete: () => {
          if (!resolved) rej(`Subscription unexpectedly completed before receiving reponse.`);
        },
        next: (data) => {
          if (isReplyMessage(data)) {
            // Resolve the promise to the data when the sequence matches the expected value
            if (data.ref === ref) {
              resolved = true;
              subscription.unsubscribe();
              res(data);
            }
          }
        },
      });
    });

    switch (event) {
      case CHANNEL_EVENT.phx_join:
        this._state = CHANNEL_STATE.joining;
        break;
      case CHANNEL_EVENT.phx_join:
        this._state = CHANNEL_STATE.leaving;
        break;
    }
    this.send({ event, join_ref: this.join_ref, ref, payload, topic: this.topic });
    return response;
  }

  async run(event: string, payload: S, opts?: { force: boolean }) {
    const { force = false } = opts ?? {};
    // Keep the sequence within the scope
    const ref = `${this.sequence++}`;

    // Running some event
    const response = new Promise<ReplyChannelMessage<R>>((res, rej) => {
      let resolved = false;
      // Keep the sequence within the scope
      this.$rawData.subscribe({
        error: err => rej(err),
        //
        complete: () => {
          if (!resolved) rej(`Subscription unexpectedly completed before receiving reponse.`);
        },
        next: (data) => {
          if (isReplyMessage(data)) {
            // Resolve the promise to the data when the sequence matches the expected value
            if (data.ref === ref) {
              resolved = true;
              // subscription.unsubscribe();
              res({
                event: data.event,
                payload: data.payload,
                type: "reply"
              });
            }
          }
        },
      });
    });
    if (this._state === CHANNEL_STATE.joined || force)
      this.send({ event, join_ref: this.join_ref, ref, payload, topic: this.topic });
    else
      this.queue.push({ event, join_ref: this.join_ref, ref, payload, topic: this.topic });
    return response;
  }
}

