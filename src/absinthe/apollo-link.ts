import { ApolloLink, FetchResult, NextLink, Operation } from '@apollo/client';
import ZenObservable from 'zen-observable';

import { AbsintheOperation } from './absinthe';

export class AbsintheLink extends ApolloLink {
  private client: AbsintheOperation;
  constructor(url: string, joinParams?: Record<string, unknown> | (() => Record<string, unknown>)) {
    super();
    this.client = new AbsintheOperation(url, joinParams);
  }

  request(operation: Operation, _forward?: NextLink) {
    return new ZenObservable<FetchResult>(subscriber => this.client.request(operation).subscribe(subscriber));
  }
}
