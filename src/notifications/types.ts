/* eslint-disable @typescript-eslint/method-signature-style */
import { EDecryptionError, ISender, IReceiver, IAnnonymous, IEncryptedMessage } from '@consento/crypto'
import { IEncodable, ITimeoutOptions, IAbortOptions } from '../util'

export * from '@consento/crypto/types'

export interface INotificationsTransport {
  subscribe (receivers: Iterable<IReceiver>, opts?: IAbortOptions): Promise<boolean[]>
  unsubscribe (receivers: Iterable<IReceiver>, opts?: IAbortOptions): Promise<boolean[]>
  reset (receivers: Iterable<IReceiver>, opts?: IAbortOptions): Promise<boolean[]>
  send (channel: IAnnonymous, message: IEncryptedMessage, opts?: IAbortOptions): Promise<any[]>
}

export interface INotificationControl {
  error (error: Error): void
  message (receiverIdBase64: string, encryptedMessage: IEncryptedMessage): Promise<void>
  reset (): Promise<void>
}

export type INewNotificationsTransport = (control: INotificationControl) => INotificationsTransport

export interface INotificationsOptions {
  transport: INewNotificationsTransport
}

export interface ISubscribeOptions extends ITimeoutOptions {
  force?: boolean
}

export interface IReceiveOptions <T extends IEncodable> extends ITimeoutOptions {
  filter?: IBodyFilter<T>
}

export enum ENotificationType {
  error = 'error',
  success = 'success'
}

export enum EErrorCode {
  unexpectedReceiver = 'unexpected-receiver',
  transportError = 'transport-error',
  decryptionFailed = 'decryption-failed'
}

export type INotificationError = IDecryptionError | IUnexpectedReceiverError | ITransportError | IDecryptionFailedError

export interface IDecryptionError {
  type: ENotificationType.error
  code: EDecryptionError
  receiver: IReceiver
  channelIdBase64: string
}

export interface IUnexpectedReceiverError {
  type: ENotificationType.error
  code: EErrorCode.unexpectedReceiver
  channelIdBase64: string
}

export interface ITransportError {
  type: ENotificationType.error
  code: EErrorCode.transportError
  error: Error
}

export interface IDecryptionFailedError {
  type: ENotificationType.error
  code: EErrorCode.decryptionFailed
  error: Error
  channelIdBase64: string
}

export interface ISuccessNotification<T extends IEncodable = IEncodable> {
  type: 'success'
  body: T
  receiver: IReceiver
  channelIdBase64: string
}

export type INotification <T extends IEncodable = IEncodable> = INotificationError | ISuccessNotification<T>
export type INotificationProcessor = (message: INotification) => void
export type IBodyFilter <T extends IEncodable> = (body: IEncodable) => body is T

export interface IConnection {
  sender: ISender
  receiver: IReceiver
}

export interface INotifications {
  subscribe (receivers: IReceiver[], opts?: ISubscribeOptions): Promise<boolean[]>
  unsubscribe (receivers: IReceiver[], opts?: ISubscribeOptions): Promise<boolean[]>
  reset (receivers: IReceiver[], opts?: ITimeoutOptions): Promise<boolean[]>
  processors: Set<INotificationProcessor>
  send (sender: ISender, message: IEncodable, opts?: ITimeoutOptions): Promise<string[]>
  receive <T extends IEncodable>(receiver: IReceiver, opts?: IReceiveOptions<T>): Promise<{ afterSubscribe: Promise<IEncodable> }>
  sendAndReceive <T extends IEncodable>(connection: IConnection, message: IEncodable, opts?: IReceiveOptions<T>): Promise<{ afterSubscribe: Promise<T> }>
}
