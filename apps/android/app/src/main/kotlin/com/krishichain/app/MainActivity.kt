package com.krishichain.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.krishichain.app.ui.KrishiChainNavHost
import com.krishichain.app.ui.theme.KrishiChainTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            KrishiChainTheme {
                KrishiChainNavHost()
            }
        }
    }
}
