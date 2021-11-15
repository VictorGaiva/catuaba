export enum MESSAGE_KIND {
  push = 0,
  reply = 1,
  broadcast = 2,
}

export type RawSocketMessage = string | ArrayBuffer;
export type SocketPayloadType = Object | ArrayBuffer;

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
  payload: { response: T; status: string };
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
