package com.krishichain.app.data.remote

import com.krishichain.app.domain.Hex
import com.krishichain.app.domain.keccak256
import com.krishichain.app.domain.leftPad
import com.krishichain.app.domain.toHex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Ticket-spec S2-03 equivalent for Android: a raw JSON-RPC `eth_call` against a PUBLIC RPC,
 * independent of the gateway, mirroring `apps/web/lib/batchAnchorAbi.ts`'s deliberate choice of
 * a hand-written ABI call instead of pulling in a full web3 library (viem there, web3j here —
 * neither is worth a dependency for one function). See `BatchAnchor.getRoot(uint256)`.
 *
 * This is the ONLY thing that must be independently true for a proof to mean anything: the root
 * has to come from the chain, not from our own server (CLAUDE.md invariant #5 / PRD §6.6).
 */

private val json = Json { ignoreUnknownKeys = true }

@Serializable
private data class RpcRequest(
    val jsonrpc: String = "2.0",
    val method: String,
    val params: List<JsonElement>,
    val id: Int = 1,
)

@Serializable
private data class RpcError(val code: Int? = null, val message: String? = null)

@Serializable
private data class RpcResponse(
    val jsonrpc: String? = null,
    val id: Int? = null,
    val result: String? = null,
    val error: RpcError? = null,
)

sealed interface RpcRootResult {
    data class Ok(val root: Hex) : RpcRootResult
    data class Failed(val message: String) : RpcRootResult
}

class JsonRpcClient(private val client: OkHttpClient) {

    /** `keccak256("getRoot(uint256)")[0:4]`, computed rather than hand-transcribed so a typo in
     *  the selector can't silently produce a wrong-but-plausible call. */
    private fun functionSelector(signature: String): ByteArray =
        keccak256(signature.toByteArray(Charsets.US_ASCII)).copyOfRange(0, 4)

    private fun encodeUint256(value: Long): ByteArray {
        require(value >= 0) { "anchorIndex must be non-negative" }
        val bytes = java.math.BigInteger.valueOf(value).toByteArray()
        // BigInteger.toByteArray() may include a leading sign byte; strip it before padding.
        val trimmed = if (bytes.size > 1 && bytes[0] == 0.toByte()) bytes.copyOfRange(1, bytes.size) else bytes
        return trimmed.leftPad(32)
    }

    /** `BatchAnchor.getRoot(uint256 index)` — reads the Merkle root the chain has for the batch
     *  at `anchorIndex`. Never trust `proof.root` (the gateway's own claim) for the actual check;
     *  this is the value that gets compared against it. */
    suspend fun getRoot(rpcUrl: String, contractAddress: Hex, anchorIndex: Long): RpcRootResult =
        withContext(Dispatchers.IO) {
            val calldata = functionSelector("getRoot(uint256)") + encodeUint256(anchorIndex)

            val paramsJson = kotlinx.serialization.json.buildJsonObject {
                put("to", kotlinx.serialization.json.JsonPrimitive(contractAddress))
                put("data", kotlinx.serialization.json.JsonPrimitive(calldata.toHex()))
            }
            val body = RpcRequest(
                method = "eth_call",
                params = listOf(paramsJson, kotlinx.serialization.json.JsonPrimitive("latest")),
            )
            val requestBody = json.encodeToString(RpcRequest.serializer(), body)
                .toRequestBody("application/json".toMediaType())

            val request = Request.Builder().url(rpcUrl).post(requestBody).build()

            try {
                client.newCall(request).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        return@withContext RpcRootResult.Failed("RPC HTTP ${response.code}")
                    }
                    val parsed = json.decodeFromString(RpcResponse.serializer(), text)
                    val error = parsed.error
                    if (error != null) {
                        return@withContext RpcRootResult.Failed("RPC error: ${error.message ?: "unknown"}")
                    }
                    val result = parsed.result
                    if (result.isNullOrBlank()) {
                        return@withContext RpcRootResult.Failed("RPC returned no result")
                    }
                    // `getRoot` returns a single non-dynamic bytes32: the result is exactly one
                    // 32-byte word, no ABI offset/length prefix to skip.
                    val hex = result.removePrefix("0x").removePrefix("0X")
                    if (hex.length < 64) {
                        return@withContext RpcRootResult.Failed("RPC result too short for bytes32: $result")
                    }
                    val root = "0x" + hex.takeLast(64)
                    RpcRootResult.Ok(root)
                }
            } catch (e: Exception) {
                RpcRootResult.Failed(e.message ?: "RPC read failed — the chain is unreachable.")
            }
        }
}
