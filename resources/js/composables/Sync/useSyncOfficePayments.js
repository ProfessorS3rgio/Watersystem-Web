import { serialService } from '../../services/serialService'

export function useSyncOfficePayments() {
  const waitForChunkAck = (chunkIndex, sendLine) => new Promise((resolve, reject) => {
    let timer
    let removeLine = () => {}
    let removeStatus = () => {}
    const finish = (error) => {
      clearTimeout(timer)
      removeLine()
      removeStatus()
      error ? reject(error) : resolve()
    }

    removeLine = serialService.onLine(line => {
      if (line === `ACK|WEB_PAYMENT_CHUNK|${chunkIndex}`) finish()
      else if (line.startsWith('ERR|WEB_PAYMENT')) finish(new Error(`Master rejected an office payment update: ${line}`))
    })
    removeStatus = serialService.onStatus(state => {
      if (!state.isConnected) finish(new Error('Master disconnected before confirming office payment updates. Sync again to retry.'))
    })
    timer = setTimeout(() => finish(new Error('Master did not confirm an office payment update. Sync again to retry.')), 30000)
    Promise.resolve(sendLine()).catch(finish)
  })

  const pushOfficePaymentsToDevice = async payments => {
    if (!Array.isArray(payments) || payments.length === 0) return 0
    const chunks = []
    let current = []
    const commandBytes = (index, chunk) => new TextEncoder().encode(`UPSERT_WEB_PAYMENTS_JSON_CHUNK|${index}|999|${JSON.stringify(chunk)}`).length
    for (const payment of payments) {
      const candidate = [...current, payment]
      if (commandBytes(chunks.length, candidate) > 3500 && current.length > 0) {
        chunks.push(current)
        current = [payment]
        if (commandBytes(chunks.length, current) > 3500) throw new Error('An office payment update is too large to send. Shorten its notes and sync again.')
      } else {
        current = candidate
        if (commandBytes(chunks.length, current) > 3500) throw new Error('An office payment update is too large to send. Shorten its notes and sync again.')
      }
    }
    if (current.length) chunks.push(current)

    for (let index = 0; index < chunks.length; index++) {
      const line = `UPSERT_WEB_PAYMENTS_JSON_CHUNK|${index}|${chunks.length}|${JSON.stringify(chunks[index])}`
      if (new TextEncoder().encode(line).length > 3500) throw new Error('An office payment update is too large to send. Shorten its notes and sync again.')
      let lastError
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await waitForChunkAck(index, () => serialService.sendLine(line))
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 400 * attempt))
        }
      }
      if (lastError) throw new Error(`Could not deliver office payment chunk ${index + 1}/${chunks.length}: ${lastError.message}`)
    }
    return payments.length
  }

  return { pushOfficePaymentsToDevice }
}
