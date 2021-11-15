import { BroadcastSocketMessage, SocketPayloadType } from '../socket/types';

export type ChannelState = 'closed' | 'errored' | 'joined' | 'joining' | 'leaving';

export type ChannelEvent = 'phx_reply' | 'phx_error' | 'phx_close' | 'phx_join' | 'phx_leave';

export type ReplyChannelMessage<R extends SocketPayloadType> = Pick<ReplySocketMessage<R>, 'event' | 'payload'> & {
  type: 'reply';
};
export type BroadcastChannelMessage<R extends SocketPayloadType> = Pick<
  BroadcastSocketMessage<R>,
  'event' | 'payload'
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
