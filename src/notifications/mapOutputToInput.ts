export async function mapOutputToInput <Input, Output> (
  { input: inputData, op }: { input: Iterable<Input>, op: (inputData: Input[]) => Promise<Iterable<Output>> }
): Promise<Map<Input, Output>> {
  if (!(Symbol.iterator in inputData)) {
    throw new Error(`Expected input to be iterable but was ${typeof inputData}`)
  }
  const inputArray = Array.from(inputData)
  const outputData = await op(inputArray)
  if (!(Symbol.iterator in outputData)) {
    throw new Error(`Expected iterable response from ${op.toString()}`)
  }
  const received = new Map <Input, Output>()
  const inputIter = inputArray[Symbol.iterator]()
  const outputIter = outputData[Symbol.iterator]()
  while (true) {
    const inputStep = inputIter.next()
    const outputStep = outputIter.next()
    if (inputStep.done ?? false) {
      break
    }
    if (outputStep.done ?? false) {
      throw new Error('Output finishes earlier than input.')
    } else {
      received.set(inputStep.value, outputStep.value)
    }
  }
  return received
}
