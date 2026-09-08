package com.krishichain.app.domain

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.IOException

/**
 * Kotlin port of `apps/web/lib/deployments.ts`. That file reads `deployments/<network>/addresses.json`
 * straight off disk because it runs server-side in Next.js; a mobile app has no repo checkout to
 * read at runtime, so the same JSON shape is bundled as an Android asset instead
 * (`assets/deployments/<network>/addresses.json`) — a placeholder/absent file today, since
 * nothing is deployed to any network in this repo yet (mirrors CLAUDE.md's "no fake verified
 * state" invariant: absence here must render honestly, not silently).
 *
 * On top of the asset path, `BuildConfig.BATCH_ANCHOR_ADDRESS_OVERRIDE` (from `gradle.properties`,
 * see that file) lets a build be pointed at a real deployment without needing an app rebuild-time
 * asset refresh for every `npm run deploy:*` — the override wins when non-blank; otherwise this
 * falls back to the bundled asset, and finally to `null` ("not deployed").
 */

enum class NetworkName(val raw: String) {
    LOCALHOST("localhost"),
    AMOY("amoy"),
}

/** Mirrors `contracts/hardhat.config.ts`: 31337 is the local Hardhat node, anything else is
 *  treated as Amoy (80002). Derived from the configured chain id so network and chain id can
 *  never disagree. */
fun networkForChainId(chainId: Int): NetworkName =
    if (chainId == 31337) NetworkName.LOCALHOST else NetworkName.AMOY

@Serializable
data class DeploymentContracts(
    val ActorRegistry: String? = null,
    val DeviceRegistry: String? = null,
    val LotRegistry: String? = null,
    val BatchAnchor: String? = null,
)

@Serializable
data class DeploymentAddresses(
    val network: String? = null,
    val chainId: Int? = null,
    val deployedAt: String? = null,
    val deployer: String? = null,
    val contracts: DeploymentContracts? = null,
)

private val json = Json { ignoreUnknownKeys = true }

/** Read `assets/deployments/<network>/addresses.json`. Returns `null` — never throws — when the
 *  asset is missing or malformed, which is the normal state before a deployment exists. */
fun readDeployment(context: Context, network: NetworkName): DeploymentAddresses? {
    return try {
        val raw = context.assets.open("deployments/${network.raw}/addresses.json")
            .bufferedReader(Charsets.UTF_8)
            .use { it.readText() }
        json.decodeFromString<DeploymentAddresses>(raw)
    } catch (_: IOException) {
        null
    } catch (_: Exception) {
        null
    }
}

/** Convenience: just the `BatchAnchor` address the verify screen needs, or `null` when nothing
 *  is configured or deployed for this network. */
fun readBatchAnchorAddress(context: Context, network: NetworkName, override: String): Hex? {
    if (override.isNotBlank()) return override
    val address = readDeployment(context, network)?.contracts?.BatchAnchor
    return address?.takeIf { it.isNotBlank() }
}
