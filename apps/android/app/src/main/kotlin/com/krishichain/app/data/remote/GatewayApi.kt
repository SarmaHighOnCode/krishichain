package com.krishichain.app.data.remote

import com.krishichain.app.data.model.CompanionIngestRequest
import com.krishichain.app.data.model.CompanionIngestResponse
import com.krishichain.app.data.model.DeviceCommissionRequest
import com.krishichain.app.data.model.DeviceCommissionResponse
import com.krishichain.app.data.model.InclusionProofDto
import com.krishichain.app.data.model.IngestRequest
import com.krishichain.app.data.model.IngestResponse
import com.krishichain.app.data.model.LotResponse
import com.krishichain.app.data.model.OpsSummaryDto
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * `apps/gateway/src/index.ts`'s read and write endpoints. All return plain `Response<T>` rather
 * than unwrapped bodies so a non-2xx status — the gateway's real "unknown lot" / "unregistered
 * device" / "not anchored yet" responses — is a value to branch on here, not a thrown
 * `HttpException` the UI has to catch. That mirrors the web app's `fetchLot`/`fetchProof`, which
 * both resolve a non-OK response to `null` rather than throwing
 * (`apps/web/app/verify/[lotId]/page.tsx`).
 */
interface GatewayApi {
    @GET("lot/{lotId}")
    suspend fun getLot(@Path("lotId") lotId: String): Response<LotResponse>

    @GET("proof/{digest}")
    suspend fun getProof(@Path("digest") digest: String): Response<InclusionProofDto>

    /** Commission a virtual node's soft-key address, once, on first key generation. */
    @POST("devices")
    suspend fun commissionDevice(@Body body: DeviceCommissionRequest): Response<DeviceCommissionResponse>

    /** PROTOCOL.md §3.2 batch upload — this app always sends exactly one record per call. */
    @POST("ingest")
    suspend fun ingest(@Body body: IngestRequest): Response<IngestResponse>

    /** Witness attestations (S1-14) — this app sends GPS (`kind = 3`) only. */
    @POST("companion")
    suspend fun postCompanion(@Body body: CompanionIngestRequest): Response<CompanionIngestResponse>

    @GET("ops/summary")
    suspend fun getOpsSummary(): Response<OpsSummaryDto>
}
