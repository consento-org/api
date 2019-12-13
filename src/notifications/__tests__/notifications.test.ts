import { setup, IAnnonymous, IReceiver, IEncryptedMessage } from '@consento/crypto'
import { ICryptoCore } from '@consento/crypto/core/types'
import { cores } from '@consento/crypto/core/cores'
import { Notifications, isError, isSuccess } from '../index'
import { INotificationsTransport, INotification } from '../types'
import { EventEmitter } from 'events'

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
        transport: Object.assign(new EventEmitter(), {
          ...transportStub,
          async send (receivedChannel: IAnnonymous, encrypted: any): Promise<any[]> {
            expect(await receivedChannel.equals(sender)).toBe(true)
            expect(await receiver.decrypt(encrypted))
              .toEqual({
                body: message
              })
            return [rnd.toString()]
          }
        }) as INotificationsTransport
      })
      n.processors.add((message: INotification) => { if (isError(message)) fail(message) })
      expect(await n.send(sender, 'Hello World')).toEqual([
        rnd.toString()
      ])
    })

    it('processing okay', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const transport = Object.assign(new EventEmitter(), {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        async subscribe (_: IReceiver[]): Promise<boolean> {
          return Promise.resolve(true)
        }
      })
      const sent = 'Hello World'
      const n = new Notifications({ transport: transport as INotificationsTransport })
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
      transport.emit('message', idBase64, await sender.encrypt(sent))
    })

    it('ingoring never-subscribed notifications', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const transport = Object.assign(new EventEmitter(), transportStub)
      const n = new Notifications({ transport: transport as INotificationsTransport })
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
        transport.emit('message', idBase64, msg)
      })
    })

    it('ignoring unsubscribed notifications', async () => {
      const sender = Sender.create()
      const idBase64 = await sender.idBase64()
      const sent = 'Hello World'
      const receiver = sender.newReceiver()
      const transport = Object.assign(new EventEmitter(), {
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
      })
      const n = new Notifications({ transport: transport as INotificationsTransport })
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
      transport.emit('message', idBase64, await sender.encrypt(sent))
    })

    it('receiving a certain message', async () => {
      const sender = Sender.create()
      const receiver = sender.newReceiver()
      const ops = [] as string[]
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        async subscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('subscribe')
          return Promise.resolve(true)
        },
        async unsubscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('unsubscribe')
          return Promise.resolve(true)
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = await channel.idBase64()
          expect(channelId).toBe(await receiver.newAnnonymous().idBase64())
          ops.push('handle')
          this.emit('message', await receiver.idBase64(), message)
          return Promise.resolve([])
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      const { promise } = await n.receive(receiver, (input: any): input is string => input === 'ho')
      await n.send(sender, 'hi')
      await n.send(sender, 'ho')
      const result = await promise
      expect(result).toBe('ho')
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'handle', 'handle', 'unsubscribe'])
    })

    it('cancelling the receiving of a message', async () => {
      const sender = Sender.create()
      const receiver = sender.newReceiver()
      const ops = [] as string[]
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        async subscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('subscribe')
          return Promise.resolve(true)
        },
        async unsubscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('unsubscribe')
          return Promise.resolve(true)
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = await channel.idBase64()
          expect(channelId).toBe(await receiver.newAnnonymous().idBase64())
          ops.push('handle')
          this.emit('message', await receiver.idBase64(), message)
          return Promise.resolve([])
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      const { promise, cancel } = await n.receive(receiver, (input: any): input is string => input === 'ho')
      await cancel()
      try {
        await promise
        fail(new Error('unexpected pass'))
      } catch (err) {
        expect(err.message).toBe('cancelled')
      }
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'unsubscribe'])
    })

    it('sending and receiving a message', async () => {
      const sender = Sender.create()
      const sender2 = Sender.create()
      const receiver = sender2.newReceiver()
      const ops = [] as string[]
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        async subscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('subscribe')
          return Promise.resolve(true)
        },
        async unsubscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('unsubscribe')
          return Promise.resolve(true)
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = await channel.idBase64()
          if (channelId === await sender.newAnnonymous().idBase64()) {
            expect(await sender.decrypt(message)).toEqual({ body: 'ping' })
            ops.push('ping-received')
            await n.send(sender2, 'pong')
            return
          }
          expect(channelId).toBe(await receiver.newAnnonymous().idBase64())
          ops.push('handle')
          this.emit('message', await receiver.idBase64(), message)
          return Promise.resolve([])
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      const { promise } = await n.sendAndReceive({ sender, receiver }, 'ping', (input: any): input is string => input === 'pong')
      const result = await promise
      expect(result).toBe('pong')
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'ping-received', 'handle', 'unsubscribe'])
    })

    it('cancelling the sending and receiving a message', async () => {
      const sender = Sender.create()
      const sender2 = Sender.create()
      const receiver = sender2.newReceiver()
      const ops = [] as string[]
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        async subscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('subscribe')
          return Promise.resolve(true)
        },
        async unsubscribe (receivers: IReceiver[]): Promise<boolean> {
          expect(receivers).toEqual([receiver])
          ops.push('unsubscribe')
          return Promise.resolve(true)
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = await channel.idBase64()
          if (channelId === await sender.newAnnonymous().idBase64()) {
            expect(await sender.decrypt(message)).toEqual({ body: 'ping' })
            ops.push('ping-received')
            await cancel()
            await n.send(sender2, 'pong')
            return
          }
          expect(channelId).toBe(await receiver.newAnnonymous().idBase64())
          ops.push('handle')
          this.emit('message', await receiver.idBase64(), message)
          return Promise.resolve([])
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      const { promise, cancel } = await n.sendAndReceive({ sender, receiver }, 'ping', (input: any): input is string => input === 'pong')
      try {
        await promise
      } catch (err) {
        expect(err.message).toBe('cancelled')
      }
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'ping-received', 'unsubscribe', 'handle'])
    })
  })
})
