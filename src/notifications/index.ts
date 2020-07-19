/* eslint-disable @typescript-eslint/method-signature-style */
/* eslint-disable @typescript-eslint/no-throw-literal */
import { ISender, IReceiver, IEncodable, IEncryptedMessage, AbortError } from '@consento/crypto'
import { INotifications, INotificationsTransport, INotificationsOptions, IConnection, INotificationProcessor, EErrorCode, INotification, ISuccessNotification, INotificationError, IBodyFilter, ENotificationType, IDecryptionError } from './types'
import { EventEmitter } from 'events'
import { mapOutputToInput } from './mapOutputToInput'

export function isSuccess (input: INotification): input is ISuccessNotification {
  return input.type === ENotificationType.success
}

export function isError (input: INotification): input is INotificationError {
  return input.type === ENotificationType.error
}

class EmptyTransport extends EventEmitter implements INotificationsTransport {
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

type Callback<T> = (error: Error, t: T) => any

function interceptCallback <T> (callback: Callback<T>, setup: () => () => any): Callback<T> {
  const tearDown = setup()
  return (error: Error, t: T) => {
    const p = tearDown()
    if (p instanceof Promise) {
      p.then(
        () => callback(error, t),
        err => callback(error ?? err, t)
      )
    } else {
      callback(error, t)
    }
  }
}

function toCallback <T> (resolve: (data: T) => any, reject: (error: Error) => any): Callback<T> {
  return (error: Error, t: T) =>
    (error !== null && error !== undefined) ? reject(error) : resolve(t)
}

export class Notifications implements INotifications {
  _transport: INotificationsTransport
  _receivers: { [receiverIdBase64: string]: IReceiver }

  processors: Set<INotificationProcessor>

  constructor ({ transport }: INotificationsOptions) {
    if (transport === null || transport === undefined) {
      console.warn('Warning: Transport is missing for consento API, notifications will not work.')
      transport = new EmptyTransport()
    }
    this._transport = transport
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
    transport.on('error', (error: Error): void => {
      send({
        type: ENotificationType.error,
        code: EErrorCode.transportError,
        error
      })
    })
    transport.on('message', (channelIdBase64: string, encryptedMessage: IEncryptedMessage) => {
      (async () => {
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
      })().catch(error => console.log(error))
    })
  }

  async reset (receivers: IReceiver[], opts?: { signal?: AbortSignal }): Promise<boolean[]> {
    const received: Map<IReceiver, boolean> = await mapOutputToInput({
      input: receivers,
      op: async input => await this._transport.reset(input, opts)
    })
    this._receivers = {}
    return receivers.map(receiver => {
      const changed = received.get(receiver)
      if (changed) {
        this._receivers[receiver.idBase64] = receiver
      }
      return changed
    })
  }

  async subscribe (receivers: IReceiver[], { force, signal }: { force?: boolean, signal?: AbortSignal } = {}): Promise<boolean[]> {
    if (receivers.length === 0) {
      return []
    }

    const received: Map<IReceiver, boolean> = await mapOutputToInput({
      input: force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] === undefined),
      op: async input => await this._transport.subscribe(input, { signal })
    })

    return receivers.map(receiver => {
      const changed = received.get(receiver) || false
      if (changed) {
        this._receivers[receiver.idBase64] = receiver
      }
      return changed
    })
  }

  async unsubscribe (receivers: IReceiver[], { force, signal }: { force: boolean, signal?: AbortSignal } = { force: false }): Promise<boolean[]> {
    if (receivers.length === 0) {
      return []
    }

    const received: Map<IReceiver, boolean> = await mapOutputToInput({
      input: force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] !== undefined),
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
  }

  async send (sender: ISender, message: IEncodable): Promise<string[]> {
    const tickets = await this._transport.send(sender.annonymous, await sender.encrypt(message))
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
  }

  async receive <T extends IEncodable> (receiver: IReceiver, { filter, timeout, signal }: { filter?: IBodyFilter<T>, timeout?: number, signal?: AbortSignal } = {}): Promise<{ afterSubscribe: Promise<T> }> {
    let _cb: Callback<T>
    const processor = (message: INotification): void => {
      if (isSuccess(message) && message.channelIdBase64 === receiver.idBase64) {
        const body = message.body
        if (typeof filter !== 'function' || filter(body)) {
          _cb(null, body as T)
        }
      }
    }
    const afterSubscribe = new Promise<T>((resolve, reject) => {
      _cb = toCallback(resolve, reject)
    })
    this.processors.add(processor)
    _cb = interceptCallback(_cb, () => {
      return async (): Promise<void> => {
        this.processors.delete(processor)
        await this.unsubscribe([receiver])
      }
    })
    try {
      await this.subscribe([receiver], { signal })
      if (timeout !== undefined && timeout !== null) {
        _cb = interceptCallback(_cb, () => {
          const timer = setTimeout(
            () => _cb(Object.assign(new Error(`Not received within ${timeout} milliseconds`), { code: 'timeout', timeout }), null),
            timeout
          )
          return () => clearTimeout(timer)
        })
      }
      if (signal !== undefined && signal !== null) {
        _cb = interceptCallback(_cb, () => {
          const listener = (): void => _cb(new AbortError(), null)
          signal.addEventListener('abort', listener)
          return () => signal.removeEventListener('abort', listener)
        })
      }
    } catch (err) {
      _cb(err, null)
    }
    return {
      afterSubscribe
    }
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  async sendAndReceive <T extends IEncodable = IEncodable> (
    connection: IConnection,
    message: IEncodable,
    opts?: {
      filter?: IBodyFilter<T>
      timeout?: number
      signal?: AbortSignal
    }
  ): Promise<{ afterSubscribe: Promise<T> }> {
    const { afterSubscribe: receivePromise } = await this.receive(connection.receiver, opts)
    return {
      afterSubscribe: (async () => {
        await Promise.race([
          this.send(connection.sender, message),
          receivePromise
        ])
        return await receivePromise
      })()
    }
  }
}
