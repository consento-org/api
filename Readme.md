# @consento/api

`@consento/api` is the main API for build consento systems.

**Under heavy development.**

## Setup

The consento API has a few configuration points. 

```javascript
const { setup } = require('@consento/api')
const api = setup({
  core: require('@consento/crypto/core/sodium') // or '@consento/crypto/core/friends' depending on environment
  notificationTransport // Implementation of notification transport
})
```

## Crypto

[`@consento/crypto`](https://github.com/consento-org/crypto) is the foundation upon which Consento is built.

The API exposes the crypto primitives through `api.crypto`. e.g.:

```javascript
const { Sender } = api.crypto
```

## Notifications

The Consento API comes with an end-to-end encrypted notification system.

```javascript
const { notifications } = api
```

Any `ISender` instance is able to submit notifications:

```javascript
notifications.send(sender, 'Hello World')
```

For another device/instance to receive the notification, the device needs
to first register the **matching** `IReceiver`

```javascript
notifications.subscribe(sender.newReceiver())
```

All messages are received through a single handler:

```typescript
import { isSuccessNotification, isErrorNotification } from '@consento/api'

notifications.processor.add((message) => {
  // Handle the message result.
  if (isSuccessNotification(message)) {
    message.body // body of the message
    message.receiver // receiver for the message
    message.receiverIdBase64 // base64 for the receiver
  }
  if (isErrorNotification(message)) {
    message.code // code for the error
    message.error // error object (if available)
    message.receiverIdBase64 // id for the receiver
  }
})
```

Of course it is possible to unsubscribe from receiving messages:

```javascript
notifications.unsubscribe(receiver)
```

If the transport receives a method it needs to call

```javascript
notifications.handle(idBase64, encryptedMessage)
```

For simple one-time reading of a request you can also subscribe, receive and
unsubscribe from a channel.

```javascript
const { promise, cancel } = notifications.receive(receiver)

const response = await promise // To receive the next notification
await cancel() // To cancel the receiving of a notification
```

You can also send a message before receiving with the `sendAndReceive` helper:

```javascript
const message = 'Hello World'
const { promise, cancel } = notifications.sendAndReceive({ sender, receiver }, message)
```

In extension it is possible to verify the body message by using a filter:

```typescript
import { IEncodable } from '@consento/api'

const isStringLen32 = (body: IEncodable): body is string => typeof body === 'string' && body.length === 32
const { promise } = notifications.receive(receiver, isStringLen32)

const response: string = await promise // only resolves if a 32 character string has been sent received on the channel
```

... and furthermore it is possible to add a timeout to receiving a message:

```javascript
const { promise } = notifications.receive(receiver, null, 1000)

try {
  const data = await promise
} catch (err) {
  err.code === 'timeout'
  err.timeout === 1000
}
```

_(You can also pass a filter & timeout to `sendAndReceive`)_


## License

[MIT](./LICENSE)
