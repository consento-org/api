import { ISender, IReceiver, IAnnonymous, IEncodable, IEncryptedMessage } from '@consento/crypto'
import { EventEmitter } from 'events'

export interface INotificationsTransport extends EventEmitter {
  subscribe (receivers: IReceiver[]): PromiseLike<boolean>
  unsubscribe (receivers: IReceiver[]): PromiseLike<boolean>
  send(channel: IAnnonymous, message: IEncryptedMessage): PromiseLike<any[]>
}

export interface INotificationsOptions {
  transport: INotificationsTransport
}

export type INotificationsHandler<MessageFormat extends IEncodable = IEncodable> = (receiver: IReceiver, message: MessageFormat) => void

export interface INotifications<MessageFormat extends IEncodable = IEncodable> {
  addHandler (handler: INotificationsHandler<MessageFormat>): void
  subscribe (receivers: IReceiver[], force?: boolean): PromiseLike<boolean>
  unsubscribe (receivers: IReceiver[], force?: boolean): PromiseLike<boolean>
  send (sender: ISender, message: MessageFormat): PromiseLike<string[]>
}
