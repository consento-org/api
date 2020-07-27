import { ICryptoCore } from '@consento/crypto/core/types'
import { IConsentoCrypto } from '@consento/crypto'
import { INotifications, INewNotificationsTransport } from './notifications/types'

export * from './notifications/types'

export interface IAPIOptions {
  cryptoCore: ICryptoCore
  notificationTransport: INewNotificationsTransport
}

export interface IAPI {
  crypto: IConsentoCrypto
  notifications: INotifications
}
