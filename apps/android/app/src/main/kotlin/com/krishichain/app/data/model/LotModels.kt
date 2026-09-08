package com.krishichain.app.data.model

import com.krishichain.app.domain.BadgeRecord
import com.krishichain.app.domain.Hex
import kotlinx.serialization.Serializable

/**
 * Wire shapes for `GET /lot/:lotId` and `GET /proof/:digest` — copied verbatim from
 * `apps/gateway/src/index.ts` (see the handlers there), matching `apps/web/app/verify/[lotId]/page.tsx`'s
 * `LotRecord`/`LotResponse`/`InclusionProof` interfaces exactly.
 */

@Serializable
data class LotRecordDto(
    override val seq: Int,
    val ts: String,
    val tsq: Int,
    override val t: Int,
    val h: Int,
    val lux: Int,
    val flags: Int,
    val digest: Hex,
    override val verdict: String,
    override val anchored: Boolean,
) : BadgeRecord

@Serializable
data class LotResponse(
    val lotId: String,
    val recordCount: Int,
    val records: List<LotRecordDto>,
)

@Serializable
data class InclusionProofDto(
    val digest: Hex,
    val root: Hex,
    val proof: List<Hex>,
    val index: Int,
    val leafCount: Int,
    val anchorIndex: Int,
)

@Serializable
data class GatewayError(
    val error: String? = null,
    val status: String? = null,
)
