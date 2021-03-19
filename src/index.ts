import { v4 as uuid } from "uuid";
import { Observable, PartialObserver, Subject } from "rxjs";
import { filter, map } from "rxjs/operators";

const DEFAULT_VSN = "2.0.0";
const DEFAULT_TIMEOUT = 10000;
const WS_CLOSE_NORMAL = 1000;

enum CHANNEL_EVENT {
  phx_close = "phx_close",
  phx_error = "phx_error",
  phx_join = "phx_join",
  phx_reply = "phx_reply",
  phx_leave = "phx_leave",
}

enum CHANNEL_STATE {
  closed = "closed",
  errored = "errored",
  joined = "joined",
  joining = "joining",
  leaving = "leaving",
}

enum MESSAGE_KIND {
  push = 0,
  reply = 1,
  broadcast = 2,
}

const TRANSPORTS = {
  longpoll: "longpoll",
  websocket: "websocket",
};

type RawSocketMessage = string | ArrayBuffer;
type PayloadType = Object | ArrayBuffer;

type PushSocketMessage<T> = {
  join_ref: string;
  topic: string;
  event: string;
  payload: T;
};
type ReplySocketMessage<T> = {
  join_ref: string;
  ref: string;
  topic: string;
  event: string;
  payload: { response: T; status: string };
};
type BroadcastSocketMessage<T> = {
  topic: string;
  event: string;
  payload: T;
};

type MessageFromSocket<T extends PayloadType = ArrayBuffer> =
  | PushSocketMessage<T>
  | ReplySocketMessage<T>
  | BroadcastSocketMessage<T>;

type MessageToSocket<T extends PayloadType> = {
  join_ref: string;
  ref: string;
  topic: string;
  event: string;
  payload: T;
};

function isBinary(data: MessageToSocket<PayloadType>): data is MessageToSocket<ArrayBuffer> {
  return data.payload instanceof ArrayBuffer;
}

export function isPushMessage<T extends PayloadType>(data: MessageFromSocket<T>): data is PushSocketMessage<T> {
  const { join_ref, ref } = data as ReplySocketMessage<T>;
  return join_ref !== undefined && ref === undefined;
}

export function isReplyMessage<T extends PayloadType>(data: MessageFromSocket<T>): data is ReplySocketMessage<T> {
  const { join_ref, ref } = data as ReplySocketMessage<T>;
  return join_ref !== undefined && ref !== undefined;
}

export function isBroadcastMessage<T extends PayloadType>(
  data: MessageFromSocket<T>
): data is BroadcastSocketMessage<T> {
  const { join_ref, ref } = data as ReplySocketMessage<T>;
  return join_ref === undefined && ref === undefined;
}

export class Serializer {
  private HEADER_LENGTH: number;
  private META_LENGTH: number;

  constructor() {
    this.HEADER_LENGTH = 1;
    this.META_LENGTH = 4;
  }

  encode<T>(data: MessageToSocket<T>) {
    return isBinary(data) ? this.binaryEncode(data) : JSON.stringify(data);
  }

  decode<T>(data: RawSocketMessage): MessageFromSocket<T> {
    return data instanceof ArrayBuffer ? this.binaryDecode(data) : JSON.parse(data);
  }

  private binaryEncode({ join_ref, ref, event, topic, payload }: MessageToSocket<ArrayBuffer>) {
    const metaLength = this.META_LENGTH + join_ref.length + ref.length + topic.length + event.length;
    const header = new ArrayBuffer(this.HEADER_LENGTH + metaLength);
    const view = new DataView(header);
    let offset = 0;

    view.setUint8(offset++, MESSAGE_KIND.push);
    view.setUint8(offset++, join_ref.length);
    view.setUint8(offset++, ref.length);
    view.setUint8(offset++, topic.length);
    view.setUint8(offset++, event.length);

    Array.from(join_ref, (char) => view.setUint8(offset++, char.charCodeAt(0)));
    Array.from(ref, (char) => view.setUint8(offset++, char.charCodeAt(0)));
    Array.from(topic, (char) => view.setUint8(offset++, char.charCodeAt(0)));
    Array.from(event, (char) => view.setUint8(offset++, char.charCodeAt(0)));

    let combined = new Uint8Array(header.byteLength + payload.byteLength);
    combined.set(new Uint8Array(header), 0);
    combined.set(new Uint8Array(payload), header.byteLength);

    return combined.buffer;
  }

  private binaryDecode(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    const kind = view.getUint8(0);
    const decoder = new TextDecoder();
    switch (kind) {
      case MESSAGE_KIND.push:
        return this.decodePush(buffer, view, decoder);
      case MESSAGE_KIND.reply:
        return this.decodeReply(buffer, view, decoder);
      case MESSAGE_KIND.broadcast:
        return this.decodeBroadcast(buffer, view, decoder);
    }
  }

  private decodePush(buffer: ArrayBuffer, view: DataView, decoder: TextDecoder): PushSocketMessage<ArrayBuffer> {
    const idSize = view.getUint8(1);
    const topicSize = view.getUint8(2);
    const eventSize = view.getUint8(3);

    let offset = this.HEADER_LENGTH + this.META_LENGTH - 1; // pushes have no ref

    const join_ref = decoder.decode(buffer.slice(offset, offset + idSize));
    offset = offset + idSize;
    const topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    const event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;
    const payload = buffer.slice(offset, buffer.byteLength);

    return { join_ref, topic, event, payload };
  }

  private decodeReply(buffer: ArrayBuffer, view: DataView, decoder: TextDecoder): ReplySocketMessage<ArrayBuffer> {
    const idSize = view.getUint8(1);
    const seqSize = view.getUint8(2);
    const topicSize = view.getUint8(3);
    const eventSize = view.getUint8(4);
    let offset = this.HEADER_LENGTH + this.META_LENGTH;

    const join_ref = decoder.decode(buffer.slice(offset, offset + idSize));
    offset = offset + idSize;
    const ref = decoder.decode(buffer.slice(offset, offset + seqSize));
    offset = offset + seqSize;
    const topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    const event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;

    const data = buffer.slice(offset, buffer.byteLength);

    return { join_ref, ref, topic, event: CHANNEL_EVENT.phx_reply, payload: { status: event, response: data } };
  }

  private decodeBroadcast(
    buffer: ArrayBuffer,
    view: DataView,
    decoder: TextDecoder
  ): BroadcastSocketMessage<ArrayBuffer> {
    const topicSize = view.getUint8(1);
    const eventSize = view.getUint8(2);
    let offset = this.HEADER_LENGTH + 2;
    const topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    const event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;
    const payload = buffer.slice(offset, buffer.byteLength);

    return { topic, event, payload };
  }
}

export class PhoenixSocket<R extends PayloadType = PayloadType, S extends PayloadType = PayloadType> {
  private socket: WebSocket;
  private subject: Subject<MessageFromSocket<R>>;

  private serializer: Serializer;

  private open: Promise<void>;

  constructor({ url, protocols }: { url: string; protocols?: string | string[] }) {
    this.socket = new WebSocket(url, protocols);
    this.subject = new Subject();
    this.serializer = new Serializer();

    this.socket.addEventListener("close", (e) => {
      this.subject.complete();
    });

    this.socket.addEventListener("message", (e: MessageEvent<RawSocketMessage>) => {
      try {
        this.subject.next(this.serializer.decode(e.data));
      } catch (err) {
        this.subject.error(err);
      }
    });

    this.open = new Promise((res, rej) => {
      this.socket.addEventListener("open", (e) => {
        if (this.socket.readyState === WebSocket.OPEN) res();
      });

      this.socket.addEventListener("error", (e) => {
        this.subject.error(e);
        rej();
      });
    });
  }

  subscribe(observer: PartialObserver<MessageFromSocket<R>>) {
    return this.subject.subscribe(observer);
  }

  send(data: MessageToSocket<S>) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.open.then(() => this.socket.send(this.serializer.encode(data)));
    } else {
      this.socket.send(this.serializer.encode(data));
    }
  }
}

export class PhoenixChannel<R extends PayloadType = PayloadType, S extends PayloadType = PayloadType> {
  private join_ref: string;
  private topic: string;
  private sequence: number;
  private _state: CHANNEL_STATE;

  private socket: PhoenixSocket<R, S>;
  private subject: Subject<MessageFromSocket<R>>;

  private data: Observable<MessageFromSocket<R>>;
  private control: Observable<MessageFromSocket<R>>;

  private controlSequences: { event: CHANNEL_EVENT; ref: string }[];

  constructor(topic: string, socket: PhoenixSocket<R, S>) {
    this.join_ref = uuid();
    this.sequence = 1;
    this.topic = topic;
    this._state = CHANNEL_STATE.closed;
    this.controlSequences = [];

    // Strongly type socket data even if an 'unknown' is passed
    this.socket = socket;

    // Subscribe to socket messages
    this.subject = new Subject();
    this.socket.subscribe(this.subject);

    // Messages for this Channel
    this.data = this.subject.pipe(filter(({ topic }) => topic === this.topic));

    // Controller
    this.control.subscribe({
      complete: () => {
        this._state = CHANNEL_STATE.closed;
      },
      error: () => {
        this._state = CHANNEL_STATE.errored;
      },
      next: () => {},
    });
  }

  get state() {
    return this._state;
  }

  subscribe(observer: PartialObserver<MessageFromSocket<R>>) {
    return this.data.pipe(map((value) => value[2])).subscribe(observer);
  }

  async join() {
    if (this._state !== CHANNEL_STATE.joined) {
      this._state = CHANNEL_STATE.joining;
      try {
        const result = await this.runCommand(CHANNEL_EVENT.phx_join);
        if (result.payload.status === "ok") this._state = CHANNEL_STATE.joined;
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
    this.send({ event, join_ref: this.join_ref, ref: `${this.sequence++}`, payload, topic: this.topic });
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
      const subscription = this.control.subscribe({
        error: () => rej(),
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

  async run(event: string, payload?: S) {
    // Keep the sequence within the scope
    const ref = `${this.sequence++}`;

    // Running some event
    const response = new Promise<ReplySocketMessage<R>>((res, rej) => {
      let resolved = false;
      // Keep the sequence within the scope
      const subscription = this.data.subscribe({
        error: () => rej(),
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
    this.send({ event, join_ref: this.join_ref, ref, payload, topic: this.topic });
    return response;
  }
}
