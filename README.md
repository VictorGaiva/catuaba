# Catuaba

## Description
A Typescript Client for connecting and interacting with Elixir's [Phoenix-Channels](https://hexdocs.pm/phoenix/channels.html), using [RxJS](https://rxjs-dev.firebaseapp.com/guide/overview)'s API.

## Motivation
Typescript is becoming a _de facto_ standard for Front-end Development, being already adopted or  supported by most of Javascript Front-end Frameworks. This project aims help quickstart the creation of a set of tools that interact with the Elixir ecosystem using modern and robust tools, while also providing extensibility maintainability.


## Features

### Done
- [x] Join and leave channels
- [x] Send and receive messages
- [x] Handle Push, Reply and Broadcast message types
- [x] Decode binary messages (pending validation since it was directly ported from https://github.com/mcampa/phoenix-channels)
- [x] Heartbeats
- [x] Queues

### Todo
- [ ] Timeout
- [ ] Validate the protocol
- [ ] Validate payload types
- [ ] Implement 'longpoll'
- [ ] Tests
