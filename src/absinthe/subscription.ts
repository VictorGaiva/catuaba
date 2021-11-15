import { print } from 'graphql';
import { v4 as uuid } from 'uuid';
import { FetchResult, Operation } from '@apollo/client';

import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import { PhoenixSocket } from '../socket/socket';

import { BroadcastChannelMessage, MessageFromSocket, MessageToSocket } from '../phoenix/types';
import { PhoenixChannel } from '../phoenix/channel';
import { PhoenixSerializer } from '../phoenix/serializer';

type Send = { query?: string; variables?: Record<string, any>; subscriptionId?: string };
type Message<T> = { result: T; subscriptionId: string };
export class AbsintheSubscription<T extends FetchResult = FetchResult> {
  private operations: {
    [key: string]: {
      operation: Operation;
      subscriptionId: string;
    };
  } = {};
  private control: PhoenixChannel<Send, Message<T>>;
  private broadcast: PhoenixChannel<Send, Message<T>>;

  private socket: PhoenixSocket<MessageToSocket<Send>, MessageFromSocket<Message<T>>>;
  private serializer: PhoenixSerializer<Send, Message<T>> = new PhoenixSerializer();

  constructor(url: string) {
    this.socket = new PhoenixSocket({
      url,
      encoder: this.serializer.encode,
      decoder: this.serializer.decode,
    });
    this.control = new PhoenixChannel(this.socket, { topic: '__absinthe__:control' });
    this.broadcast = new PhoenixChannel(this.socket, { broadcast: true });

    this.control.join();
  }

  request(operation: Operation): Observable<FetchResult> {
    const id = uuid();
    this.operations[id] = { operation, subscriptionId: '' };

    const subscription = new Observable<BroadcastChannelMessage<Message<T>>>(subscriber =>
      this.broadcast.subscribe<BroadcastChannelMessage<Message<T>>>(subscriber)
    ).pipe(
      filter(({ event }) => event === 'subscription:data'),
      filter(({ topic }) => topic === this.operations[id]!.subscriptionId),
      map(({ payload: { result } }) => result)
    );

    this.control
      .run('doc', { query: print(operation.query), variables: operation.variables })
      .then(({ payload }) => (this.operations[id]!.subscriptionId = payload.response.subscriptionId));

    return new Observable<T>(subscriber => {
      subscription.subscribe(subscriber);

      return () => {
        this.control.next('unsubscribe', { subscriptionId: `${this.operations[id].subscriptionId}` } as Send);
        delete this.operations[id];
      };
    });
  }
}
