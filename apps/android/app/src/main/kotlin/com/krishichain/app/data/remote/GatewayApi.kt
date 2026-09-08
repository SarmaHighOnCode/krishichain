package com.krishichain.app.data.remote

import com.krishichain.app.data.model.InclusionProofDto
import com.krishichain.app.data.model.LotResponse
import com.krishichain.app.data.model.OpsSummaryDto
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Path

/**
 * `apps/gateway/src/index.ts`'s two read endpoints. Both return plain `Response<T>` rather than
 * unwrapped bodies so a 404 — the gateway's real "unknown lot" / "not anchored yet" response — is
 * a value to branch on here, not a thrown `HttpException` the UI has to catch. That mirrors the
 * web app's `fetchLot`/`fetchProof`, which both resolve a non-OK response to `null` rather than
 * throwing (`apps/web/app/verify/[lotId]/page.tsx`).
 */
interface GatewayApi {
    @GET("lot/{lotId}")
    suspend fun getLot(@Path("lotId") lotId: String): Response<LotResponse>

    @GET("proof/{digest}")
    suspend fun getProof(@Path("digest") digest: String): Response<InclusionProofDto>

    @GET("ops/summary")
    suspend fun getOpsSummary(): Response<OpsSummaryDto>
}
