package com.krishichain.app.data.model

import com.krishichain.app.domain.Hex
import kotlinx.serialization.Serializable

/**
 * Wire shapes for `POST /devices`, `POST /ingest` and `POST /companion` — copied from the Zod
 * schemas near the top of `apps/gateway/src/index.ts` (`explodedRecordSchema`, `companionSchema`,
 * `ingestSchema`, `companionIngestSchema`, and the inline `/devices` body schema). These are the
 * "exploded fields" shape PROTOCOL.md §3.2 defines as the sim-node/simulator path — the
 * firmware's own path posts raw canonical bytes instead, which this app doesn't use.
 */

// ---------------------------------------------------------------------------
// POST /devices
// ---------------------------------------------------------------------------

@Serializable
data class DeviceCommissionRequest(
    val address: Hex,
    val role: String? = null,
    val lat: Double? = null,
    val lon: Double? = null,
)

@Serializable
data class DeviceCommissionResponse(
    val registered: Hex? = null,
    val role: String? = null,
)

// ---------------------------------------------------------------------------
// POST /ingest
// ---------------------------------------------------------------------------

/** One record in the "exploded fields" shape. `dev` is not repeated per-record — it's the
 *  batch's top-level `dev` (`IngestRequest.dev`), authoritative per PROTOCOL.md §3.2. */
@Serializable
data class ExplodedRecordDto(
    val seq: Long,
    val prev: Hex,
    /** Decimal string, not a JSON number — `ts` is a uint64 on the wire; a string is safe at
     *  any magnitude even though unix-seconds-now fits in a JS-safe number today. */
    val ts: String,
    val tsq: Int,
    val lot: Hex,
    val t: Int,
    val h: Int,
    val lux: Int,
    val flags: Int,
    val bat: Int,
    val sig: Hex,
)

@Serializable
data class IngestRequest(
    val v: Int = 1,
    val dev: Hex,
    val records: List<ExplodedRecordDto>,
    val role: String = "VIRTUAL",
    val buffered: Int = 0,
)

@Serializable
data class RejectedRecordDto(
    val seq: Long? = null,
    val reason: String? = null,
)

/** A chain-continuity anomaly the gateway noticed on an otherwise-accepted record (`CHAIN_GAP`,
 *  `CHAIN_FORK`, ...) — surfaced to the UI as a warning even though the record was still stored,
 *  since silently swallowing it would violate CLAUDE.md invariant #5. Shouldn't normally appear
 *  for this app (it's the only writer for its own `dev`), which is exactly why it's worth
 *  showing if it ever does. */
@Serializable
data class IncidentSummaryDto(
    val kind: String? = null,
    val severity: String? = null,
    val detail: String? = null,
)

@Serializable
data class IngestResponse(
    val accepted: Int = 0,
    val rejected: List<RejectedRecordDto> = emptyList(),
    val incidents: List<IncidentSummaryDto> = emptyList(),
    val ackSeq: Long? = null,
    val intervalSeconds: Int? = null,
    val serverTs: Long? = null,
)

// ---------------------------------------------------------------------------
// POST /companion
// ---------------------------------------------------------------------------

@Serializable
data class GpsEvidenceDto(
    val latMicro: Int,
    val lonMicro: Int,
    val accuracyCm: Int,
    val speedCmS: Int,
)

/** Only the `gps` shape is ever populated by this app — the IMU companion (`kind = 2`) is not
 *  implemented, so the `imu` half of the gateway's evidence union is never sent. kotlinx's
 *  `explicitNulls = false` (see `NetworkModule`) keeps a would-be `"imu": null` key out of the
 *  JSON entirely, which matters: the gateway's schema is a union of two object shapes, and a
 *  present-but-null `imu` key would fail to parse as either. */
@Serializable
data class CompanionEvidenceDto(
    val gps: GpsEvidenceDto? = null,
    val imu: ImuEvidenceDto? = null,
)

@Serializable
data class ImuEvidenceDto(
    val peakMilliG: Int,
    val durationMs: Int,
    val sampleHz: Int,
)

@Serializable
data class CompanionDto(
    val kind: Int,
    val seq: Long,
    val ts: String,
    val subjectDev: Hex,
    val subjectSeq: Long,
    val subject: Hex,
    val flags: Int,
    val payload: Hex,
    val sig: Hex,
    val evidence: CompanionEvidenceDto,
)

@Serializable
data class CompanionIngestRequest(
    val v: Int = 1,
    val dev: Hex,
    val companions: List<CompanionDto>,
)

@Serializable
data class CompanionResultDto(
    val seq: Long? = null,
    val status: String? = null,
    val reason: String? = null,
)

@Serializable
data class CompanionIngestResponse(
    val accepted: Int = 0,
    val results: List<CompanionResultDto> = emptyList(),
    val pendingSubjects: Int? = null,
    val serverTs: Long? = null,
)
