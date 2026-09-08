package com.krishichain.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.krishichain.app.data.model.OpsSummaryDto
import com.krishichain.app.data.remote.GatewayApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

import com.krishichain.app.data.remote.NetworkModule

sealed class DashboardUiState {
    object Loading : DashboardUiState()
    data class Live(val summary: OpsSummaryDto, val lastUpdatedMs: Long) : DashboardUiState()
    data class Reconnecting(val lastSummary: OpsSummaryDto?, val lastUpdatedMs: Long?) : DashboardUiState()
}

class DashboardViewModel : ViewModel() {

    private val api = NetworkModule.gatewayApi

    private val _uiState = MutableStateFlow<DashboardUiState>(DashboardUiState.Loading)
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    private var pollJob: Job? = null

    init {
        startPolling()
    }

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            while (isActive) {
                try {
                    val response = api.getOpsSummary()
                    if (response.isSuccessful && response.body() != null) {
                        _uiState.value = DashboardUiState.Live(
                            summary = response.body()!!,
                            lastUpdatedMs = System.currentTimeMillis()
                        )
                    } else {
                        // Gateway reachable but returned error? Treat as reconnecting/stale
                        transitionToReconnecting()
                    }
                } catch (e: Exception) {
                    // Network error / unreachable
                    transitionToReconnecting()
                }
                delay(3000L)
            }
        }
    }

    private fun transitionToReconnecting() {
        val currentState = _uiState.value
        if (currentState is DashboardUiState.Live) {
            _uiState.value = DashboardUiState.Reconnecting(currentState.summary, currentState.lastUpdatedMs)
        } else if (currentState is DashboardUiState.Loading) {
            _uiState.value = DashboardUiState.Reconnecting(null, null)
        }
    }

    override fun onCleared() {
        super.onCleared()
        pollJob?.cancel()
    }
}
