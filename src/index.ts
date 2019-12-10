import { IAPI, IAPIOptions } from './types'
import { Notifications } from './notifications'
import * as crypto from '@consento/crypto'

export { crypto }
export * from '@consento/crypto/types'
export * from './notifications/types'
export * from './types'
export { isSuccess as isSuccessNotification, isError as isErrorNotification } from './notifications'

export function setup ({ cryptoCore, notificationTransport }: IAPIOptions): IAPI {
  return {
    notifications: new Notifications({
      transport: notificationTransport
    }),
    crypto: crypto.setup(cryptoCore)
  }
}
