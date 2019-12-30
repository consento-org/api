import { ICryptoCore } from '@consento/crypto/core/types'
import { IConsentoCrypto } from '@consento/crypto'
import { INotifications, INotificationsTransport } from './notifications/types'

export * from '@consento/crypto/types'
export * from './notifications/types'

export interface IAPIOptions {
  cryptoCore: ICryptoCore
  notificationTransport: INotificationsTransport
}

export interface IAPI {
  crypto: IConsentoCrypto
  notifications: INotifications
}
