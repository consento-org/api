/* eslint-disable @typescript-eslint/method-signature-style */
import { EDecryptionError } from '@consento/crypto/core/types'
import { ISender, IReceiver, IAnnonymous, IEncodable, IEncryptedMessage } from '@consento/crypto/types'

export * from '@consento/crypto/types'

export interface INotificationsTransport {
  subscribe (receivers: Iterable<IReceiver>, opts?: { signal?: AbortSignal }): Promise<boolean[]>
  unsubscribe (receivers: Iterable<IReceiver>, opts?: { signal?: AbortSignal }): Promise<boolean[]>
  reset (receivers: Iterable<IReceiver>, opts?: { signal?: AbortSignal }): Promise<boolean[]>
  send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]>
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
  subscribe (receivers: IReceiver[], opts?: { force?: boolean, signal?: AbortSignal }): Promise<boolean[]>
  unsubscribe (receivers: IReceiver[], opts?: { force?: boolean, signal?: AbortSignal }): Promise<boolean[]>
  reset (receivers: IReceiver[]): Promise<boolean[]>
  processors: Set<INotificationProcessor>
  send (sender: ISender, message: IEncodable): Promise<string[]>
  receive <T extends IEncodable>(receiver: IReceiver, opts?: { filter?: IBodyFilter<T>, signal?: AbortSignal }): Promise<{ afterSubscribe: Promise<IEncodable> }>
  sendAndReceive <T extends IEncodable>(connection: IConnection, message: IEncodable, opts?: { filter: IBodyFilter<T>, signal?: AbortSignal }): Promise<{ afterSubscribe: Promise<T> }>
}
