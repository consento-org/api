import { IAPI, IAPIOptions } from './types'
import { Notifications } from './notifications'
import { setup as cryptoSetup } from '@consento/crypto'

export * from './types'
export * from '@consento/crypto/util/cancelable'
export { isSuccess as isSuccessNotification, isError as isErrorNotification } from './notifications'

export function setup ({ cryptoCore, notificationTransport }: IAPIOptions): IAPI {
  return {
    notifications: new Notifications({
      transport: notificationTransport
    }),
    crypto: cryptoSetup(cryptoCore)
  }
}
