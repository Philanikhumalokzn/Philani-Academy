package com.philani.academy;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(IncomingPdfPlugin.class);
		super.onCreate(savedInstanceState);
		windowStatusBarForLightUi();
	}

	private void windowStatusBarForLightUi() {
		if (getWindow() == null || getWindow().getDecorView() == null) return;
		getWindow().setStatusBarColor(Color.WHITE);
		WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
		if (controller != null) {
			controller.setAppearanceLightStatusBars(true);
		}
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		setIntent(intent);
	}
}
