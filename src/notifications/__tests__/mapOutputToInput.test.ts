import { mapOutputToInput } from '../mapOutputToInput'

describe('mapping output to Input', () => {
  it('checking', async () => {
    const count = 5
    const data = await mapOutputToInput({
      input: test(),
      op: async input => {
        return (function * () {
          for (const entry of input) {
            yield `x=${entry}`
          }
        })()
      }
    })

    for (let i = 0; i < count; i++) {
      expect(data.get(i)).toBe(`x=${i}`)
    }

    function * test (): Iterable<number> {
      for (let i = 0; i < count; i++) {
        yield i
      }
    }
  })
})
