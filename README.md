# Catuaba

## Description

A Typescript Client for connecting and interacting with Elixir's [Phoenix-Channels](https://hexdocs.pm/phoenix/channels.html) and [Absinthe](https://github.com/absinthe-graphql/absinthe), using [RxJS](https://rxjs-dev.firebaseapp.com/guide/overview)'s API.

## Motivation

Typescript is becoming a _de facto_ standard for Front-end Development, being already adopted or supported by most of Javascript Front-end Frameworks. This project aims to help quickstart an ecosystem of Typescript tools for interacting with the Elixir's ecosystem, while being extensible and maintainable.

## Features

### Done

- [x] Join and leave channels
- [x] Send messages
- [x] Subscribe to incomings messages
- [x] Handle Phoenix's Push, Reply and Broadcast message types
- [x] Send a message and receive a Promise that resolves to the Reply of this message
- [x] Decode binary messages (pending validation since it was directly ported from https://github.com/mcampa/phoenix-channels)
- [x] Heartbeats to maintain the WebSocket and Phoenix Channel connection alive
- [x] Message Queues for Socket and Channels
- [x] Force sending messages to a channel before being joined
- [x] Socket reconnection and Backoff
- [x] Suport for Queries

### Todo

- [ ] Tests
- [ ] Documentation
- [ ] Remove dependency on RXjs for Phoenix and Socket
