package com.krishichain.app.ui.virtualnode

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.krishichain.app.data.model.CompanionDto
import com.krishichain.app.data.model.CompanionEvidenceDto
import com.krishichain.app.data.model.CompanionIngestRequest
import com.krishichain.app.data.model.DeviceCommissionRequest
import com.krishichain.app.data.model.ExplodedRecordDto
import com.krishichain.app.data.model.GpsEvidenceDto
import com.krishichain.app.data.model.IngestRequest
import com.krishichain.app.data.remote.NetworkModule
import com.krishichain.app.domain.CompanionAttestation
import com.krishichain.app.domain.CompanionFlags
import com.krishichain.app.domain.CompanionKind
import com.krishichain.app.domain.COMPANION_VERSION
import com.krishichain.app.domain.DeviceIdentity
import com.krishichain.app.domain.Flags
import com.krishichain.app.domain.GpsEvidence
import com.krishichain.app.domain.Hex
import com.krishichain.app.domain.Identity
import com.krishichain.app.domain.NodeChainState
import com.krishichain.app.domain.PROTOCOL_VERSION
import com.krishichain.app.domain.SensorRecord
import com.krishichain.app.domain.ZERO_LOT
import com.krishichain.app.domain.companionDigest
import com.krishichain.app.domain.gpsEvidenceHash
import com.krishichain.app.domain.recordDigest
import com.krishichain.app.domain.signDigestHex
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Streaming cadence. The ticket calls 10s reasonable; hardcoded rather than configurable, per
 *  the ticket's own "configurable if easy, hardcoded is fine otherwise". */
private const val TICK_INTERVAL_MS = 10_000L

/** A GPS fix older than this is not "a valid position fix" for a companion — report no fix
 *  rather than attest to a stale one. */
private const val LOCATION_MAX_AGE_MS = 5 * 60_000L

sealed interface RecordSendState {
    data object Idle : RecordSendState
    data object Sending : RecordSendState
    data class Accepted(val seq: Long, val digest: Hex, val warning: String? = null) : RecordSendState
    data class Rejected(val seq: Long, val reason: String) : RecordSendState
    data class RequestFailed(val message: String) : RecordSendState
}

sealed interface CompanionSendState {
    data object Idle : CompanionSendState
    data class Sent(val seq: Long) : CompanionSendState
    data class Skipped(val reason: String) : CompanionSendState
    data class Failed(val reason: String) : CompanionSendState
}

/**
 * Turns the phone into a virtual sensor node (ticket S2-13): a signed `POST /ingest` reading
 * stream plus a `POST /companion` GPS attestation for each accepted record, using the on-device
 * soft key from [Identity]. No BLE peripheral advertising — see the ticket report for why.
 *
 * A phone has no calibrated temperature/humidity sensor, so every record it sends carries the
 * real fault sentinels (`t = -32768`, `h = 0xFFFF`) with `SENSOR_FAULT` set, never a fabricated
 * reading (CLAUDE.md's hard invariant). `lux` and `bat` are real device readings; GPS is a real
 * fix or the companion for that tick is skipped outright — never a faked position.
 */
class VirtualNodeViewModel(application: Application) : AndroidViewModel(application) {

    private val identity: DeviceIdentity = Identity.loadOrCreate(application)
    private var chainState: NodeChainState = Identity.loadState(application)

    val address: Hex = identity.address

    private val _commissioned = MutableStateFlow(chainState.commissioned)
    val commissioned: StateFlow<Boolean> = _commissioned.asStateFlow()

    private val _streaming = MutableStateFlow(false)
    val streaming: StateFlow<Boolean> = _streaming.asStateFlow()

    private val _recordSeq = MutableStateFlow(chainState.recordSeq)
    val recordSeq: StateFlow<Long> = _recordSeq.asStateFlow()

    private val _recordSendState = MutableStateFlow<RecordSendState>(RecordSendState.Idle)
    val recordSendState: StateFlow<RecordSendState> = _recordSendState.asStateFlow()

    private val _companionSendState = MutableStateFlow<CompanionSendState>(CompanionSendState.Idle)
    val companionSendState: StateFlow<CompanionSendState> = _companionSendState.asStateFlow()

    private val _lotIdInput = MutableStateFlow("")
    val lotIdInput: StateFlow<String> = _lotIdInput.asStateFlow()

    private val _lotIdError = MutableStateFlow<String?>(null)
    val lotIdError: StateFlow<String?> = _lotIdError.asStateFlow()

    private val _locationPermissionGranted = MutableStateFlow(hasLocationPermission(application))
    val locationPermissionGranted: StateFlow<Boolean> = _locationPermissionGranted.asStateFlow()

    private var streamingJob: Job? = null
    private var bootFlagPending = true

    private val sensorManager = application.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private var lightListener: SensorEventListener? = null

    @Volatile private var lastLux: Int? = null

    private val locationManager = application.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    private var locationListener: LocationListener? = null

    @Volatile private var lastLocation: Location? = null

    fun onLotIdChanged(value: String) {
        _lotIdInput.value = value
        _lotIdError.value = validateLotId(value)
    }

    /** Called by the screen after a runtime permission request resolves (or on screen entry, to
     *  pick up a grant that happened outside this VM's lifetime). */
    fun refreshLocationPermission() {
        val granted = hasLocationPermission(getApplication())
        _locationPermissionGranted.value = granted
        if (granted && _streaming.value) startLocationUpdates()
    }

    fun toggleStreaming() {
        if (_streaming.value) stopStreaming() else startStreaming()
    }

    private fun startStreaming() {
        if (_streaming.value) return
        bootFlagPending = true
        _streaming.value = true
        startLightSensor()
        startLocationUpdates()
        streamingJob = viewModelScope.launch {
            while (isActive) {
                tick()
                delay(TICK_INTERVAL_MS)
            }
        }
    }

    private fun stopStreaming() {
        _streaming.value = false
        streamingJob?.cancel()
        streamingJob = null
        stopSensors()
    }

    override fun onCleared() {
        super.onCleared()
        stopSensors()
    }

    private fun startLightSensor() {
        val sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LIGHT) ?: return
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                lastLux = event.values.firstOrNull()?.toInt()
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        lightListener = listener
        sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
    }

    private fun startLocationUpdates() {
        if (!hasLocationPermission(getApplication())) return
        if (locationListener != null) return
        val manager = locationManager ?: return

        val provider = when {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> null
        } ?: return

        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                lastLocation = location
            }

            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
        }
        try {
            locationListener = listener
            lastLocation = manager.getLastKnownLocation(provider) ?: lastLocation
            manager.requestLocationUpdates(provider, 5_000L, 0f, listener)
        } catch (_: SecurityException) {
            // Permission revoked between the check above and this call. Leave lastLocation as-is
            // — the next companion attempt reports "no fix" honestly rather than crashing.
            locationListener = null
        }
    }

    private fun stopSensors() {
        lightListener?.let { sensorManager?.unregisterListener(it) }
        lightListener = null
        locationListener?.let { locationManager?.removeUpdates(it) }
        locationListener = null
    }

    private suspend fun tick() {
        val app = getApplication<Application>()

        if (!chainState.commissioned) {
            val ok = commission(app)
            if (!ok) return
        }

        _recordSendState.value = RecordSendState.Sending
        _companionSendState.value = CompanionSendState.Idle

        val bat = readBatteryPercent(app)
        val lux = (lastLux ?: 0).coerceIn(0, 0xffff)

        val lotInput = _lotIdInput.value
        val lot = if (_lotIdError.value == null && lotInput.isNotBlank()) lotInput else ZERO_LOT
        val bindsLot = lot != ZERO_LOT && !lot.equals(chainState.lastLot, ignoreCase = true)

        var flags = Flags.SENSOR_FAULT
        if (bootFlagPending) flags = flags or Flags.BOOT
        if (bindsLot) flags = flags or Flags.LOT_BOUND
        bootFlagPending = false

        val record = SensorRecord(
            v = PROTOCOL_VERSION,
            dev = identity.address,
            seq = chainState.recordSeq,
            prev = chainState.lastRecordDigest,
            ts = System.currentTimeMillis() / 1000,
            tsq = 0, // never synced (no NTP implemented) — honest per PROTOCOL.md's tsq table.
            lot = lot,
            t = -32768, // SENSOR_FAULT sentinel — no calibrated temperature sensor on a phone.
            h = 0xffff, // SENSOR_FAULT sentinel — no calibrated humidity sensor on a phone.
            lux = lux,
            flags = flags,
            bat = bat,
        )
        val digest = recordDigest(record)
        val sig = signDigestHex(digest, identity.privateKey)

        val dto = ExplodedRecordDto(
            seq = record.seq,
            prev = record.prev,
            ts = record.ts.toString(),
            tsq = record.tsq,
            lot = record.lot,
            t = record.t,
            h = record.h,
            lux = record.lux,
            flags = record.flags,
            bat = record.bat,
            sig = sig,
        )

        val response = try {
            NetworkModule.gatewayApi.ingest(
                IngestRequest(dev = identity.address, records = listOf(dto), role = "VIRTUAL", buffered = 0),
            )
        } catch (e: Exception) {
            _recordSendState.value = RecordSendState.RequestFailed(e.message ?: "network error")
            return
        }

        if (!response.isSuccessful) {
            if (response.code() == 401) {
                // Unregistered/unauthorised — recommission on the next tick rather than retrying
                // this exact record forever.
                chainState = chainState.copy(commissioned = false)
                Identity.saveState(app, chainState)
                _commissioned.value = false
            }
            _recordSendState.value = RecordSendState.RequestFailed("HTTP ${response.code()}")
            return
        }

        val body = response.body()
        if (body == null || body.accepted != 1 || body.rejected.isNotEmpty()) {
            val reason = body?.rejected?.firstOrNull()?.reason ?: "not accepted"
            _recordSendState.value = RecordSendState.Rejected(record.seq, reason)
            return
        }

        chainState = chainState.copy(recordSeq = record.seq + 1, lastRecordDigest = digest, lastLot = lot)
        Identity.saveState(app, chainState)
        _recordSeq.value = chainState.recordSeq

        val warning = body.incidents.firstOrNull()?.let { "${it.kind}: ${it.detail ?: it.severity}" }
        _recordSendState.value = RecordSendState.Accepted(record.seq, digest, warning)

        sendCompanion(app, record, digest)
    }

    private suspend fun sendCompanion(app: Application, record: SensorRecord, subjectDigest: Hex) {
        if (!hasLocationPermission(app)) {
            _companionSendState.value = CompanionSendState.Skipped("location permission not granted")
            return
        }
        val location = lastLocation
        val ageMs = location?.let { System.currentTimeMillis() - it.time }
        if (location == null || ageMs == null || ageMs > LOCATION_MAX_AGE_MS) {
            _companionSendState.value = CompanionSendState.Skipped("no recent GPS fix")
            return
        }

        val gps = GpsEvidence(
            latMicro = (location.latitude * 1_000_000.0).toInt().coerceIn(-90_000_000, 90_000_000),
            lonMicro = (location.longitude * 1_000_000.0).toInt().coerceIn(-180_000_000, 180_000_000),
            accuracyCm = (location.accuracy * 100.0).toInt().coerceIn(0, 0xffff),
            speedCmS = (location.speed * 100.0).toInt().coerceIn(0, 0xffff),
        )
        val payload = gpsEvidenceHash(gps)
        val companion = CompanionAttestation(
            v = COMPANION_VERSION,
            kind = CompanionKind.GPS,
            dev = identity.address,
            seq = chainState.companionSeq,
            ts = record.ts,
            subjectDev = identity.address, // no other node to witness — the phone attests to its own reading.
            subjectSeq = record.seq,
            subject = subjectDigest,
            flags = CompanionFlags.GPS_FIX,
            payload = payload,
        )
        val digest = companionDigest(companion)
        val sig = signDigestHex(digest, identity.privateKey)

        val dto = CompanionDto(
            kind = companion.kind,
            seq = companion.seq,
            ts = companion.ts.toString(),
            subjectDev = companion.subjectDev,
            subjectSeq = companion.subjectSeq,
            subject = companion.subject,
            flags = companion.flags,
            payload = companion.payload,
            sig = sig,
            evidence = CompanionEvidenceDto(
                gps = GpsEvidenceDto(gps.latMicro, gps.lonMicro, gps.accuracyCm, gps.speedCmS),
            ),
        )

        val response = try {
            NetworkModule.gatewayApi.postCompanion(
                CompanionIngestRequest(dev = identity.address, companions = listOf(dto)),
            )
        } catch (e: Exception) {
            _companionSendState.value = CompanionSendState.Failed(e.message ?: "network error")
            return
        }

        if (!response.isSuccessful) {
            _companionSendState.value = CompanionSendState.Failed("HTTP ${response.code()}")
            return
        }

        val result = response.body()?.results?.firstOrNull()
        if (result == null || result.status?.startsWith("accepted") != true) {
            _companionSendState.value = CompanionSendState.Failed(result?.reason ?: "not accepted")
            return
        }

        chainState = chainState.copy(companionSeq = companion.seq + 1)
        Identity.saveState(app, chainState)
        _companionSendState.value = CompanionSendState.Sent(companion.seq)
    }

    /** `POST /devices`, once, on first key generation (or after a 401 signals the gateway lost
     *  track of us — e.g. a fresh gateway restart with no persistence). */
    private suspend fun commission(app: Application): Boolean {
        val location = if (hasLocationPermission(app)) {
            locationManager?.let {
                it.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?: it.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            }
        } else {
            null
        }

        val response = try {
            NetworkModule.gatewayApi.commissionDevice(
                DeviceCommissionRequest(
                    address = identity.address,
                    role = "VIRTUAL",
                    lat = location?.latitude,
                    lon = location?.longitude,
                ),
            )
        } catch (e: Exception) {
            _recordSendState.value = RecordSendState.RequestFailed("commission failed: ${e.message}")
            return false
        }

        if (!response.isSuccessful) {
            _recordSendState.value = RecordSendState.RequestFailed("commission failed: HTTP ${response.code()}")
            return false
        }

        chainState = chainState.copy(commissioned = true)
        Identity.saveState(app, chainState)
        _commissioned.value = true
        return true
    }

    private fun readBatteryPercent(context: Context): Int {
        val manager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return 0
        val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return level.coerceIn(0, 100)
    }

    companion object {
        fun hasLocationPermission(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED

        /** `0x` + 32 hex chars — 16 bytes, matching the QR label page's validation
         *  (`apps/web/app/ops/labels/page.tsx`). Blank is valid (means "unbound"). */
        fun validateLotId(value: String): String? {
            if (value.isBlank()) return null
            return if (Regex("^0x[0-9a-fA-F]{32}$").matches(value)) null else "Must be 0x + 32 hex characters"
        }
    }
}
