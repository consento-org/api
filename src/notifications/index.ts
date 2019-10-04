import { ISender, IReceiver, IEncodable } from '@consento/crypto'
import { INotifications, INotificationsTransport, INotificationsOptions, INotificationsHandler } from './types'
import { EventEmitter } from 'events'

export class Notifications<MessageFormat extends IEncodable = IEncodable> extends EventEmitter implements INotifications {
  _transport: INotificationsTransport
  _receivers: { [receiverIdBase64: string]: IReceiver }

  constructor ({ transport }: INotificationsOptions) {
    super()
    this._transport = transport
    transport.addListener('message', (receiverIdBase64: string, encryptedMessage: any) => {
      (async () => {
        const receiver = this._receivers[receiverIdBase64]
        if (receiver === undefined) {
          return this.emit('error', {
            error: 'unexpected-receiver',
            receiverIdBase64
          })
        }
        const result = await receiver.decrypt(encryptedMessage)
        if ('error' in result) {
          return this.emit('error', result)
        }
        try {
          this.emit('message', receiver, result.body)
        } catch (err) {
          this.emit('error', {
            error: 'handler-error',
            stack: err.stack
          })
        }
      })().catch(error => this.emit('error', error))
    })
    this._receivers = {}
  }

  addHandler (handler: INotificationsHandler<MessageFormat>): void {
    this.addListener('message', handler)
  }

  async subscribe (receivers: IReceiver[], force: boolean = false): Promise<boolean> {
    if (receivers.length === 0) {
      return false
    }
    const channelsToSubscribe: IReceiver[] = []
    await Promise.all(receivers.map(async (receiver: IReceiver) => {
      const idBase64 = await receiver.idBase64()
      const wasSubscribed = this._receivers[idBase64] !== undefined
      this._receivers[idBase64] = receiver
      if (!wasSubscribed) {
        channelsToSubscribe.push(receiver)
      }
    }))
    if (!force && channelsToSubscribe.length === 0) {
      return false
    }
    await this._transport.subscribe(force ? receivers : channelsToSubscribe)
    return true
  }

  async unsubscribe (receivers: IReceiver[], force: boolean = false): Promise<boolean> {
    const receiversToUnsubscribe: IReceiver[] = []
    await Promise.all(receivers.map(async (receiver: IReceiver) => {
      const idBase64 = await receiver.idBase64()
      const wasSubscribed = this._receivers[idBase64] !== undefined
      delete this._receivers[idBase64]
      if (wasSubscribed) {
        receiversToUnsubscribe.push(receiver)
      }
    }))
    if (!force && receiversToUnsubscribe.length === 0) {
      return false
    }
    await this._transport.unsubscribe(force ? receivers : receiversToUnsubscribe)
    return true
  }

  async send (sender: ISender, message: IEncodable): Promise<string[]> {
    return this._transport.send(sender, await sender.encrypt(message))
  }
}
