import { RawSocketMessage } from '../socket/types';
import {
  BroadcastSocketMessage,
  isBinary,
  MessageFromSocket,
  MessageToSocket,
  MESSAGE_KIND,
  PushSocketMessage,
  ReplySocketMessage,
} from './types';

const HEADER_LENGTH = 1;
const META_LENGTH = 4;

export class PhoenixSerializer {
  static encode<T>(data: MessageToSocket<T>) {
    return isBinary(data)
      ? this.binaryEncode(data)
      : JSON.stringify([data.join_ref, data.ref, data.topic, data.event, data.payload]);
  }

  // TODO: fix typing
  static decode<T>(data: RawSocketMessage): MessageFromSocket<T> {
    if (data instanceof ArrayBuffer) {
      //@ts-ignore
      return this.binaryDecode(data);
    }
    const [join_ref, ref, topic, event, payload] = JSON.parse(data);
    return { join_ref, ref, topic, event, payload };
  }

  private static binaryEncode({ join_ref = '', ref, event, topic, payload }: MessageToSocket<ArrayBuffer>) {
    const metaLength = META_LENGTH + join_ref.length + ref.length + topic.length + event.length;
    const header = new ArrayBuffer(HEADER_LENGTH + metaLength);
    const view = new DataView(header);
    let offset = 0;

    view.setUint8(offset++, MESSAGE_KIND.push);
    view.setUint8(offset++, join_ref.length);
    view.setUint8(offset++, ref.length);
    view.setUint8(offset++, topic.length);
    view.setUint8(offset++, event.length);

    Array.from(join_ref, char => view.setUint8(offset++, char.charCodeAt(0)));
    Array.from(ref, char => view.setUint8(offset++, char.charCodeAt(0)));
    Array.from(topic, char => view.setUint8(offset++, char.charCodeAt(0)));
    Array.from(event, char => view.setUint8(offset++, char.charCodeAt(0)));

    let combined = new Uint8Array(header.byteLength + payload.byteLength);
    combined.set(new Uint8Array(header), 0);
    combined.set(new Uint8Array(payload), header.byteLength);

    return combined.buffer;
  }

  private static binaryDecode(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    const kind = view.getUint8(0);
    const decoder = new TextDecoder();
    switch (kind) {
      case MESSAGE_KIND.push:
        return this.decodePush(buffer, view, decoder);
      case MESSAGE_KIND.reply:
        return this.decodeReply(buffer, view, decoder);
      case MESSAGE_KIND.broadcast:
        return this.decodeBroadcast(buffer, view, decoder);
      default:
        return '' as never;
    }
  }

  private static decodePush(buffer: ArrayBuffer, view: DataView, decoder: TextDecoder): PushSocketMessage<ArrayBuffer> {
    const idSize = view.getUint8(1);
    const topicSize = view.getUint8(2);
    const eventSize = view.getUint8(3);

    let offset = HEADER_LENGTH + META_LENGTH - 1; // pushes have no ref

    const join_ref = decoder.decode(buffer.slice(offset, offset + idSize));
    offset = offset + idSize;
    const topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    const event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;
    const payload = buffer.slice(offset, buffer.byteLength);

    return { join_ref, topic, event, payload };
  }

  private static decodeReply(
    buffer: ArrayBuffer,
    view: DataView,
    decoder: TextDecoder
  ): ReplySocketMessage<ArrayBuffer> {
    const idSize = view.getUint8(1);
    const seqSize = view.getUint8(2);
    const topicSize = view.getUint8(3);
    const eventSize = view.getUint8(4);
    let offset = HEADER_LENGTH + META_LENGTH;

    const join_ref = decoder.decode(buffer.slice(offset, offset + idSize));
    offset = offset + idSize;
    const ref = decoder.decode(buffer.slice(offset, offset + seqSize));
    offset = offset + seqSize;
    const topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    const event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;

    const data = buffer.slice(offset, buffer.byteLength);

    return { join_ref, ref, topic, event: 'phx_reply', payload: { status: event, response: data } };
  }

  private static decodeBroadcast(
    buffer: ArrayBuffer,
    view: DataView,
    decoder: TextDecoder
  ): BroadcastSocketMessage<ArrayBuffer> {
    const topicSize = view.getUint8(1);
    const eventSize = view.getUint8(2);
    let offset = HEADER_LENGTH + 2;
    const topic = decoder.decode(buffer.slice(offset, offset + topicSize));
    offset = offset + topicSize;
    const event = decoder.decode(buffer.slice(offset, offset + eventSize));
    offset = offset + eventSize;
    const payload = buffer.slice(offset, buffer.byteLength);

    return { topic, event, payload };
  }
}
