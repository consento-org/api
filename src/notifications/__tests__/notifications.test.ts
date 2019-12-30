import { setup, IAnnonymous, IReceiver, IEncryptedMessage, CancelError } from '@consento/crypto'
import { ICryptoCore } from '@consento/crypto/core/types'
import { cores } from '@consento/crypto/core/cores'
import { Notifications, isError, isSuccess } from '../index'
import { INotificationsTransport, INotification } from '../types'
import { EventEmitter } from 'events'

const transportStub = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async subscribe (input: IReceiver[]): Promise<boolean[]> { return input.map(_ => false) },
  // eslint-disable-next-line @typescript-eslint/require-await
  async unsubscribe (input: IReceiver[]): Promise<boolean[]> { return input.map(_ => false) },
  // eslint-disable-next-line @typescript-eslint/require-await
  async send (_: IAnnonymous, __: IEncryptedMessage): Promise<any[]> { return [] },
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

async function isChannel (receiver: IReceiver, target: IAnnonymous): Promise<boolean> {
  return (await target.idBase64()) === (await receiver.newAnnonymous().idBase64())
}

function mapIsChannel (receiver: IReceiver) {
  return async (target: IAnnonymous): Promise<boolean> => {
    return isChannel(receiver, target)
  }
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
            expect(await receivedChannel.equals(sender.newAnnonymous())).toBe(true)
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
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (input: IReceiver[]): Promise<boolean[]> {
          return input.map(_ => true)
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
      expect(await n.subscribe([receiver])).toEqual([true])
      transport.emit('message', idBase64, await sender.encrypt(sent))
    })

    it('will not subscribe if the subscription didnt work', async () => {
      const senderA = Sender.create()
      const receiverA = senderA.newReceiver()
      const senderB = Sender.create()
      const receiverB = senderA.newReceiver()
      const aTicket = `ATicket${Math.random().toString(32)}`
      const bTicket = `BTicket${Math.random().toString(32)}`
      const transport = Object.assign(new EventEmitter(), {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          return receivers.map(receiver => {
            return receiver === receiverA
          })
        },
        async send (channel: IAnnonymous, encrypted: any): Promise<any[]> {
          transport.emit('message', await channel.idBase64(), encrypted)
          return [await channel.equals(receiverA.newAnnonymous()) ? aTicket : bTicket]
        }
      })
      const n = new Notifications({ transport: transport as INotificationsTransport })
      expect(await n.subscribe([receiverA, receiverB])).toEqual([true, false])
      const receiveA = (await n.receive(receiverA)).afterSubscribe
      try {
        await (await n.receive(receiverB, null, 100)).afterSubscribe
      } catch (error) {
        expect(error.code).toBe('timeout')
      }
      expect(await n.send(senderA, 'hello world')).toEqual([aTicket])
      expect(await n.send(senderB, 'hallo welt')).toEqual([bTicket])
      expect(await receiveA).toBe('hello world')
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
        async subscribe (_: IReceiver[]): Promise<boolean[]> {
          return [true]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          return [true]
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
      const next = (op: string): void => {
        ops.push(op)
      }
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          next('subscribe')
          return [true]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          next('unsubscribe')
          return [true]
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = await channel.idBase64()
          expect(channelId).toBe(await receiver.newAnnonymous().idBase64())
          next('handle')
          this.emit('message', await receiver.idBase64(), message)
          return []
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      // @ts-ignore TS2339
      const { afterSubscribe } = await n.receive(receiver, (input: any): input is string => {
        return input === 'ho'
      })
      await n.send(sender, 'hi')
      await n.send(sender, 'ho')
      const result = await afterSubscribe
      expect(result).toBe('ho')
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'handle', 'handle', 'unsubscribe'])
    })

    it('cancelling the receiving of a message', async () => {
      const sender = Sender.create()
      const receiver = sender.newReceiver()
      const ops = [] as string[]
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          ops.push('subscribe')
          return [true]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          ops.push('unsubscribe')
          return [true]
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = await channel.idBase64()
          expect(channelId).toBe(await receiver.newAnnonymous().idBase64())
          ops.push('handle')
          this.emit('message', await receiver.idBase64(), message)
          return ['abcd', 'efgh']
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      // @ts-ignore TS2339
      const { afterSubscribe } = await n.receive(receiver, (input: any): input is string => input === 'ho')
      try {
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        await afterSubscribe.cancel().then(() => afterSubscribe)
        fail('no error?')
      } catch (err) {
        expect(err.message).toBe('cancelled')
      }
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'unsubscribe'])
    })

    it('only sending and receiving a message', async () => {
      const sender = Sender.create()
      const sender2 = Sender.create()
      const receiver = sender2.newReceiver()
      const ops = [] as string[]

      const next = (str: string): void => {
        ops.push(str)
      }
      const decryptMessageAndSendPong = async (message: IEncryptedMessage): Promise<void> => {
        expect(await sender.decrypt(message)).toEqual({ body: 'ping' })
        next('ping-received-sending-pong')
        await n.send(sender2, 'pong')
      }
      const isSenderChannel = mapIsChannel(sender)
      const isReceiverChannel = mapIsChannel(receiver)
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          next('received-subscription')
          return [true]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          next('received-unsubscription')
          return [true]
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          if (await isSenderChannel(channel)) {
            await decryptMessageAndSendPong(message)
          } else if (await isReceiverChannel(channel)) {
            next('handover-encrypted-message')
            expect(await sender2.decrypt(message)).toEqual({ body: 'pong' })
            this.emit('message', await receiver.idBase64(), message)
          } else {
            fail('Unexpected channel')
          }
          return []
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      // @ts-ignore TS2339
      const { afterSubscribe } = await n.sendAndReceive({ sender, receiver }, 'ping', (input: any): input is string => input === 'pong')
      const result = await afterSubscribe
      expect(result).toBe('pong')
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['received-subscription', 'ping-received-sending-pong', 'handover-encrypted-message', 'received-unsubscription'])
    })

    it('cancelling the sending and receiving a message', async () => {
      const sender = Sender.create()
      const sender2 = Sender.create()
      const receiver = sender2.newReceiver()
      const ops = [] as string[]

      const next = (op: string): void => {
        // console.log(op)
        ops.push(op)
      }

      const isSenderChannel = mapIsChannel(sender)
      const isReceiverChannel = mapIsChannel(receiver)
      const transport: INotificationsTransport = Object.assign(new EventEmitter(), {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          next('received-subscription')
          return [true]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([receiver])
          next('received-unsubscription')
          return [true]
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = await channel.idBase64()
          if (await isSenderChannel(channel)) {
            expect(await sender.decrypt(message)).toEqual({ body: 'ping' })
            next('ping-received-sending-pong')
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            await afterSubscribe.cancel()
            // Cancelling the subscription should finish the test, don't log after this point
            n.send(sender2, 'pong').catch(fail)
          } else if (await isReceiverChannel(channel)) {
            next('handover-encrypted-message')
            expect(channelId).toBe(await receiver.newAnnonymous().idBase64())
            this.emit('message', await receiver.idBase64(), message)
          } else {
            fail('unexpected channel')
          }
          return []
        }
      }) as INotificationsTransport
      const n = new Notifications({ transport })
      // @ts-ignore TS2339
      const { afterSubscribe } = await n.sendAndReceive({ sender, receiver }, 'ping', (input: any): input is string => input === 'pong')
      try {
        await afterSubscribe
        fail('no error?')
      } catch (err) {
        expect(err).toBeInstanceOf(CancelError)
      }
      expect(afterSubscribe.cancelled).toBe(true)
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['received-subscription', 'ping-received-sending-pong', 'received-unsubscription'])
    })
  })
})
