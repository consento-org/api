/* eslint-disable @typescript-eslint/method-signature-style */
/* eslint-disable @typescript-eslint/no-throw-literal */
import { IEncodable, wrapTimeout, ITimeoutOptions, cleanupPromise } from '../util'
import { ISender, IReceiver, IEncryptedMessage } from '@consento/crypto'
import { INotifications, INotificationsTransport, INotificationsOptions, IConnection, INotificationProcessor, EErrorCode, INotification, ISuccessNotification, INotificationError, ENotificationType, IDecryptionError, ISubscribeOptions, IReceiveOptions } from './types'
import { mapOutputToInput } from './mapOutputToInput'

export function isSuccess (input: INotification): input is ISuccessNotification {
  return input.type === ENotificationType.success
}

export function isError (input: INotification): input is INotificationError {
  return input.type === ENotificationType.error
}

class EmptyTransport implements INotificationsTransport {
  async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
    return receivers.map(() => false)
  }

  async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
    return receivers.map(() => false)
  }

  async reset (receivers: IReceiver[]): Promise<boolean[]> {
    return receivers.map(() => false)
  }

  async send (): Promise<any[]> {
    throw new Error('Sending of notifications not implemented')
  }
}

export class Notifications implements INotifications {
  _transport: INotificationsTransport
  _receivers: { [receiverIdBase64: string]: IReceiver }

  processors: Set<INotificationProcessor>

  constructor ({ transport }: INotificationsOptions) {
    if (transport === null || transport === undefined) {
      console.warn('Warning: Transport is missing for consento API, notifications will not work.')
      transport = () => new EmptyTransport()
    }
    this._receivers = {}
    this.processors = new Set()

    const getMessage = async (channelIdBase64: string, encryptedMessage: IEncryptedMessage): Promise<INotification> => {
      const receiver = this._receivers[channelIdBase64]
      if (receiver === undefined) {
        return {
          type: ENotificationType.error,
          code: EErrorCode.unexpectedReceiver,
          channelIdBase64
        }
      }
      const decryption = await receiver.decrypt(encryptedMessage)
      if (decryption.error !== undefined) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        return {
          type: ENotificationType.error,
          code: decryption.error,
          receiver,
          channelIdBase64
        } as IDecryptionError
      }
      return {
        type: ENotificationType.success,
        body: decryption.body,
        receiver,
        channelIdBase64
      }
    }
    const send = (message: INotification): void => {
      const iter = this.processors.values()
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
    }
    this._transport = transport({
      error (error: Error): void {
        send({
          type: ENotificationType.error,
          code: EErrorCode.transportError,
          error
        })
      },
      reset: async (): Promise<void> => {
        await this.reset(Object.values(this._receivers))
      },
      async message (channelIdBase64: string, encryptedMessage: IEncryptedMessage): Promise<void> {
        let message: INotification
        try {
          message = await getMessage(channelIdBase64, encryptedMessage)
        } catch (error) {
          message = {
            type: ENotificationType.error,
            code: EErrorCode.decryptionFailed,
            error,
            channelIdBase64
          }
        }
        send(message)
      }
    })
  }

  async reset (receivers: IReceiver[], opts?: ITimeoutOptions): Promise<boolean[]> {
    return await wrapTimeout(async signal => {
      const received: Map<IReceiver, boolean> = await mapOutputToInput({
        input: receivers,
        op: async input => await this._transport.reset(input, { signal })
      })
      this._receivers = {}
      return receivers.map(receiver => {
        const changed = received.get(receiver)
        if (changed) {
          this._receivers[receiver.idBase64] = receiver
        }
        return changed
      })
    }, opts)
  }

  async subscribe (receivers: IReceiver[], opts: ISubscribeOptions = { force: false }): Promise<boolean[]> {
    return await wrapTimeout(async signal => {
      if (receivers.length === 0) {
        return []
      }
      const received: Map<IReceiver, boolean> = await mapOutputToInput({
        input: opts.force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] === undefined),
        op: async input => await this._transport.subscribe(input, { signal })
      })

      return receivers.map(receiver => {
        const changed = received.get(receiver) || false
        if (changed) {
          this._receivers[receiver.idBase64] = receiver
        }
        return changed
      })
    }, opts)
  }

  async unsubscribe (receivers: IReceiver[], opts: ISubscribeOptions = { force: false }): Promise<boolean[]> {
    return await wrapTimeout(async signal => {
      if (receivers.length === 0) {
        return []
      }
      const received: Map<IReceiver, boolean> = await mapOutputToInput({
        input: opts.force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] !== undefined),
        op: async input => await this._transport.unsubscribe(input, { signal })
      })

      return receivers.map(receiver => {
        const changed = received.get(receiver) || false
        if (changed) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete this._receivers[receiver.idBase64]
        }
        return changed
      })
    }, opts)
  }

  async send (sender: ISender, message: IEncodable, opts?: ITimeoutOptions): Promise<string[]> {
    return await wrapTimeout(async signal => {
      const tickets = await this._transport.send(sender.annonymous, await sender.encrypt(message), { signal })
      if (tickets.length === 0) {
        throw Object.assign(new Error('No receiver registered!'), { code: 'no-receivers' })
      }
      let allErrors = true
      for (const ticket of tickets) {
        if (!/^error/.test(ticket)) {
          allErrors = false
          break
        }
      }
      if (allErrors) {
        throw Object.assign(new Error(`Sending failed to all receivers! ${tickets.map(ticket => `"${String(ticket)}"`).join(', ')}`), { tickets, code: 'all-receivers-failed' })
      }
      return tickets
    }, opts)
  }

  async receive <T extends IEncodable> (receiver: IReceiver, opts: IReceiveOptions<T> = {}): Promise<{ afterSubscribe: Promise<T> }> {
    const { filter } = opts
    const received = cleanupPromise<T>(resolve => {
      const processor = (message: INotification): void => {
        if (isSuccess(message) && message.channelIdBase64 === receiver.idBase64) {
          const body = message.body
          if (typeof filter !== 'function' || filter(body)) {
            resolve(body as T)
          }
        }
      }
      this.processors.add(processor)
      return async () => {
        this.processors.delete(processor)
        await this.unsubscribe([receiver])
      }
    }, opts)
    try {
      await this.subscribe([receiver], opts)
    } catch (err) {
      return {
        afterSubscribe: Promise.reject(err)
      }
    }
    return {
      afterSubscribe: received
    }
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  async sendAndReceive <T extends IEncodable = IEncodable> (
    connection: IConnection,
    message: IEncodable,
    opts: IReceiveOptions<T> = {}
  ): Promise<{ afterSubscribe: Promise<T> }> {
    return await wrapTimeout(async signal => {
      const { afterSubscribe: receivePromise } = await this.receive<T>(connection.receiver, { signal })
      return {
        afterSubscribe: (async () => {
          await Promise.race([
            this.send(connection.sender, message, { signal }),
            receivePromise
          ])
          return await receivePromise
        })()
      }
    }, opts)
  }
}
