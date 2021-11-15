import { v4 as uuid } from 'uuid';
import { Observable, PartialObserver } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import {
  ChannelEvent,
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
import { SocketPayloadType } from '../socket/types';
import { PhoenixSocket } from '../socket/socket';

export class PhoenixChannel<
  R extends SocketPayloadType = SocketPayloadType,
  S extends SocketPayloadType = SocketPayloadType
> {
  private join_ref: string | undefined;
  private sequence: number = 1;
  private _state: ChannelState = 'closed';

  private $rawData: Observable<MessageFromSocket<R>>;
  private $mappedData: Observable<ChannelMessage<R>>;

  private controlSequences: { event: ChannelEvent; ref: string }[] = [];

  private queue: MessageToSocket<S>[] = [];

  constructor(private topic: string, private socket: PhoenixSocket<MessageFromSocket<R>, MessageToSocket<S>>) {
    // Messages for this Channel
    this.$rawData = new Observable<MessageFromSocket<R>>(subscriber => this.socket.subscribe(subscriber)).pipe(
      filter(({ topic }) => topic === this.topic)
    );

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

    this.$mappedData = this.$rawData.pipe(
      map<MessageFromSocket<R>, ChannelMessage<R>>(message => {
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
          };
        else
          return {
            event: message.event,
            payload: message.payload,
            type: 'reply',
          };
      })
    );
  }

  get state() {
    return `${this._state}`;
  }

  subscribe(observer: PartialObserver<ChannelMessage<R>>) {
    return this.$mappedData.subscribe(observer);
  }

  toObservable() {
    return new Observable<ChannelMessage<R>>(subscriber => this.$mappedData.subscribe(subscriber));
  }

  /**
   * Joins the channel, returning a promise that resolves when the channel is joined.
   */
  async join() {
    this.join_ref = uuid();

    if (this._state !== 'joined') {
      this._state = 'joining';
      try {
        const result = await this.runCommand('phx_join');
        if (result.payload.status === 'ok') {
          this._state = 'joined';

          for (const queued of this.queue) {
            this.send(queued);
          }
          this.queue = [];
        } else console.log(result);
      } catch (err) {
        if (err) this._state = 'errored';
      }
    }
  }

  /**
   * Leaves the channel, and returns a promise that resolves when the channel has left.
   */
  async leave() {
    if (this._state === 'joined') {
      this._state = 'leaving';
      try {
        const result = await this.runCommand('phx_leave');
        if (result.payload.status === 'ok') this._state = 'closed';
        else console.log(result);
      } catch (err) {
        if (err) this._state = 'errored';
      }
    }
  }

  /**
   * Sends an Event+Payload to the socket. If the socket is not yet joined, the data is queued and sent when the socket is joined.
   * @param event The event to send
   * @param payload The payload to send
   */
  next(event: string, payload: S) {
    if (this._state === 'joined')
      this.send({ event, payload, join_ref: this.join_ref, ref: `${this.sequence++}`, topic: this.topic });
    else this.queue.push({ event, payload, join_ref: this.join_ref, ref: `${this.sequence++}`, topic: this.topic });
  }

  /**
   * Sends an event payload and returns a promise that resolves to the response.
   * @param event The event to send
   * @param payload The payload to send
   * @param options Options for the command.
   */
  async run(event: string, payload: S, opts?: ChannelRunOpts) {
    const { force = false } = opts ?? {};
    // Keep the sequence within the scope
    const ref = `${this.sequence++}`;

    // Running some event
    const response = new Promise<ReplyChannelMessage<R>>((res, rej) => {
      let resolved = false;
      // Keep the sequence within the scope
      this.$rawData.subscribe({
        error: err => rej(err),
        complete: () => {
          if (!resolved) rej(`Subscription unexpectedly completed before receiving reponse.`);
        },
        next: data => {
          if (isReplyMessage(data)) {
            // Resolve the promise to the data when the sequence matches the expected value
            if (data.ref === ref) {
              resolved = true;
              res({
                event: data.event,
                payload: data.payload,
                type: 'reply',
              });
            }
          }
        },
      });
    });
    if (this._state === 'joined' || force)
      this.send({ event, join_ref: this.join_ref, ref, payload, topic: this.topic });
    else this.queue.push({ event, join_ref: this.join_ref, ref, payload, topic: this.topic });
    return response;
  }

  /**
   * Send the data to the socket
   */
  private send(data: MessageToSocket<S>) {
    this.socket.send(data);
  }

  /**
   * Send the command to the socket
   */
  private async runCommand(event: 'phx_join' | 'phx_leave', payload?: S) {
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
        next: data => {
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
    this.send({ event, join_ref: this.join_ref, ref, payload: payload ?? ({} as S), topic: this.topic });
    return response;
  }
}
