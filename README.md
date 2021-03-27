# Catuaba

## Description
A Typescript Client for connecting and interacting with Elixir's [Phoenix-Channels](https://hexdocs.pm/phoenix/channels.html) and [Absinthe](https://github.com/absinthe-graphql/absinthe), using [RxJS](https://rxjs-dev.firebaseapp.com/guide/overview)'s API.

## Motivation
Typescript is becoming a _de facto_ standard for Front-end Development, being already adopted or  supported by most of Javascript Front-end Frameworks. This project aims to help quickstart an ecosystem of Typescript tools for interacting with the Elixir's ecosystem, while being extensible and maintainable.


## Features

### Done
- Join and leave channels
- Send messages
- Subscribe to incomings messages
- Handle Phoenix's Push, Reply and Broadcast message types
- Send a message and receive a Promise that resolves to the Reply of this message
- Decode binary messages (pending validation since it was directly ported from https://github.com/mcampa/phoenix-channels)
- Heartbeats to maintain the WebSocket and Phoenix Channel connection alive
- Message Queues for Socket and Channels
- Force sending messages to a channel before being joined

### Todo
- Timeout and reconnection
- Validate the protocol
- Validate payload types
- Implement 'longpoll'
- Tests
- Documentation
