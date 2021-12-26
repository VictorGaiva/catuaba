import { v4 as uuid } from 'uuid';
import { Observable, PartialObserver } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import {
  BroadcastChannelMessage,
  ChannelMessage,
  ChannelRunOpts,
  ChannelState,
  isBroadcastMessage,
  isPushMessage,
  isReplyMessage,
  MessageFromSocket,
  MessageToSocket,
  ReplyChannelMessage,
  ReplySocketMessage,
} from './types';
import { PhoenixSocket } from '../socket/socket';

export class PhoenixChannel<Send = unknown, Receive = Send> {
  private join_ref: string | undefined;
  private sequence: number = 1;
  private _state: ChannelState = 'closed';

  private $rawData: Observable<MessageFromSocket<Receive>>;
  private $mappedData: Observable<ChannelMessage<Receive>>;

  private queue: MessageToSocket<Send>[] = [];

  constructor(
    private _topic: string,
    private joinParams: (() => Record<string, string | number>) | Record<string, string | number> = {},
    private socket: PhoenixSocket<MessageToSocket<Send>, MessageFromSocket<Receive>>
  ) {
    if (_topic === '') {
      this.$rawData = new Observable<MessageFromSocket<Receive>>((subscriber) =>
        this.socket.subscribe(subscriber)
      ).pipe(filter(isBroadcastMessage));

      this.$mappedData = this.$rawData.pipe(
        map<MessageFromSocket<Receive>, BroadcastChannelMessage<Receive>>(
          (data) => ({ ...data, type: 'broadcast' } as BroadcastChannelMessage<Receive>)
        )
      );
    } else {
      this.$rawData = new Observable<MessageFromSocket<Receive>>((subscriber) =>
        this.socket.subscribe(subscriber)
      ).pipe(filter(({ topic }) => topic === this._topic));

      this.$mappedData = this.$rawData.pipe(map(PhoenixChannel.SocketToChannel<Receive>()));
    }

    // Controller
    this.$rawData.subscribe({
      complete: () => {
        this._state = 'closed';
      },
      error: () => {
        this._state = 'errored';
      },
      next: () => {},
    });

    if (!this.socket.hasRunner) {
      this.socket.registerHeartbeatRunner(15000, 1000, async () => {
        await this.runCommand('heartbeat');
      });
    }
  }

  get state() {
    return this._state;
  }

  get topic() {
    return this._topic;
  }

  private static SocketToChannel<Receive>(): (message: MessageFromSocket<Receive>) => ChannelMessage<Receive> {
    return (message) => {
      if (isPushMessage(message))
        return {
          event: message.event,
          payload: message.payload,
          type: 'push',
        };
      else if (isBroadcastMessage(message))
        return {
          event: message.event,
          payload: message.payload,
          type: 'broadcast',
          topic: message.topic,
        };
      else
        return {
          event: message.event,
          payload: message.payload,
          type: 'reply',
        };
    };
  }

  subscribe<T extends ChannelMessage<Receive> = ChannelMessage<Receive>>(observer: PartialObserver<T>) {
    return this.$mappedData.subscribe(observer as any);
  }

  toObservable() {
    return new Observable<ChannelMessage<Receive>>((subscriber) => this.$mappedData.subscribe(subscriber));
  }

  /**
   * Joins the channel, returning a promise that resolves when the channel is joined.
   */
  async join() {
    if (this._topic === '') {
      throw new Error('Cannot join Broadcast channel');
    }
    if (this._state === 'joined') {
      throw new Error('Error: tried to join multiple times');
    }

    this.join_ref ??= uuid();
    this._state = 'joining';
    try {
      const result = await this.runCommand('phx_join');
      if (result.payload.status === 'ok') {
        this._state = 'joined';

        // Once joined, we want to be notified when the socket disconnects and then reconnects, so we can attempt to rejoin.
        this.socket.addEventListener('disconnected', () => (this._state = 'disconnected'), { once: true });
        this.socket.addEventListener('reconnected', () => this.join(), { once: true });

        this.queue.forEach((queued) => this.send(queued));
        this.queue = [];
      }
    } catch (err) {
      if (err) this._state = 'errored';
    }
  }

  /**
   * Leaves the channel, and returns a promise that resolves when the channel has left.
   */
  async leave() {
    if (this._state !== 'joined') return;

    this._state = 'leaving';
    try {
      const result = await this.runCommand('phx_leave');
      if (result.payload.status === 'ok') this._state = 'closed';
    } catch (err) {
      if (err) this._state = 'errored';
    }
  }

  /**
   * Sends an Event+Payload to the socket. If the socket is not yet joined, the data is queued and sent when the socket is joined.
   * @param event The event to send
   * @param payload The payload to send
   */
  next(event: string, payload: Send) {
    if (this._topic === '') {
      throw new Error('Cannot send data to Broadcast channel');
    }
    if (this._state === 'joined')
      this.send({ event, payload, join_ref: this.join_ref, ref: `${this.sequence++}`, topic: this._topic });
    else this.queue.push({ event, payload, join_ref: this.join_ref, ref: `${this.sequence++}`, topic: this._topic });
  }

  /**
   * Sends an event payload and returns a promise that resolves to the response.
   * @param event The event to send
   * @param payload The payload to send
   * @param options Options for the command.
   */
  async run(event: string, payload: Send, opts?: ChannelRunOpts) {
    if (this._topic === '') {
      throw new Error('Cannot send data to Broadcast channel');
    }
    const { force = false } = opts ?? {};
    // Keep the sequence within the scope
    const ref = `${this.sequence++}`;

    // Running some event
    const response = new Promise<ReplyChannelMessage<Receive>>((res, rej) => {
      let replied = false;
      // Keep the sequence within the scope
      this.$rawData.subscribe({
        error: (err) => rej(err),
        complete: () => {
          if (!replied) rej('Subscription unexpectedly completed before receiving reponse.');
        },
        next: (data) => {
          if (isReplyMessage(data)) {
            // Resolve the promise to the data when the sequence matches the expected value
            if (data.ref === ref) {
              if (data.payload.status === 'error') {
                rej(data.payload);
              } else {
                replied = true;
                res({
                  event: data.event,
                  payload: data.payload,
                  type: 'reply',
                });
              }
            }
          }
        },
      });
    });
    if (this._state === 'joined' || force)
      this.send({ event, join_ref: this.join_ref, ref, payload, topic: this._topic });
    else this.queue.push({ event, join_ref: this.join_ref, ref, payload, topic: this._topic });
    return response;
  }

  /**
   * Send the data to the socket
   */
  private send(data: MessageToSocket<Send>) {
    this.socket.send(data);
  }

  /**
   * Send the command to the socket
   */
  private async runCommand(event: 'phx_join' | 'phx_leave' | 'heartbeat') {
    if (this._topic === '') {
      throw new Error('Cannot send data to Broadcast channel');
    }
    // Keep the sequence within the scope
    const ref = `${this.sequence++}`;

    // Start the subscription
    const response = new Promise<ReplySocketMessage<Receive>>((res, rej) => {
      let resolved = false;
      // Keep the sequence within the scope
      const subscription = this.$rawData.subscribe({
        error: (err) => rej(err),
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
      case 'phx_join':
        this._state = 'joining';
        break;
      case 'phx_leave':
        this._state = 'leaving';
        break;
    }
    this.send({
      event,
      join_ref: this.join_ref,
      ref,
      payload: (typeof this.joinParams === 'function' ? this.joinParams() : this.joinParams) as unknown as Send,
      topic: event === 'heartbeat' ? 'phoenix' : this._topic,
    });
    return response;
  }
}
