import { IAPI, IAPIOptions } from './types'
import { Notifications } from './notifications'
import { setup as cryptoSetup } from '@consento/crypto'
import { INotificationsTransport } from './notifications/types'

export * from './types'
export * from '@consento/crypto'
export { isSuccess as isSuccessNotification, isError as isErrorNotification } from './notifications'

export function setup <TTransport extends INotificationsTransport> ({ cryptoCore, notificationTransport }: IAPIOptions<TTransport>): IAPI<TTransport> {
  return {
    notifications: new Notifications<TTransport>({
      transport: notificationTransport
    }),
    crypto: cryptoSetup(cryptoCore)
  }
}
