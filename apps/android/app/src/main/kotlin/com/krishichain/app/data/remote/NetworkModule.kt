package com.krishichain.app.data.remote

import com.krishichain.app.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Plain manual DI (no Hilt/Koin) — one small object graph doesn't earn a DI framework dependency,
 * same call the web app made for its ABI helper.
 */
object NetworkModule {

    private val json = Json { ignoreUnknownKeys = true }

    private val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
            .build()
    }

    /** Talks only to our own gateway (`GET /lot`, `GET /proof`) — never used for the on-chain
     *  root read, which goes through [jsonRpcClient] instead. */
    val gatewayApi: GatewayApi by lazy {
        val baseUrl = BuildConfig.GATEWAY_BASE_URL.let { if (it.endsWith("/")) it else "$it/" }
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(GatewayApi::class.java)
    }

    /** Independent public-RPC reader for `BatchAnchor.getRoot`. Deliberately its own OkHttp call
     *  rather than a Retrofit service — see `JsonRpcClient`'s doc comment. */
    val jsonRpcClient: JsonRpcClient by lazy { JsonRpcClient(okHttpClient) }
}
