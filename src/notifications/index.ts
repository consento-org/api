import { ISender, IReceiver, IEncodable, IEncryptedMessage } from '@consento/crypto'
import { INotifications, INotificationsTransport, INotificationsOptions, INotificationProcessor, INotification, ISuccessNotification, INotificationError } from './types'

export function isSuccess (input: INotification): input is ISuccessNotification {
  return input.type === 'success'
}

export function isError (input: INotification): input is INotificationError {
  return input.type === 'error'
}

async function final <T> (promise: Promise<T>, beforeReturn: () => PromiseLike<void> | void): Promise<T> {
  return promise.then(
    async (data: T) => {
      await beforeReturn()
      return data
    },
    async (error) => {
      await beforeReturn()
      throw error
    })
}

export class Notifications implements INotifications {
  _transport: INotificationsTransport
  _receivers: { [receiverIdBase64: string]: IReceiver }

  processors: Set<INotificationProcessor>

  handle: (receiverIdBase64: string, encryptedMessage: IEncryptedMessage) => void

  constructor ({ transport }: INotificationsOptions) {
    this._transport = transport
    this._receivers = {}
    this.processors = new Set()

    const getMessage = async (receiverIdBase64: string, encryptedMessage: IEncryptedMessage): Promise<INotification> => {
      const receiver = this._receivers[receiverIdBase64]
      if (receiver === undefined) {
        return {
          type: 'error',
          code: 'unexpected-receiver',
          receiverIdBase64
        }
      }
      const decryption = await receiver.decrypt(encryptedMessage)
      if (decryption.error !== undefined) {
        return {
          type: 'error',
          code: decryption.error,
          receiverIdBase64
        }
      }
      return {
        type: 'success',
        body: decryption.body,
        receiver,
        receiverIdBase64
      }
    }
    this.handle = (receiverIdBase64: string, encryptedMessage: IEncryptedMessage) => {
      (async () => {
        const iter = this.processors.values()
        let message: INotification
        try {
          message = await getMessage(receiverIdBase64, encryptedMessage)
        } catch (error) {
          message = {
            type: 'error',
            code: 'decryption-failed',
            error,
            receiverIdBase64
          }
        }

        do {
          const { done, value } = iter.next()
          if (done) {
            return
          }
          try {
            value(message)
          } catch (err) {
            setTimeout(() => {
              console.error(err)
            })
          }
        } while (true)
      })().catch(error => console.log(error))
    }
  }

  async subscribe (receivers: IReceiver[], force: boolean = false): Promise<boolean> {
    if (receivers.length === 0) {
      return false
    }
    const channelsToSubscribe: IReceiver[] = []
    await Promise.all(receivers.map(async (receiver: IReceiver) => {
      const idBase64 = await receiver.idBase64()
      const wasSubscribed = this._receivers[idBase64] !== undefined
      this._receivers[idBase64] = receiver
      if (!wasSubscribed) {
        channelsToSubscribe.push(receiver)
      }
    }))
    if (!force && channelsToSubscribe.length === 0) {
      return false
    }
    await this._transport.subscribe(force ? receivers : channelsToSubscribe)
    return true
  }

  async unsubscribe (receivers: IReceiver[], force: boolean = false): Promise<boolean> {
    const receiversToUnsubscribe: IReceiver[] = []
    await Promise.all(receivers.map(async (receiver: IReceiver) => {
      const idBase64 = await receiver.idBase64()
      const wasSubscribed = this._receivers[idBase64] !== undefined
      delete this._receivers[idBase64]
      if (wasSubscribed) {
        receiversToUnsubscribe.push(receiver)
      }
    }))
    if (!force && receiversToUnsubscribe.length === 0) {
      return false
    }
    await this._transport.unsubscribe(force ? receivers : receiversToUnsubscribe)
    return true
  }

  async send (sender: ISender, message: IEncodable): Promise<string[]> {
    return this._transport.send(sender, await sender.encrypt(message))
  }
}
