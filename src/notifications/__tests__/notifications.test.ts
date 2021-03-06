import { setup, IAnnonymous, IReceiver, IEncryptedMessage, IConnection } from '@consento/crypto'
import { ICryptoCore } from '@consento/crypto/types'
import { cores } from '@consento/crypto/core/cores'
import { Notifications, isError, isSuccess } from '../index'
import { INotificationsTransport, INotification, INotificationControl, INewNotificationsTransport } from '../types'
import { AbortController, AbortError } from '../../util'

const transportStub: INotificationsTransport = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async subscribe (input: IReceiver[]): Promise<boolean[]> { return input.map(_ => false) },
  // eslint-disable-next-line @typescript-eslint/require-await
  async unsubscribe (input: IReceiver[]): Promise<boolean[]> { return input.map(_ => false) },
  // eslint-disable-next-line @typescript-eslint/require-await
  async send (_: IAnnonymous, __: IEncryptedMessage): Promise<any[]> { return [] },
  // eslint-disable-next-line @typescript-eslint/require-await
  async reset (input: IReceiver[]): Promise<boolean[]> { return input.map(_ => false) }
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

function isChannel (receiver: IReceiver, target: IAnnonymous): boolean {
  return target.idBase64 === receiver.annonymous.idBase64
}

cores.forEach(({ name, crypto }: { name: string, crypto: ICryptoCore }) => {
  const { createReceiver, Connection } = setup(crypto)
  const twoWayConnection = async (): Promise<{ aliceToBob: IConnection, bobToAlice: IConnection }> => {
    const [a, b] = await Promise.all([createReceiver(), createReceiver()])
    return {
      aliceToBob: new Connection({ sender: b.sender, receiver: a.receiver }),
      bobToAlice: new Connection({ sender: a.sender, receiver: b.receiver })
    }
  }
  describe(`${name} - Notification Cryptography`, () => {
    it('sending okay', async () => {
      const { sender, receiver } = await createReceiver()
      const message = 'Hello World'
      const rnd = `ticket${Math.random()}`
      const n = new Notifications({
        transport: () => ({
          ...transportStub,
          async send (receivedChannel: IAnnonymous, encrypted: any): Promise<any[]> {
            expect(receivedChannel.idBase64).toBe(sender.idBase64)
            expect(await receiver.decrypt(encrypted))
              .toEqual({
                body: message
              })
            return [rnd]
          }
        })
      })
      n.processors.add(async (message: INotification) => {
        if (isError(message)) {
          fail(message)
        }
        return false
      })
      expect(await n.send(sender, 'Hello World')).toEqual([
        rnd
      ])
    })

    it('processing okay', async () => {
      const { sender, receiver } = await createReceiver()
      const idBase64 = sender.idBase64
      let control: INotificationControl | undefined
      const transportImpl = {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (input: IReceiver[]): Promise<boolean[]> {
          return input.map(_ => true)
        }
      }
      const transport = (_control: INotificationControl): INotificationsTransport => {
        control = _control
        return transportImpl
      }
      const sent = 'Hello World'
      const n = new Notifications({ transport })
      n.processors.add(async (message: INotification) => {
        if (isSuccess(message)) {
          expect(receiver.idBase64).toBe(message.channelIdBase64)
          expect(message.body).toBe(sent)
        } else {
          fail(message)
        }
        return true
      })
      expect(await n.subscribe([receiver])).toEqual([true])
      await control?.message(idBase64, await sender.encrypt(sent))
    })

    it('a successful reset will clear all subscriptions', async () => {
      const { aliceToBob, bobToAlice } = await twoWayConnection()
      let control: INotificationControl
      const transportImpl = {
        // eslint-disable-next-line @typescript-eslint/require-await
        async send (channel: IAnnonymous, encrypted: any): Promise<any[]> {
          await control.message(channel.idBase64, encrypted)
          return [Math.random().toString()]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (input: IReceiver[]): Promise<boolean[]> {
          expect(input[0]).toBe(aliceToBob.receiver)
          return input.map(_ => true)
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (input: IReceiver[]): Promise<boolean[]> {
          return input.map(_ => true)
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async reset (input: IReceiver[]): Promise<boolean[]> {
          expect(input[0]).toBe(bobToAlice.receiver)
          expect(input.length).toBe(1)
          return input.map(_ => true)
        }
      }
      const transport = (_control: INotificationControl): INotificationsTransport => {
        control = _control
        return transportImpl
      }
      const n = new Notifications({ transport })
      n.processors.add(async notification => {
        if (isSuccess(notification)) {
          expect(notification.receiver.idBase64).toBe(bobToAlice.receiver.idBase64)
          expect(notification.body).toBe('Holla')
          return true
        }
        return false
      })
      await n.subscribe([aliceToBob.receiver])
      await n.reset([bobToAlice.receiver])
      await n.send(bobToAlice.sender, 'Hello')
      await n.send(aliceToBob.sender, 'Holla')
    })

    it('will not subscribe if the subscription didnt work', async () => {
      const { aliceToBob, bobToAlice } = await twoWayConnection()
      const aTicket = `ATicket${Math.random().toString(32)}`
      const bTicket = `BTicket${Math.random().toString(32)}`
      let control: INotificationControl
      const transport: INotificationsTransport = {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          return receivers.map(receiver => {
            return receiver === aliceToBob.receiver
          })
        },
        async send (channel: IAnnonymous, encrypted: any): Promise<any[]> {
          await control.message(channel.idBase64, encrypted)
          return [channel.idBase64 === bobToAlice.sender.idBase64 ? aTicket : bTicket]
        }
      }
      const n = new Notifications({
        transport (_control) {
          control = _control
          return transport
        }
      })
      expect(await n.subscribe([aliceToBob.receiver, bobToAlice.receiver])).toEqual([true, false])
      const receiveA = (await n.receive(aliceToBob.receiver)).afterSubscribe
      try {
        const { afterSubscribe } = await n.receive(bobToAlice.receiver, { timeout: 100 })
        await afterSubscribe
      } catch (error) {
        expect(error.code).toBe('timeout')
      }
      expect(await n.send(bobToAlice.sender, 'hello world')).toEqual([aTicket])
      expect(await n.send(aliceToBob.sender, 'hallo welt')).toEqual([bTicket])
      expect(await receiveA).toBe('hello world')
    })

    it('ingoring never-subscribed notifications', async () => {
      const { sender } = await createReceiver()
      const idBase64 = sender.idBase64
      let control: INotificationControl
      const n = new Notifications({
        transport (_control) {
          control = _control
          return transportStub
        }
      })
      const msg = await sender.encrypt('Hello World')
      await wait(10, cb => {
        n.processors.add(async (message: INotification) => {
          if (isError(message)) {
            expect(message).toEqual({
              type: 'error',
              code: 'unexpected-receiver',
              channelIdBase64: idBase64
            })
            cb()
          } else {
            fail(message)
          }
          return true
        })
        control.message(idBase64, msg)
          .then(
            () => {},
            (error: Error) => fail(error)
          )
      })
    })

    it('sending to no receipient will result in an error', async () => {
      const { sender } = await createReceiver()
      const n = new Notifications({ transport: () => transportStub })
      try {
        await n.send(sender, 'hello')
        fail('error missing')
      } catch (error) {
        expect(error.code).toBe('no-receivers')
      }
    })

    it('sending to a receipient with error response will result in an error', async () => {
      const { sender } = await createReceiver()
      const transport = {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async send (): Promise<any[]> {
          return ['error']
        }
      }
      const n = new Notifications({ transport: () => transport })
      await expect(n.send(sender, 'hello')).rejects.toMatchObject({
        code: 'all-receivers-failed'
      })
    })

    it('sending to a list of receipients with all error response will result in an error', async () => {
      const { sender } = await createReceiver()
      const transport = {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async send (): Promise<any[]> {
          return ['error', 'error:hello', 'error', 'error:ho']
        }
      }
      const n = new Notifications({ transport: () => transport })
      await expect(n.send(sender, 'hello')).rejects.toMatchObject({
        code: 'all-receivers-failed'
      })
    })

    it('sending to a list of receipients with some error response will be successful', async () => {
      const { sender } = await createReceiver()
      const transport = {
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async send (): Promise<any[]> {
          return ['error', 'error:hello', 'hello', 'error:ho']
        }
      }
      const n = new Notifications({ transport: () => transport })
      expect(await n.send(sender, 'hello')).toEqual(['error', 'error:hello', 'hello', 'error:ho'])
    })

    it('ignoring unsubscribed notifications', async () => {
      const { sender, receiver } = await createReceiver()
      const idBase64 = sender.idBase64
      const sent = 'Hello World'
      const transport = {
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
      }
      let control: INotificationControl | undefined
      const n = new Notifications({
        transport (_control) {
          control = _control
          return transport
        }
      })
      n.processors.add(async (message: INotification) => {
        if (isError(message)) {
          expect(message).toEqual({
            type: 'error',
            code: 'unexpected-receiver',
            channelIdBase64: idBase64
          })
        } else {
          fail(message)
        }
        return true
      })
      await n.subscribe([receiver])
      await n.unsubscribe([receiver])
      await control?.message(idBase64, await sender.encrypt(sent))
    })

    it('receiving a certain message', async () => {
      const { sender, receiver } = await createReceiver()
      const ops = [] as string[]
      const next = (op: string): void => {
        ops.push(op)
      }
      const transport: INewNotificationsTransport = (control: INotificationControl) => ({
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
        // eslint-disable-next-line @typescript-eslint/require-await
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          expect(channel.idBase64).toBe(receiver.annonymous.idBase64)
          next('handle')
          await control.message(receiver.idBase64, message)
          return ['ticket']
        }
      })
      const n = new Notifications({ transport })
      const { afterSubscribe } = await n.receive(receiver, {
        filter: (input: any): input is string => {
          return input === 'ho'
        }
      })
      await n.send(sender, 'hi')
      await n.send(sender, 'ho')
      const result = await afterSubscribe
      expect(result).toBe('ho')
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'handle', 'handle', 'unsubscribe'])
    })

    it('cancelling the receiving of a message', async () => {
      const { receiver } = await createReceiver()
      const ops = [] as string[]
      const transport: INewNotificationsTransport = (control: INotificationControl) => ({
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
        // eslint-disable-next-line @typescript-eslint/require-await
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          expect(channel.idBase64).toBe(receiver.annonymous.idBase64)
          ops.push('handle')
          await control.message(receiver.idBase64, message)
          return ['abcd', 'efgh']
        }
      })
      const n = new Notifications({ transport: transport })
      const controller = new AbortController()
      const { afterSubscribe } = await n.receive(receiver, {
        filter: (input: any): input is string => input === 'ho',
        signal: controller.signal
      })
      setTimeout(() => controller.abort(), 0)
      await expect(afterSubscribe).rejects.toEqual(new AbortError())
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['subscribe', 'unsubscribe'])
    })

    it('only sending and receiving a message', async () => {
      const { aliceToBob, bobToAlice } = await twoWayConnection()
      const ops = [] as string[]

      const next = (str: string): void => {
        ops.push(str)
      }
      const decryptMessageAndSendPong = async (message: IEncryptedMessage): Promise<void> => {
        expect(await bobToAlice.receiver.decrypt(message)).toEqual({ body: 'ping' })
        next('ping-received-sending-pong')
        await n.send(bobToAlice.sender, 'pong')
      }
      const transport: INewNotificationsTransport = (control: INotificationControl) => ({
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([aliceToBob.receiver])
          next('received-subscription')
          return [true]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([aliceToBob.receiver])
          next('received-unsubscription')
          return [true]
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          if (isChannel(bobToAlice.receiver, channel)) {
            await decryptMessageAndSendPong(message)
          } else if (isChannel(aliceToBob.receiver, channel)) {
            next('handover-encrypted-message')
            expect(await aliceToBob.receiver.decrypt(message)).toEqual({ body: 'pong' })
            await control.message(aliceToBob.receiver.idBase64, message)
          } else {
            fail('Unexpected channel')
          }
          return ['ticket']
        }
      })
      const n = new Notifications({ transport })
      const { afterSubscribe } = await n.sendAndReceive(aliceToBob, 'ping', {
        filter: (input: any): input is string => input === 'pong'
      })
      const result = await afterSubscribe
      expect(result).toBe('pong')
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['received-subscription', 'ping-received-sending-pong', 'handover-encrypted-message', 'received-unsubscription'])
    })

    it('cancelling the sending and receiving a message', async () => {
      const { aliceToBob, bobToAlice } = await twoWayConnection()
      const ops = [] as string[]

      const next = (op: string): void => {
        ops.push(op)
      }

      const transport: INewNotificationsTransport = (control: INotificationControl) => ({
        ...transportStub,
        // eslint-disable-next-line @typescript-eslint/require-await
        async subscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([aliceToBob.receiver])
          next('received-subscription')
          return [true]
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async unsubscribe (receivers: IReceiver[]): Promise<boolean[]> {
          expect(receivers).toEqual([aliceToBob.receiver])
          next('received-unsubscription')
          return [true]
        },
        async send (channel: IAnnonymous, message: IEncryptedMessage): Promise<any[]> {
          const channelId = channel.idBase64
          if (isChannel(bobToAlice.receiver, channel)) {
            expect(await bobToAlice.receiver.decrypt(message)).toEqual({ body: 'ping' })
            next('ping-received-sending-pong')
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            await afterSubscribe
            // Cancelling the subscription should finish the test, don't log after this point
            n.send(bobToAlice.sender, 'pong').catch(fail)
          } else if (isChannel(aliceToBob.receiver, channel)) {
            next('handover-encrypted-message')
            expect(channelId).toBe(aliceToBob.receiver.idBase64)
            await control.message(aliceToBob.receiver.idBase64, message)
          } else {
            fail('unexpected channel')
          }
          return ['ticket']
        }
      })
      const n = new Notifications({ transport })
      const controller = new AbortController()
      const { afterSubscribe } = await n.sendAndReceive(aliceToBob, 'ping', {
        filter: (input: any): input is string => input === 'pong',
        signal: controller.signal
      })
      setTimeout(() => controller.abort(), 10)
      await expect(afterSubscribe).rejects.toBeInstanceOf(AbortError)
      expect(n.processors.size).toBe(0)
      expect(ops).toEqual(['received-subscription', 'ping-received-sending-pong', 'received-unsubscription'])
    })

    it('allowing for transport to initiate a reset', async () => {
      const { receiver } = await createReceiver()
      let control: INotificationControl | undefined
      let resetCalled = false
      const n = new Notifications({
        transport (_control) {
          control = _control
          return {
            ...transportStub,
            async reset (input: IReceiver[]): Promise<boolean[]> {
              resetCalled = true
              return input.map(_ => true)
            }
          }
        }
      })
      await n.subscribe([receiver])
      await control?.reset()
      expect(resetCalled).toBe(true)
    })
  })
})
