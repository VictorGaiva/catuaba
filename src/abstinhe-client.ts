import { FetchResult, Operation } from "@apollo/client";
import { PhoenixChannel, } from "./phoenix-channel";
import { Observable } from "rxjs";
import { v4 as uuid } from "uuid";
import { filter, map } from "rxjs/operators";
import { print } from 'graphql';
import { BroadcastSocketMessage, isBroadcastMessage, MessageFromSocket, PhoenixSocket } from "./phoenix-socket";

export class AbsintheSubscriptionClient<T extends FetchResult = FetchResult> {
  private operations: {
    [key: string]: {
      operation: Operation;
      subscriptionId: string;
    }
  }
  private socket: PhoenixSocket<{ result: T, subscriptionId: string; }>;
  private channel: PhoenixChannel<{ result: T, subscriptionId: string; }>;
  private data: Observable<BroadcastSocketMessage<{ result: T, subscriptionId: string; }>>

  constructor(url: string) {
    this.socket = new PhoenixSocket({ url });
    this.channel = new PhoenixChannel("__absinthe__:control", this.socket);
    this.channel.join();
    this.operations = {};

    this.data = new Observable<MessageFromSocket<{ result: T, subscriptionId: string; }>>(
      subscriber => this.socket.subscribe(subscriber)
    ).pipe(
      filter(isBroadcastMessage),
      filter(({ event }) => event === "subscription:data"),
    )
  }

  subscribe(operation: Operation): Observable<FetchResult> {
    const id = uuid();
    this.operations[id] = { operation, subscriptionId: "" }

    const subscription = new Observable<BroadcastSocketMessage<{ result: T, subscriptionId: string; }>>(
      subscriber => this.data.subscribe(subscriber)
    ).pipe(
      filter(({ topic }) => topic === this.operations[id].subscriptionId),
      map(({ payload: { result } }) => result),
    )

    this.channel.run("doc", { query: print(operation.query), variables: operation.variables }).then(
      ({ payload }) => this.operations[id].subscriptionId = payload.response.subscriptionId
    )

    return new Observable<T>(subscriber => {
      subscription.subscribe(subscriber);

      return () => {
        this.channel.next("unsubscribe", { subscriptionId: `${this.operations[id].subscriptionId}` })
        delete this.operations[id];
      }
    });
  }


}