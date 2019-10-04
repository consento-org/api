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
notifications.on('message', (receiver: IReceiver, message) => {
  // Handle the message result.
})
```

Of course it is possible to unsubscribe from receiving messages:

```javascript
notifications.unsubscribe(receiver)
```

## License

[MIT](./LICENSE)
