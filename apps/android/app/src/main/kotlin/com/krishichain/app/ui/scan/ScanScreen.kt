package com.krishichain.app.ui.scan

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.krishichain.app.domain.extractLotId
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusLg
import com.krishichain.app.ui.theme.RadiusPill
import com.krishichain.app.ui.theme.Spacing
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.delay

/**
 * Scan tab (on-device QR decode, no gateway call). A scanned label is either a bare lot ID or a
 * label-sheet URL of the form `<origin>/verify/<lotId>` (apps/web/app/ops/labels/page.tsx) —
 * [extractLotId] handles both. On a hit, [onLotScanned] hands the lot ID to the hoisted
 * [com.krishichain.app.ui.verify.VerifyViewModel] and the nav host switches to the Verify tab.
 */
@Composable
fun ScanScreen(
    onLotScanned: (String) -> Unit,
    onManualEntry: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val colors = KrishiTheme.colors

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var permissionDenied by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasCameraPermission = granted
        if (!granted) permissionDenied = true
    }
    LaunchedEffect(Unit) {
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    var scannedLotId by remember { mutableStateOf<String?>(null) }
    var showMismatchHint by remember { mutableStateOf(false) }

    if (!hasCameraPermission) {
        CameraPermissionRationale(
            denied = permissionDenied,
            onRequestAccess = { permissionLauncher.launch(Manifest.permission.CAMERA) },
            onManualEntry = onManualEntry,
        )
        return
    }

    // Debounce the analyzer's first hit into a short "Scanned" flash before handing off — same
    // affordance as VerifyPanel's own verdict states, just quicker since there's nothing to check.
    LaunchedEffect(scannedLotId) {
        scannedLotId?.let { lotId ->
            delay(450)
            onLotScanned(lotId)
        }
    }

    // A decoded QR that isn't a KrishiChain lot label gets a visible, self-clearing hint rather
    // than nothing at all — CLAUDE.md's "fail loudly, never swallow" invariant is written for
    // verification verdicts, but the same principle applies to "we saw a code and rejected it".
    LaunchedEffect(showMismatchHint) {
        if (showMismatchHint) {
            delay(1500)
            showMismatchHint = false
        }
    }

    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val preview = remember { Preview.Builder().build() }
    val imageAnalysis = remember {
        ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
    }
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
    }
    val scannedGuard = remember { AtomicBoolean(false) }
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }

    // Unbind explicitly on dispose (leaving the Scan tab) rather than relying on lifecycle
    // events — `lifecycleOwner` here is the Activity's, which stays STARTED across tab switches,
    // so without this the camera would keep running in the background on every other tab.
    DisposableEffect(Unit) {
        onDispose {
            cameraProvider?.unbindAll()
            analysisExecutor.shutdown()
            scanner.close()
        }
    }

    LaunchedEffect(previewView) {
        preview.surfaceProvider = previewView.surfaceProvider
        imageAnalysis.setAnalyzer(analysisExecutor) { imageProxy ->
            analyzeFrame(
                imageProxy = imageProxy,
                scanner = scanner,
                scannedGuard = scannedGuard,
                onDetected = { lotId -> scannedLotId = lotId },
                onMismatch = { if (!showMismatchHint) showMismatchHint = true },
            )
        }

        val provider = ProcessCameraProvider.awaitInstance(context)
        provider.unbindAll()
        provider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
            imageAnalysis,
        )
        cameraProvider = provider
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())

        // Top scrim + title, readable over whatever the camera is pointed at. (No extra status-bar
        // inset here — this composable already sits inside the nav host's Scaffold, which reserves
        // that space via its innerPadding, same as VerifyScreen's hero card.)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.45f))
                .padding(Spacing.xl),
        ) {
            Column {
                Text(
                    "SCAN",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White.copy(alpha = 0.7f),
                )
                Spacer(Modifier.height(Spacing.xs))
                Text(
                    "Point at a lot's QR label",
                    style = MaterialTheme.typography.headlineMedium,
                    color = Color.White,
                )
            }
        }

        // Viewfinder frame, centered.
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            val scanned = scannedLotId != null
            Box(
                modifier = Modifier
                    .size(240.dp)
                    .clip(RoundedCornerShape(RadiusLg))
                    .background(if (scanned) colors.statusVerified.copy(alpha = 0.12f) else Color.Transparent),
            ) {
                ViewfinderCorners(
                    color = if (scanned) colors.statusVerified else colors.actionBlue,
                )
                if (scanned) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Rounded.CheckCircle,
                            contentDescription = "Scanned",
                            tint = colors.statusVerified,
                            modifier = Modifier.size(56.dp),
                        )
                    }
                }
            }

            AnimatedVisibility(
                visible = showMismatchHint && !scanned,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(top = 240.dp + Spacing.lg),
            ) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(RadiusPill))
                        .background(colors.statusFlagged)
                        .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Text(
                        "Not a KrishiChain lot QR",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White,
                    )
                }
            }
        }

        // Bottom card: manual-entry fallback, matching the app's white-card language.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(Spacing.xl),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(RadiusPill))
                    .background(Color.White)
                    .clickable(onClick = onManualEntry)
                    .padding(horizontal = Spacing.lg, vertical = Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Icon(
                    imageVector = Icons.Rounded.EditNote,
                    contentDescription = null,
                    tint = colors.actionBlue,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    "Can't scan? Enter the lot ID manually",
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.ink,
                )
            }
        }
    }
}

@Composable
private fun ViewfinderCorners(color: Color) {
    val strokeWidth = 4.dp
    val cornerLength = 28.dp

    listOf(Alignment.TopStart, Alignment.TopEnd, Alignment.BottomStart, Alignment.BottomEnd).forEach { corner ->
        Box(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .align(corner)
                    .size(width = cornerLength, height = strokeWidth)
                    .background(color),
            )
            Box(
                modifier = Modifier
                    .align(corner)
                    .size(width = strokeWidth, height = cornerLength)
                    .background(color),
            )
        }
    }
}

@Composable
private fun CameraPermissionRationale(
    denied: Boolean,
    onRequestAccess: () -> Unit,
    onManualEntry: () -> Unit,
) {
    val colors = KrishiTheme.colors
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(Spacing.xxl),
        ) {
            Icon(
                imageVector = Icons.Rounded.QrCodeScanner,
                contentDescription = null,
                tint = colors.actionBlue,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(Spacing.lg))
            Text(
                "Camera access needed",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.ink,
            )
            Spacer(Modifier.height(Spacing.sm))
            Text(
                if (denied) {
                    "Camera access was denied. You can grant it from your device Settings, or enter the lot ID by hand instead."
                } else {
                    "Scan a crate's QR label to jump straight to its verified journey."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = colors.bodyMuted,
            )
            Spacer(Modifier.height(Spacing.xl))
            Button(
                onClick = onRequestAccess,
                shape = RoundedCornerShape(RadiusPill),
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.ink,
                    contentColor = Color.White,
                ),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.CameraAlt,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(if (denied) "Try again" else "Enable camera access")
                }
            }
            Spacer(Modifier.height(Spacing.md))
            Text(
                "Enter lot ID manually instead",
                style = MaterialTheme.typography.labelMedium,
                color = colors.actionBlue,
                modifier = Modifier.clickable(onClick = onManualEntry),
            )
        }
    }
}

/** Runs off the main thread on [analysisExecutor]; [onDetected] hops back via the [scannedGuard]
 *  compare-and-set so only the first decoded lot ID in the whole session fires it. A QR that
 *  decodes but isn't a lot label (or a label URL) fires [onMismatch] instead of being dropped
 *  silently — see the "fail loudly" comment at its call site. */
@ExperimentalGetImage
private fun analyzeFrame(
    imageProxy: ImageProxy,
    scanner: BarcodeScanner,
    scannedGuard: AtomicBoolean,
    onDetected: (String) -> Unit,
    onMismatch: () -> Unit,
) {
    val mediaImage = imageProxy.image
    if (mediaImage == null || scannedGuard.get()) {
        imageProxy.close()
        return
    }

    val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
    scanner.process(inputImage)
        .addOnSuccessListener { barcodes ->
            if (barcodes.isEmpty()) return@addOnSuccessListener
            val lotId = barcodes.firstNotNullOfOrNull { it.rawValue?.let(::extractLotId) }
            if (lotId != null) {
                if (scannedGuard.compareAndSet(false, true)) onDetected(lotId)
            } else {
                onMismatch()
            }
        }
        .addOnCompleteListener { imageProxy.close() }
}
