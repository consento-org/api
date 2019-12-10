import { setup, IAnnonymous, IReceiver, IEncryptedMessage } from '@consento/crypto'
import { ICryptoCore } from '@consento/crypto/core/types'
import { cores } from '@consento/crypto/core/cores'
import { Notifications, isError, isSuccess } from '../index'
import { INotification } from '../types'

const transportStub = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async subscribe (_: IReceiver[]): Promise<boolean> { return false },
  // eslint-disable-next-line @typescript-eslint/require-await
  async unsubscribe (_: IReceiver[]): Promise<boolean> { return false },
  // eslint-disable-next-line @typescript-eslint/require-await
  async send (_: IAnnonymous, __: IEncryptedMessage): Promise<any[]> { return [] }
}

async function wait (time: number, op: (cb: () => void) => any): Promise<void> {
  let _reject: (error: Error) => void
  let _resolve: () => void
  const timeout = setTimeout(() => _reject(new Error(`Timeout ${time}`)), time)
  op(() => {
    _resolve()
    clearTimeout(timeout)
  })
  return new Promise <void>((resolve, reject) => {
    _resolve = resolve
    _reject = reject
  })
}

cores.forEach(({ name, crypto }: { name: string, crypto: ICryptoCore }) => {
  const { Sender } = setup(crypto)
  describe(`${name} - Notification Cryptography`, () => {
    it('sending okay', async () => {
      const sender = Sender.create()
      const receiver = sender.newReceiver()
      const message = 'Hello World'
      const rnd = Math.random()
      const n = new Notifications({
        transport: {
          ...transportStub,
          async send (receivedChannel: IAnnonymous, encrypted: any): Promise<any[]> {
            expect(await receivedChannel.equals(sender)).toBe(true)
            expect(await receiver.decrypt(encrypted))
              .toEqual({
                body: message
              })
            return [rnd.toString()]
          }
        }
      })
      n.processors.add((message: INotification) => { if (isError(message)) fail(message) })
      expect(await n.send(sender, 'Hello World')).toEqual([
        rnd.toString()
      ])
    })

    it('processing okay', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const transport = {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        async subscribe (_: IReceiver[]): Promise<boolean> {
          return Promise.resolve(true)
        }
      }
      const sent = 'Hello World'
      const n = new Notifications({ transport })
      n.processors.add((message: INotification) => {
        if (isSuccess(message)) {
          (async () => {
            expect((await receiver.idBase64())).toBe(message.receiverIdBase64)
            expect(message.body).toBe(sent)
          })().catch(fail)
        } else {
          fail(message)
        }
      })
      const receiver = sender.newReceiver()
      await n.subscribe([receiver])
      n.handle(idBase64, await sender.encrypt(sent))
    })

    it('ingoring never-subscribed notifications', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const n = new Notifications({ transport: transportStub })
      const msg = await sender.encrypt('Hello World')
      await wait(10, cb => {
        n.processors.add((message: INotification) => {
          if (isError(message)) {
            expect(message).toEqual({
              type: 'error',
              code: 'unexpected-receiver',
              receiverIdBase64: idBase64
            })
            cb()
          } else {
            fail(message)
          }
        })
        n.handle(idBase64, msg)
      })
    })

    it('ignoring unsubscribed notifications', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const sent = 'Hello World'
      const receiver = sender.newReceiver()
      const transport = {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (_: IReceiver[]): Promise<boolean> {
          return true
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          return true
        }
      }
      const n = new Notifications({ transport })
      n.processors.add((message: INotification) => {
        if (isError(message)) {
          expect(message).toEqual({
            type: 'error',
            code: 'unexpected-receiver',
            receiverIdBase64: idBase64
          })
        } else {
          fail(message)
        }
      })
      await n.subscribe([receiver])
      await n.unsubscribe([receiver])
      n.handle(idBase64, await sender.encrypt(sent))
    })
  })
})
