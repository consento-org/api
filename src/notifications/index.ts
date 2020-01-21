import { ISender, IReceiver, IEncodable, IEncryptedMessage, cancelable, ICancelable } from '@consento/crypto'
import { INotifications, INotificationsTransport, INotificationsOptions, IConnection, INotificationProcessor, INotification, ISuccessNotification, INotificationError, IBodyFilter } from './types'

export function isSuccess (input: INotification): input is ISuccessNotification {
  return input.type === 'success'
}

export function isError (input: INotification): input is INotificationError {
  return input.type === 'error'
}

const wait: (time: number) => Promise<void> = async (time: number) => new Promise<void>(resolve => setTimeout(resolve, time))

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
  return promise
}

async function mapRequestList <Input, Output> (inputData: Input[], op: (inputData: Input[]) => Promise<Output[]>): Promise<Map<Input, Output>> {
  if (!Array.isArray(inputData)) {
    throw new Error('Expected input to be list')
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

export class Notifications implements INotifications {
  _transport: INotificationsTransport
  _receivers: { [receiverIdBase64: string]: IReceiver }

  processors: Set<INotificationProcessor>

  constructor ({ transport }: INotificationsOptions) {
    this._transport = transport
    this._receivers = {}
    this.processors = new Set()

    const getMessage = async (channelIdBase64: string, encryptedMessage: IEncryptedMessage): Promise<INotification> => {
      const receiver = this._receivers[channelIdBase64]
      if (receiver === undefined) {
        return {
          type: 'error',
          code: 'unexpected-receiver',
          channelIdBase64
        }
      }
      const decryption = await receiver.decrypt(encryptedMessage)
      if (decryption.error !== undefined) {
        return {
          type: 'error',
          code: decryption.error,
          channelIdBase64
        }
      }
      return {
        type: 'success',
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
        type: 'error',
        code: 'transport-error',
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
            type: 'error',
            code: 'decryption-failed',
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
      const received: Map<IReceiver, boolean> = yield mapRequestList(
        receivers,
        async receivers => maybeChild(child, this._transport.reset(receivers))
      )
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

      const received: Map<IReceiver, boolean> = yield mapRequestList(
        force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] === undefined),
        async receiversToRequest => maybeChild(child, this._transport.subscribe(receiversToRequest))
      )

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

      const received: Map<IReceiver, boolean> = yield mapRequestList(
        force ? receivers : receivers.filter(receiver => this._receivers[receiver.idBase64] !== undefined),
        async receiversToRequest => maybeChild(child, this._transport.unsubscribe(receiversToRequest))
      )

      return receivers.map(receiver => {
        const changed = received.get(receiver) || false
        if (changed) {
          delete this._receivers[receiver.idBase64]
        }
        return changed
      })
    }, this)
  }

  async send (sender: ISender, message: IEncodable): Promise<string[]> {
    return this._transport.send(sender.newAnnonymous(), await sender.encrypt(message))
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
