import { print } from 'graphql';
import { v4 as uuid } from 'uuid';
import { FetchResult, Operation } from '@apollo/client';

import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import { PhoenixChannel } from '../phoenix/channel';
import { PhoenixSocket } from '../socket/socket';
import { BroadcastSocketMessage, isBroadcastMessage, MessageFromSocket, MessageToSocket } from '../phoenix/types';
import { PhoenixSerializer } from '../phoenix/serializer';

export class AbsintheSubscription<
  T extends FetchResult = FetchResult,
  Message extends { result: T; subscriptionId: string } = { result: T; subscriptionId: string }
> {
  private operations: {
    [key: string]: {
      operation: Operation;
      subscriptionId: string;
    };
  } = {};
  private data: Observable<BroadcastSocketMessage<Message>>;

  private socket: PhoenixSocket<MessageToSocket<Message>, MessageFromSocket<Message>>;
  private channel: PhoenixChannel<Message, Message>;
  private serializer: PhoenixSerializer<Message, Message> = new PhoenixSerializer();

  constructor(url: string) {
    this.socket = new PhoenixSocket({
      url,
      encoder: this.serializer.encode,
      decoder: this.serializer.decode,
    });
    this.channel = new PhoenixChannel('__absinthe__:control', this.socket);
    this.channel.join();

    this.data = new Observable<MessageFromSocket<Message>>(subscriber => this.socket.subscribe(subscriber)).pipe(
      filter(isBroadcastMessage),
      filter(({ event }) => event === 'subscription:data')
    );
  }

  request(operation: Operation): Observable<FetchResult> {
    const id = uuid();
    this.operations[id] = { operation, subscriptionId: '' };

    const subscription = new Observable<BroadcastSocketMessage<Message>>(subscriber =>
      this.data.subscribe(subscriber)
    ).pipe(
      filter(({ topic }) => topic === this.operations[id]!.subscriptionId),
      map(({ payload: { result } }) => result)
    );

    this.channel
      .run('doc', { query: print(operation.query), variables: operation.variables })
      .then(({ payload }) => (this.operations[id]!.subscriptionId = payload.response.subscriptionId));

    return new Observable<T>(subscriber => {
      subscription.subscribe(subscriber);

      return () => {
        this.channel.next('unsubscribe', { subscriptionId: `${this.operations[id].subscriptionId}` } as Message);
        delete this.operations[id];
      };
    });
  }
}
