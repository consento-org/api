import { setup, IAnnonymous, IReceiver, IEncryptedMessage } from '@consento/crypto'
import { ICryptoCore } from '@consento/crypto/core/types'
import { cores } from '@consento/crypto/core/cores'
import { Notifications } from '../index'

const transportStub = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async subscribe (_: IReceiver[]): Promise<boolean> { return false },
  // eslint-disable-next-line @typescript-eslint/require-await
  async unsubscribe (_: IReceiver[]): Promise<boolean> { return false },
  // eslint-disable-next-line @typescript-eslint/require-await
  async send (_: IAnnonymous, __: IEncryptedMessage): Promise<any[]> { return [] }
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
      n.on('error', fail)
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
      n.on('error', fail)
      n.addListener('message', (receivedReceiver: IReceiver, message: string) => {
        (async () => {
          expect(await receiver.equals(receivedReceiver)).toBe(true)
          expect(message).toBe(sent)
        })().catch(fail)
      })
      const receiver = sender.newReceiver()
      await n.subscribe([receiver])
      n.handle(idBase64, await sender.encrypt(sent))
    })

    it('ingoring never-subscribed notifications', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const n = new Notifications({ transport: transportStub })
      n.on('error', error => {
        expect(error).toEqual({
          error: 'unexpected-receiver',
          receiverIdBase64: idBase64
        })
      })
      n.handle(idBase64, await sender.encrypt('Hello'))
      await new Promise(resolve => {
        n.on('message', (receiver: IReceiver, message) => {
          (async () => {
            throw new Error(`Unexpected message ${await receiver.idBase64()} => ${message}`)
          })().catch(fail)
        })
        setTimeout(resolve, 10)
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
      n.on('error', (error) => {
        expect(error).toEqual({
          error: 'unexpected-receiver',
          receiverIdBase64: idBase64
        })
      })
      await n.subscribe([receiver])
      await n.unsubscribe([receiver])
      n.handle(idBase64, await sender.encrypt(sent))
    })
  })
})
