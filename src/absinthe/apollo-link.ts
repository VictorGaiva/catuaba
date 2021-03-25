import { ApolloLink, FetchResult, NextLink, Operation } from "@apollo/client";
import ZenObservable from "zen-observable";

import { AbsintheSubscription } from './subscription';

export class AbsintheLink extends ApolloLink {
  private client: AbsintheSubscription;
  constructor(url: string) {
    super();
    this.client = new AbsintheSubscription(url);
  }

  request(operation: Operation, _forward?: NextLink) {
    return new ZenObservable<FetchResult>(
      subscriber => this.client.request(operation).subscribe(subscriber)
    );
  }

}