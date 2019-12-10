import { ISender, IReceiver, IAnnonymous, IEncodable, IEncryptedMessage } from '@consento/crypto'

export interface INotificationsTransport {
  subscribe (receivers: IReceiver[]): Promise<boolean>
  unsubscribe (receivers: IReceiver[]): Promise<boolean>
  send(channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]>
}

export interface INotificationsOptions {
  transport: INotificationsTransport
}

export interface INotificationError {
  type: 'error'
  error?: Error
  code?: string
  receiverIdBase64: string
}

export interface ISuccessNotification {
  type: 'success'
  body: IEncodable
  receiver: IReceiver
  receiverIdBase64: string
}

export type INotification = INotificationError | ISuccessNotification
export type INotificationProcessor = (message: INotification) => void

export interface IReceive<T> {
  promise: Promise<T>
  cancel: () => Promise<void>
}

export interface INotifications {
  handle: (receiverBase64: string, message: IEncryptedMessage) => void
  subscribe (receivers: IReceiver[], force?: boolean): Promise<boolean>
  unsubscribe (receivers: IReceiver[], force?: boolean): Promise<boolean>
  processors: Set<INotificationProcessor>
  send (sender: ISender, message: IEncodable): Promise<string[]>
}
