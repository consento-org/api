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
  message (receiverIdBase64: string, encryptedMessage: IEncryptedMessage): Promise<boolean | INotificationContentInput | null | undefined>
  reset (): Promise<void>
}

export type INewNotificationsTransport <TTransport extends INotificationsTransport = INotificationsTransport> = (control: INotificationControl) => TTransport

export interface INotificationsOptions <TTransport extends INotificationsTransport = INotificationsTransport> {
  transport: INewNotificationsTransport<TTransport>
  error?: (error: Error) => void
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

export type IAndroidNotificationPriority = 'min' | 'low' | 'default' | 'high' | 'max'

export interface INotificationContentInput {
  // Fields corresponding to NotificationContent
  title?: string
  subtitle?: string
  body?: string
  data?: { [key: string]: unknown }
  badge?: number
  sound?: boolean | string

  // Android-specific fields
  // See https://developer.android.com/reference/android/app/Notification.html#fields
  // for more information on specific fields.
  vibrate?: number[]
  priority?: IAndroidNotificationPriority
  // Format: '#AARRGGBB', '#RRGGBB' or one of the named colors,
  // see https://developer.android.com/reference/kotlin/android/graphics/Color?hl=en
  color?: string
  // If set to false, the notification will not be automatically dismissed when clicked.
  // The setting used when the value is not provided or is invalid is true (the notification
  // will be dismissed automatically). Corresponds directly to Android's `setAutoCancel`
  // behavior. In Firebase terms this property of a notification is called `sticky`.
  // See:
  // - https://developer.android.com/reference/android/app/Notification.Builder#setAutoCancel(boolean),
  // - https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#AndroidNotification.FIELDS.sticky
  autoDismiss?: boolean
  // If set to true, the notification cannot be dismissed by swipe. This setting defaults
  // to false if not provided or is invalid. Corresponds directly do Android's `isOngoing` behavior.
  // See: https://developer.android.com/reference/android/app/Notification.Builder#setOngoing(boolean)
  sticky?: boolean

  // iOS-specific fields
  // See https://developer.apple.com/documentation/usernotifications/unmutablenotificationcontent?language=objc
  // for more information on specific fields.
  launchImageName?: string
  attachments?: Array<{
    url: string
    identifier?: string
    typeHint?: string
    hideThumbnail?: boolean
    thumbnailClipArea?: { x: number, y: number, width: number, height: number }
    thumbnailTime?: number
  }>
}

export type INotification <T extends IEncodable = IEncodable> = INotificationError | ISuccessNotification<T>
export type INotificationProcessor = (message: INotification) => Promise<boolean | INotificationContentInput>
export type IBodyFilter <T extends IEncodable> = (body: IEncodable) => body is T

export interface IConnection {
  sender: ISender
  receiver: IReceiver
}

export interface INotifications<TTransport extends INotificationsTransport = INotificationsTransport> {
  readonly transport: TTransport
  subscribe (receivers: IReceiver[], opts?: ISubscribeOptions): Promise<boolean[]>
  unsubscribe (receivers: IReceiver[], opts?: ISubscribeOptions): Promise<boolean[]>
  reset (receivers: IReceiver[], opts?: ITimeoutOptions): Promise<boolean[]>
  processors: Set<INotificationProcessor>
  send (sender: ISender, message: IEncodable, opts?: ITimeoutOptions): Promise<string[]>
  receive <T extends IEncodable>(receiver: IReceiver, opts?: IReceiveOptions<T>): Promise<{ afterSubscribe: Promise<T> }>
  sendAndReceive <T extends IEncodable>(connection: IConnection, message: IEncodable, opts?: IReceiveOptions<T>): Promise<{ afterSubscribe: Promise<T> }>
}
