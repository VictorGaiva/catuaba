import { ApolloLink, FetchResult, NextLink, Operation } from '@apollo/client';
import ZenObservable from 'zen-observable';

import { AbsintheOperation } from './absinthe';

export class AbsintheLink extends ApolloLink {
  private client: AbsintheOperation;
  constructor(url: string) {
    super();
    this.client = new AbsintheOperation(url);
  }

  request(operation: Operation, _forward?: NextLink) {
    return new ZenObservable<FetchResult>(subscriber => this.client.request(operation).subscribe(subscriber));
  }
}
