package com.krishichain.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

/**
 * Mirrors `GET /ops/summary` in apps/gateway/src/index.ts
 */
@Serializable
data class OpsSummaryDto(
    @SerialName("records") val records: Int,
    @SerialName("quarantined") val quarantined: Int,
    @SerialName("batches") val batches: Int,
    @SerialName("pendingLeaves") val pendingLeaves: Int,
    @SerialName("lastRoot") val lastRoot: String,
    @SerialName("incidents") val incidents: Int,
)

/**
 * Stub for per-device health row for a future node table.
 */
data class NodeHealth(
    val address: String,
    val lastSeen: Long,
    val bufferDepth: Int,
    val status: NodeStatus,
)

enum class NodeStatus {
    ONLINE, STALE, OFFLINE
}
