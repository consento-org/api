import { setup } from '@consento/crypto'
import { IAPI, IAPIOptions } from './types'
import { Notifications } from './notifications'

export * from '@consento/crypto'
export * from './notifications/types'
export * from './types'

export function api ({ cryptoCore, notificationTransport }: IAPIOptions): IAPI {
  const crypto = setup(cryptoCore)
  return {
    notifications: new Notifications({
      transport: notificationTransport
    }),
    crypto
  }
}
