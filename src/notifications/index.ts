/* eslint-disable @typescript-eslint/method-signature-style */
/* eslint-disable @typescript-eslint/no-throw-literal */
import { IEncodable, wrapTimeout, ITimeoutOptions, cleanupPromise, composeAbort } from '../util'
import { ISender, IReceiver, IEncryptedMessage } from '@consento/crypto'
import { INotifications, INotificationsTransport, INotificationsOptions, IConnection, INotificationProcessor, EErrorCode, INotification, ISuccessNotification, INotificationError, ENotificationType, IDecryptionError, ISubscribeOptions, IReceiveOptions, INotificationContentInput } from './types'
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

function isValidTicket (ticket: any): boolean {
  return !/^error/.test(ticket)
}

function errorToConsole (error: Error): void {
  console.error(error)
}

export class Notifications <TTransport extends INotificationsTransport> implements INotifications<TTransport> {
  _transport: TTransport
  _receivers: { [receiverIdBase64: string]: IReceiver }

  processors: Set<INotificationProcessor>

  constructor ({ transport, error }: INotificationsOptions<TTransport>) {
    error = error ?? errorToConsole
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
    const process = async (message: INotification): Promise<boolean | INotificationContentInput> => {
      for (const processor of this.processors) {
        const processResult = await processor(message)
        if (processResult !== false) {
          return processResult
        }
      }
      return false
    }
    this._transport = transport({
      error,
      reset: async (): Promise<void> => {
        await this.reset(Object.values(this._receivers))
      },
      async message (channelIdBase64: string, encryptedMessage: IEncryptedMessage): Promise<boolean | INotificationContentInput> {
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
        return await process(message)
      }
    })
  }

  get transport (): TTransport {
    return this._transport
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
      const hasNoValidTicket = tickets.findIndex(isValidTicket) === -1
      if (hasNoValidTicket) {
        throw Object.assign(new Error(`Sending failed to all receivers! ${tickets.map(ticket => `"${String(ticket)}"`).join(', ')}`), { tickets, code: 'all-receivers-failed' })
      }
      return tickets
    }, opts)
  }

  async receive <T extends IEncodable> (receiver: IReceiver, opts: IReceiveOptions<T> = {}): Promise<{ afterSubscribe: Promise<T> }> {
    const { filter, signal: inputSignal } = opts
    const receiveControl = composeAbort(inputSignal)
    const received = cleanupPromise<T>(resolve => {
      const processor = async (message: INotification): Promise<boolean> => {
        if (isSuccess(message) && message.channelIdBase64 === receiver.idBase64) {
          const body = message.body
          if (typeof filter !== 'function' || filter(body)) {
            resolve(body as T)
            return true
          }
        }
        return false
      }
      this.processors.add(processor)
      return async () => {
        this.processors.delete(processor)
        await this.unsubscribe([receiver])
      }
    }, { ...opts, signal: receiveControl.signal })
    try {
      await this.subscribe([receiver], opts)
    } catch (err) {
      try {
        receiveControl.abort()
        await received
      } catch (_) {}
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
      const receiveControl = composeAbort(signal)
      const { afterSubscribe: received } = await this.receive<T>(connection.receiver, { signal: receiveControl.signal })
      return {
        afterSubscribe: (async () => {
          try {
            await Promise.race([
              this.send(connection.sender, message, { signal }),
              received
            ])
          } catch (err) {
            try {
              receiveControl.abort()
              await received
            } catch (_) {}
            throw err
          }
          return await received
        })()
      }
    }, opts)
  }
}
