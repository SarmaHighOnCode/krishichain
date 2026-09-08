package com.krishichain.app.ui.verify

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.krishichain.app.BuildConfig
import com.krishichain.app.data.model.InclusionProofDto
import com.krishichain.app.data.model.LotResponse
import com.krishichain.app.data.remote.NetworkModule
import com.krishichain.app.data.remote.RpcRootResult
import com.krishichain.app.domain.Hex
import com.krishichain.app.domain.NetworkName
import com.krishichain.app.domain.VerificationStatus
import com.krishichain.app.domain.decideVerificationStatus
import com.krishichain.app.domain.networkForChainId
import com.krishichain.app.domain.readBatchAnchorAddress
import com.krishichain.app.domain.verifyProof
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Default demo lot — matches `scripts/sim-node.ts`'s `--lot` default so a fresh install has a
 *  sensible id already in the input field rather than an empty one. */
const val DEFAULT_LOT_ID = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7"

sealed interface LotUiState {
    data object Idle : LotUiState
    data object Loading : LotUiState
    data class NotFound(val lotId: String) : LotUiState
    data class NetworkError(val message: String) : LotUiState
    data class Loaded(
        val lot: LotResponse,
        val status: VerificationStatus,
        val anchoredCount: Int,
    ) : LotUiState
}

/** Mirrors the three real states `VerifyPanel.tsx` renders before a person even taps "verify":
 *  no proof yet (not anchored), a proof but nothing deployed to check it against, or ready. */
sealed interface ProofUiState {
    data object Loading : ProofUiState
    data object PendingAnchor : ProofUiState
    data class NotDeployed(val network: String, val deployCommand: String) : ProofUiState
    data class Ready(val proof: InclusionProofDto, val anchorAddress: Hex, val network: String) : ProofUiState
}

sealed interface VerifyRunState {
    data object Idle : VerifyRunState
    data object Checking : VerifyRunState
    data class Verified(val onChainRoot: Hex, val detail: String) : VerifyRunState
    data class Failed(val onChainRoot: Hex?, val detail: String) : VerifyRunState
}

class VerifyViewModel(application: Application) : AndroidViewModel(application) {

    private val _lotIdInput = MutableStateFlow(DEFAULT_LOT_ID)
    val lotIdInput: StateFlow<String> = _lotIdInput.asStateFlow()

    private val _lotState = MutableStateFlow<LotUiState>(LotUiState.Idle)
    val lotState: StateFlow<LotUiState> = _lotState.asStateFlow()

    private val _proofState = MutableStateFlow<ProofUiState>(ProofUiState.Loading)
    val proofState: StateFlow<ProofUiState> = _proofState.asStateFlow()

    private val _verifyState = MutableStateFlow<VerifyRunState>(VerifyRunState.Idle)
    val verifyState: StateFlow<VerifyRunState> = _verifyState.asStateFlow()

    init {
        loadLot(DEFAULT_LOT_ID)
    }

    fun onLotIdChanged(value: String) {
        _lotIdInput.value = value
    }

    /**
     * Load `GET /lot/:lotId`, then (S2-03's split) fetch the inclusion proof for the first
     * record's digest, then resolve the `BatchAnchor` address for the configured network — all
     * before the "Verify independently" button is ever tapped, same as the web page rendering
     * the journey before verification finishes (`app/verify/[lotId]/page.tsx`'s doc comment).
     */
    fun loadLot(lotId: String) {
        _lotIdInput.value = lotId
        _lotState.value = LotUiState.Loading
        _proofState.value = ProofUiState.Loading
        _verifyState.value = VerifyRunState.Idle

        viewModelScope.launch {
            val lotResponse = try {
                // The gateway compares the full "0x..." string case-insensitively
                // (apps/gateway/src/index.ts's `/lot/:lotId` handler) — send it as-is.
                val response = NetworkModule.gatewayApi.getLot(lotId)
                if (response.code() == 404 || response.body() == null) {
                    _lotState.value = LotUiState.NotFound(lotId)
                    _proofState.value = ProofUiState.PendingAnchor
                    return@launch
                } else if (!response.isSuccessful) {
                    _lotState.value = LotUiState.NetworkError("Gateway returned HTTP ${response.code()}")
                    return@launch
                }
                response.body()!!
            } catch (e: Exception) {
                _lotState.value = LotUiState.NetworkError(
                    e.message ?: "Could not reach the gateway. Is it running?",
                )
                return@launch
            }

            val status = decideVerificationStatus(lotResponse.records)
            val anchoredCount = lotResponse.records.count { it.anchored }
            _lotState.value = LotUiState.Loaded(lotResponse, status, anchoredCount)

            loadProof(lotResponse)
        }
    }

    private suspend fun loadProof(lot: LotResponse) {
        val firstDigest = lot.records.firstOrNull()?.digest
        val proof: InclusionProofDto? = if (firstDigest.isNullOrBlank()) {
            null
        } else {
            try {
                val response = NetworkModule.gatewayApi.getProof(firstDigest)
                // Covers the gateway's real 404 "not anchored yet" response along with any other
                // failure — both resolve to the same honest "nothing to verify against yet" state.
                if (response.isSuccessful) response.body() else null
            } catch (_: Exception) {
                null
            }
        }

        val network = networkForChainId(BuildConfig.VERIFY_CHAIN_ID)
        val anchorAddress = readBatchAnchorAddress(
            context = getApplication(),
            network = network,
            override = BuildConfig.BATCH_ANCHOR_ADDRESS_OVERRIDE,
        )

        _proofState.value = when {
            proof == null -> ProofUiState.PendingAnchor
            anchorAddress == null -> ProofUiState.NotDeployed(
                network = network.raw,
                deployCommand = if (network == NetworkName.LOCALHOST) "npm run deploy:local" else "npm run deploy:amoy",
            )
            else -> ProofUiState.Ready(proof, anchorAddress, network.raw)
        }
    }

    /**
     * THE demo moment (S2-03). Reads the anchor root from a PUBLIC RPC — never from the
     * gateway's own `proof.root` — and recomputes the Merkle path locally. Still returns a
     * verdict with the gateway process killed: the proof was already fetched in [loadProof], so
     * the only network call left here is the RPC read.
     */
    fun runVerification() {
        val ready = proofState.value as? ProofUiState.Ready ?: return
        _verifyState.value = VerifyRunState.Checking

        viewModelScope.launch {
            when (val result = NetworkModule.jsonRpcClient.getRoot(
                rpcUrl = BuildConfig.VERIFY_RPC_URL,
                contractAddress = ready.anchorAddress,
                anchorIndex = ready.proof.anchorIndex.toLong(),
            )) {
                is RpcRootResult.Failed -> {
                    _verifyState.value = VerifyRunState.Failed(onChainRoot = null, detail = "RPC read failed: ${result.message}")
                }

                is RpcRootResult.Ok -> {
                    val ok = verifyProof(ready.proof.digest, ready.proof.proof, result.root)
                    _verifyState.value = if (ok) {
                        VerifyRunState.Verified(
                            onChainRoot = result.root,
                            detail = "The record's Merkle path recomputes to the root read live from the chain — independent of the gateway.",
                        )
                    } else {
                        VerifyRunState.Failed(
                            onChainRoot = result.root,
                            detail = "The record does not recompute to the on-chain root. The record was altered after anchoring, or the gateway's proof was wrong.",
                        )
                    }
                }
            }
        }
    }
}
