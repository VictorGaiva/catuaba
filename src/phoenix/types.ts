import { SocketPayloadType } from '../socket/types';

export type PushSocketMessage<T> = {
  join_ref: string;
  topic: string;
  event: string;
  payload: T;
};
export type ReplySocketMessage<T> = {
  join_ref: string;
  ref: string;
  topic: string;
  event: string;
  payload: { response: T; status: 'ok' | 'error' };
};
export type BroadcastSocketMessage<T> = {
  topic: string;
  event: string;
  payload: T;
};

export type MessageFromSocket<T extends SocketPayloadType = ArrayBuffer> =
  | PushSocketMessage<T>
  | ReplySocketMessage<T>
  | BroadcastSocketMessage<T>;

export type MessageToSocket<T extends SocketPayloadType> = {
  join_ref?: string;
  ref: string;
  topic: string;
  event: string;
  payload: T;
};

export function isPushMessage<T extends SocketPayloadType>(data: MessageFromSocket<T>): data is PushSocketMessage<T> {
  const { join_ref, ref } = data as ReplySocketMessage<T>;
  return join_ref !== undefined && join_ref !== null && (ref === undefined || ref === null);
}

export function isReplyMessage<T extends SocketPayloadType>(data: MessageFromSocket<T>): data is ReplySocketMessage<T> {
  const { ref } = data as ReplySocketMessage<T>;
  return ref !== undefined && ref !== null;
}

export function isBroadcastMessage<T extends SocketPayloadType>(
  data: MessageFromSocket<T>
): data is BroadcastSocketMessage<T> {
  const { join_ref, ref } = data as ReplySocketMessage<T>;
  return (join_ref === undefined || join_ref === null) && (ref === undefined || ref === null);
}

export type ChannelState = 'closed' | 'errored' | 'joined' | 'joining' | 'leaving' | 'disconnected';

export type ChannelEvent = 'phx_reply' | 'phx_error' | 'phx_close' | 'phx_join' | 'phx_leave';

export type ReplyChannelMessage<R extends SocketPayloadType> = Pick<ReplySocketMessage<R>, 'event' | 'payload'> & {
  type: 'reply';
};
export type BroadcastChannelMessage<R extends SocketPayloadType> = Pick<
  BroadcastSocketMessage<R>,
  'event' | 'payload' | 'topic'
> & { type: 'broadcast' };
export type PushChannelMessage<R extends SocketPayloadType> = Pick<PushSocketMessage<R>, 'event' | 'payload'> & {
  type: 'push';
};

export type ChannelMessage<R extends SocketPayloadType> =
  | ReplyChannelMessage<R>
  | BroadcastChannelMessage<R>
  | PushChannelMessage<R>;

export type ChannelRunOpts = {
  /**
   * Whether the data must be sent to the socket even if the channel not joined.
   * @type {boolean}
   */
  force?: boolean;
};

// Typechecking helpers
export function isReplyChannelMessage<T extends SocketPayloadType>(
  data: ChannelMessage<T>
): data is ReplyChannelMessage<T> {
  return data.type === 'reply';
}

export function isBroadcastChannelMessage<T extends SocketPayloadType>(
  data: ChannelMessage<T>
): data is BroadcastChannelMessage<T> {
  return data.type === 'broadcast';
}

export function isPushChannelMessage<T extends SocketPayloadType>(
  data: ChannelMessage<T>
): data is PushChannelMessage<T> {
  return data.type === 'push';
}

export function isBinary(data: MessageToSocket<SocketPayloadType>): data is MessageToSocket<ArrayBuffer> {
  return data.payload instanceof ArrayBuffer;
}

export enum MESSAGE_KIND {
  push = 0,
  reply = 1,
  broadcast = 2,
}
