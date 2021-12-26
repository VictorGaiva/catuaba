import { print } from 'graphql';
import { v4 as uuid } from 'uuid';
import { FetchResult, Operation } from '@apollo/client';

import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import { PhoenixSocket } from '../socket/socket';

import { BroadcastChannelMessage, MessageFromSocket, MessageToSocket } from '../phoenix/types';
import { PhoenixChannel } from '../phoenix/channel';
import { PhoenixSerializer } from '../phoenix/serializer';
import { getMainDefinition } from '@apollo/client/utilities';

type Send = { query?: string; variables?: Record<string, any>; subscriptionId?: string };
type Message<T> = { result: T; subscriptionId: string; errors?: any[] };
export class AbsintheOperation<T extends FetchResult = FetchResult> {
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

  constructor(
    url: string,
    joinParams: Record<string, string | number> | (() => Record<string, string | number>) = {},
    queryString: string | (() => string) = ''
  ) {
    this.socket = new PhoenixSocket(url, {
      encoder: this.serializer.encode,
      decoder: this.serializer.decode,
      queryString,
    });
    this.control = new PhoenixChannel('__absinthe__:control', joinParams, this.socket);
    this.broadcast = new PhoenixChannel('', joinParams, this.socket);

    this.control.join();
  }

  request(operation: Operation): Observable<FetchResult> {
    const definition = getMainDefinition(operation.query);
    if (definition.kind === 'OperationDefinition' && definition.operation === 'subscription') {
      return this.handleSubscription(operation);
    }
    return this.handleQuery(operation);
  }

  private handleSubscription(operation: Operation): Observable<FetchResult> {
    const id = uuid();
    this.operations[id] = { operation, subscriptionId: '' };

    const subscription = new Observable<BroadcastChannelMessage<Message<T>>>((subscriber) => {
      this.broadcast.subscribe<BroadcastChannelMessage<Message<T>>>(subscriber);

      this.control
        .run('doc', { query: print(operation.query), variables: operation.variables })
        .then(({ payload }) => (this.operations[id].subscriptionId = payload.response.subscriptionId))
        .catch(({ response }) => subscriber.error(response));
    }).pipe(
      filter(({ event }) => event === 'subscription:data'),
      filter(({ topic }) => topic === this.operations[id].subscriptionId),
      map(({ payload }) => payload.result)
    );

    return new Observable<T>((subscriber) => {
      subscription.subscribe(subscriber);

      return () => {
        if (this.operations[id].subscriptionId) {
          this.control.next('unsubscribe', { subscriptionId: `${this.operations[id].subscriptionId}` });
        }
        delete this.operations[id];
      };
    });
  }

  private handleQuery(operation: Operation): Observable<FetchResult> {
    return new Observable<FetchResult>((subscriber) => {
      this.control.run('doc', { query: print(operation.query), variables: operation.variables }).then(({ payload }) => {
        const { response } = payload;
        if (payload.status === 'error') {
          subscriber.error(response.errors);
        } else {
          subscriber.next(response);
          subscriber.complete();
        }
      });
    });
  }
}
