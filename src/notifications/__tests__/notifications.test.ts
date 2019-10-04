import { setup, IAnnonymous, IReceiver, IEncryptedMessage } from '@consento/crypto'
import { EventEmitter } from 'events'
import { ICryptoCore } from '@consento/crypto/core/types'
import { cores } from '@consento/crypto/core/cores'
import { Notifications } from '../index'
import { INotificationsTransport } from '../types'

function emitter (proto: any): EventEmitter {
  const emitter = (new EventEmitter()) as any
  for (const name in proto) {
    emitter[name] = proto[name]
  }
  return emitter
}

cores.forEach(({ name, crypto }: { name: string, crypto: ICryptoCore }) => {
  const { Sender } = setup(crypto)
  describe(`${name} - Notification Cryptography`, () => {
    it('sending okay', async () => {
      const sender = Sender.create()
      const receiver = sender.newReceiver()
      const message = 'Hello World'
      const rnd = Math.random()
      const transport = emitter({
        async send (receivedChannel: IAnnonymous, encrypted: IEncryptedMessage) {
          expect(await receivedChannel.equals(sender)).toBe(true)
          expect(await receiver.decrypt(encrypted))
            .toEqual({
              body: message
            })
          return rnd
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      n.on('error', fail)
      expect(await n.send(sender, 'Hello World')).toBe(rnd)
    })

    it('processing okay', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const transport = emitter({
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        subscribe () {
          return Promise.resolve(true)
        }
      }) as INotificationsTransport
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
      transport.emit('message', idBase64, await sender.encrypt(sent))
    })

    it('ingoring never-subscribed notifications', async () => {
      const sender = Sender.create()
      const transport = emitter({}) as INotificationsTransport
      const idBase64 = await sender.idBase64()
      const n = new Notifications({ transport })
      n.on('error', error => {
        expect(error).toEqual({
          error: 'unexpected-receiver',
          receiverIdBase64: idBase64
        })
      })
      transport.emit('message', idBase64, await sender.encrypt('Hello'))
      await new Promise(resolve => {
        n.addHandler((receiver: IReceiver, message) => {
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
      const transport = emitter({
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe () {
          return true
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver) {
          expect(receivers).toEqual([receiver])
          return true
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      n.on('error', (error) => {
        expect(error).toEqual({
          error: 'unexpected-receiver',
          receiverIdBase64: idBase64
        })
      })
      await n.subscribe([receiver])
      await n.unsubscribe([receiver])
      transport.emit('message', idBase64, await sender.encrypt(sent))
      await new Promise((resolve, reject) => {
        n.addHandler((receivedReceiver: IReceiver, message: string) => {
          (async () => {
            throw new Error(`Unexpected message ${await receivedReceiver.toString()} => ${message}`)
          })().catch(reject)
        })
        setTimeout(resolve, 10)
      })
    })
  })
})
