import { ApolloLink, NextLink, Operation } from "@apollo/client";
import ZenObservable from "zen-observable";

import { AbsintheSubscriptionClient } from './abstinhe-client';

export class AbsintheLink extends ApolloLink {
  private client: AbsintheSubscriptionClient;
  constructor(url: string) {
    super();
    this.client = new AbsintheSubscriptionClient(url);
  }

  request(operation: Operation, _forward?: NextLink) {
    const subscription = this.client.subscribe(operation);
    const observable = new ZenObservable(subscriber => subscription.subscribe(subscriber));

    return observable
  }

}