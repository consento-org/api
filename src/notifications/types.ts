import { ISender, IReceiver, IAnnonymous, IEncodable, IEncryptedMessage } from '@consento/crypto'

export interface INotificationsTransport {
  subscribe (receivers: IReceiver[]): PromiseLike<boolean>
  unsubscribe (receivers: IReceiver[]): PromiseLike<boolean>
  send(channel: IAnnonymous, message: IEncryptedMessage): PromiseLike<any[]>
}

export interface INotificationsOptions {
  transport: INotificationsTransport
}

export interface INotifications<MessageFormat extends IEncodable = IEncodable> {
  handle: (receiverBase64: string, message: IEncryptedMessage) => void
  subscribe (receivers: IReceiver[], force?: boolean): PromiseLike<boolean>
  unsubscribe (receivers: IReceiver[], force?: boolean): PromiseLike<boolean>
  send (sender: ISender, message: MessageFormat): PromiseLike<string[]>
}
