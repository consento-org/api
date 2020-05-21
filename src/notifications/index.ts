/* eslint-disable @typescript-eslint/no-throw-literal */
import { ISender, IReceiver, IEncodable, IEncryptedMessage, cancelable, ICancelable } from '@consento/crypto'
import { INotifications, INotificationsTransport, INotificationsOptions, IConnection, INotificationProcessor, EErrorCode, INotification, ISuccessNotification, INotificationError, IBodyFilter, ENotificationType, IDecryptionError } from './types'
import { EventEmitter } from 'events'

export function isSuccess (input: INotification): input is ISuccessNotification {
  return input.type === ENotificationType.success
}

export function isError (input: INotification): input is INotificationError {
  return input.type === ENotificationType.error
}

const wait: (time: number) => Promise<void> = async (time: number) => await new Promise<void>(resolve => setTimeout(resolve, time))

async function untilTrue (op: () => boolean): Promise<void> {
  while (!op()) {
    await wait(0)
  }
}

// TODO: move to @consento/crypto
function isCancelable <T> (promise: Promise<T>): promise is ICancelable<T> {
  // @ts-ignore TS2339
  return typeof promise.cancel === 'function'
}

// TODO: move to @consento/crypto
async function maybeChild <T> (child: <TChild>(cancelable: ICancelable<TChild>) => ICancelable<TChild>, promise: Promise<T>): Promise<T> {
  if (isCancelable(promise)) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    child(promise)
  }
  return await promise
}

async function mapOutputToInput <Input, Output> ({ input: inputData, op }: { input: Input[], op: (inputData: Input[]) => Promise<Output[]> }): Promise<Map<Input, Output>> {
  if (!Array.isArray(inputData)) {
    throw new Error(`Expected input to be list but was ${typeof inputData}`)
  }
  const outputData = await op(inputData)
  if (!Array.isArray(outputData)) {
    throw new Error(`Expected list response from ${op.toString()}`)
  }
  const received = new Map <Input, Output>()
  for (let i = 0; i < inputData.length; i++) {
    const inputEntry = inputData[i]
    const outputEntry = outputData[i]
    received.set(inputEntry, outputEntry)
  }
  return received
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

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  reset (receivers: IReceiver[]): ICancelable<boolean[]> {
    return cancelable <boolean[], Notifications>(function * (child) {
      const received: Map<IReceiver, boolean> = yield mapOutputToInput({
        input: receivers,
        op: async input => await maybeChild(child, this._transport.reset(input))
      })
      this._receivers = {}
      return receivers.map(receiver => {
        const changed = received.get(receiver)
        if (changed) {
          this._receivers[receiver.idBase64] = receiver
        }
        return changed
      })
    }, this)
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  subscribe (receivers: IReceiver[], force: boolean = false): ICancelable<boolean[]> {
    return cancelable <boolean[], Notifications>(function * (child) {
      if (receivers.length === 0) {
        return []
      }

      const received: Map<IReceiver, boolean> = yield mapOutputToInput({
        input: force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] === undefined),
        op: async input => await maybeChild(child, this._transport.subscribe(input))
      })

      return receivers.map(receiver => {
        const changed = received.get(receiver) || false
        if (changed) {
          this._receivers[receiver.idBase64] = receiver
        }
        return changed
      })
    }, this)
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  unsubscribe (receivers: IReceiver[], force: boolean = false): ICancelable<boolean[]> {
    return cancelable <boolean[], Notifications>(function * (child) {
      if (receivers.length === 0) {
        return []
      }

      const received: Map<IReceiver, boolean> = yield mapOutputToInput({
        input: force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] !== undefined),
        op: async input => await maybeChild(child, this._transport.unsubscribe(input))
      })

      return receivers.map(receiver => {
        const changed = received.get(receiver) || false
        if (changed) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete this._receivers[receiver.idBase64]
        }
        return changed
      })
    }, this)
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

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  receive <T extends IEncodable> (receiver: IReceiver, filter?: IBodyFilter<T>, timeout?: number): ICancelable<{ afterSubscribe: ICancelable<T> }> {
    let _resolve: (t: T) => any
    let _reject: (error: Error) => void
    let timer: any
    const promise = new Promise<T>((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })
    if (timeout !== undefined && timeout !== null) {
      timer = setTimeout(() => _reject(Object.assign(new Error(`Not received within ${timeout} milliseconds`), { code: 'timeout', timeout })), timeout)
    }
    const processor = (message: INotification): void => {
      if (isSuccess(message) && message.channelIdBase64 === receiver.idBase64) {
        const body = message.body
        if (typeof filter !== 'function' || filter(body)) {
          _resolve(body as T)
        }
      }
    }
    this.processors.add(processor)
    const clear = async (): Promise<void> => {
      this.processors.delete(processor)
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      await this.unsubscribe([receiver])
    }
    // eslint-disable-next-line @typescript-eslint/return-await
    return cancelable<{ afterSubscribe: ICancelable<T> }, Notifications>(function * (child) {
      yield child(this.subscribe([receiver]))
      return {
        afterSubscribe: cancelable<{ afterSubscribe: ICancelable }>(function * () {
          return (yield promise) as T
        }).finally(clear)
      }
    }, this)
      .catch(async (err: Error): Promise<{ afterSubscribe: ICancelable<T> }> => {
        await clear()
        throw err
      })
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  sendAndReceive <T extends IEncodable = IEncodable> (
    connection: IConnection,
    message: IEncodable,
    filter?: IBodyFilter<T>,
    timeout?: number
  ): ICancelable<{ afterSubscribe: ICancelable<T> }> {
    let _continue = false
    return cancelable<{ afterSubscribe: ICancelable<T> }, Notifications>(function * (child) {
      const { afterSubscribe: receivePromise } = (yield child(this.receive(connection.receiver, filter, timeout))) as { afterSubscribe: ICancelable<T> }
      const next = cancelable(function * (child) {
        // @ts-ignore TS2339
        receivePromise.name = 'RECEIVED'
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        child(receivePromise)
        // wait for another instance to be able to receive "afterSubscribe"
        // before the submission happens
        yield untilTrue(() => _continue)
        yield this.send(connection.sender, message)
        return yield receivePromise
      }, this)
      return {
        afterSubscribe: next
      }
    }, this).finally(() => {
      _continue = true
    })
  }
}
