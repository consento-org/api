import { ICryptoCore } from '@consento/crypto/core/types'
import { IConsentoCrypto } from '@consento/crypto'
import { INotifications, INotificationsTransport, INewNotificationsTransport } from './notifications/types'

export * from './notifications/types'

export interface IAPIOptions<TTransport extends INotificationsTransport = INotificationsTransport> {
  cryptoCore: ICryptoCore
  notificationTransport: INewNotificationsTransport<TTransport>
}

export interface IAPI<TTransport extends INotificationsTransport = INotificationsTransport> {
  crypto: IConsentoCrypto
  notifications: INotifications<TTransport>
}
