const DEFAULT_BATCH_SIZE = 1

export async function processBatch(
  auditRunId: string
): Promise<{ processed: number; rateLimited: boolean; error?: string }> {

  const auditRun = await getAuditRun(auditRunId)

  if (!auditRun) {
    return { processed: 0, rateLimited: false, error: 'Audit run not found' }
  }

  if (auditRun.status === 'completed' || auditRun.status === 'failed') {
    return {
      processed: 0,
      rateLimited: false,
      error: `Audit run is ${auditRun.status}`,
    }
  }
  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - auditRun.time_window_days)

  const matterIds: string[] = Array.isArray(auditRun.matter_ids_to_process)
    ? auditRun.matter_ids_to_process
    : JSON.parse((auditRun.matter_ids_to_process as unknown as string) || '[]')

  const startIdx = auditRun.processed_matters
  const endIdx = Math.min(startIdx + auditRun.batch_size, matterIds.length)
  const batchMatterIds = matterIds.slice(startIdx, endIdx)

  if (batchMatterIds.length === 0) {
    await updateAuditRun(auditRunId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      processed_matters: matterIds.length,
    })

    return { processed: 0, rateLimited: false }
  }

  await updateAuditRun(auditRunId, { status: 'in_progress' })

  let processedCount = 0

  for (const matterId of batchMatterIds) {
    try {
      await auditMatter(auditRunId, matterId, fromDate, toDate)
    } catch (error) {
      if (error instanceof ClioRateLimitError) {
        await updateAuditRun(auditRunId, {
          status: 'rate_limited',
          rate_limit_reset_at: error.resetAt?.toISOString() || null,
          error_message: 'Clio API rate limit exceeded',
        })

        return { processed: processedCount, rateLimited: true }
      }

      console.error(`[Clio Audit] Skipping matter ${matterId} after error:`, error)
    }

    processedCount++

    await updateAuditRun(auditRunId, {
      processed_matters: startIdx + processedCount,
      last_processed_matter_id: matterId,
      current_batch: auditRun.current_batch + processedCount,
    })
  }

  const newProcessedCount = startIdx + processedCount

  if (newProcessedCount >= matterIds.length) {
    await updateAuditRun(auditRunId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      processed_matters: newProcessedCount,
    })
  }

  return { processed: processedCount, rateLimited: false }
}
