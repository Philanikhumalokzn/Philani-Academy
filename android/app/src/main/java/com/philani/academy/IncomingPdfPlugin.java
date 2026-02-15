package com.philani.academy;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

@CapacitorPlugin(name = "IncomingPdf")
public class IncomingPdfPlugin extends Plugin {
  private static final int MAX_BYTES = 30 * 1024 * 1024;
  private Intent pendingIntent;

  @Override
  public void load() {
    super.load();
    final Activity activity = getActivity();
    if (activity != null) {
      final Intent current = activity.getIntent();
      if (isPdfViewIntent(current)) {
        pendingIntent = current;
      }
    }
  }

  @Override
  protected void handleOnNewIntent(Intent intent) {
    super.handleOnNewIntent(intent);
    if (isPdfViewIntent(intent)) {
      pendingIntent = intent;
      notifyListeners("pendingPdf", new JSObject().put("available", true), true);
    }
  }

  @PluginMethod
  public void consumePendingPdf(PluginCall call) {
    Intent intent = pendingIntent;
    if (intent == null) {
      final Activity activity = getActivity();
      if (activity != null) {
        final Intent current = activity.getIntent();
        if (isPdfViewIntent(current)) {
          intent = current;
        }
      }
    }

    if (intent == null) {
      call.resolve(new JSObject().put("available", false));
      return;
    }

    try {
      final JSObject payload = readPdfPayload(intent);
      pendingIntent = null;
      clearIntentIfCurrent(intent);
      payload.put("available", true);
      call.resolve(payload);
    } catch (SecurityException sec) {
      call.reject("Unable to open PDF: permission denied.", sec);
    } catch (IllegalStateException tooLarge) {
      call.reject(tooLarge.getMessage(), tooLarge);
    } catch (Exception ex) {
      call.reject("Unable to open PDF file.", ex);
    }
  }

  private boolean isPdfViewIntent(Intent intent) {
    if (intent == null) return false;
    if (!Intent.ACTION_VIEW.equals(intent.getAction())) return false;

    final Uri data = intent.getData();
    if (data == null) return false;

    final String type = intent.getType();
    if ("application/pdf".equalsIgnoreCase(type)) return true;

    try {
      final ContentResolver resolver = getContext().getContentResolver();
      final String resolvedType = resolver.getType(data);
      return "application/pdf".equalsIgnoreCase(resolvedType);
    } catch (Exception ignored) {
      return false;
    }
  }

  private JSObject readPdfPayload(Intent intent) throws IOException {
    final Uri uri = intent.getData();
    if (uri == null) {
      throw new IOException("Missing PDF URI.");
    }

    final ContentResolver resolver = getContext().getContentResolver();
    final String mimeType = resolveMimeType(intent, resolver, uri);

    try (InputStream inputStream = resolver.openInputStream(uri)) {
      if (inputStream == null) {
        throw new IOException("Unable to read PDF stream.");
      }

      final ByteArrayOutputStream output = new ByteArrayOutputStream();
      final byte[] buffer = new byte[8192];
      int read;
      int total = 0;
      while ((read = inputStream.read(buffer)) != -1) {
        total += read;
        if (total > MAX_BYTES) {
          throw new IllegalStateException("PDF is too large to open directly (max 30MB).");
        }
        output.write(buffer, 0, read);
      }

      final String base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
      final JSObject out = new JSObject();
      out.put("mimeType", mimeType);
      out.put("fileName", resolveDisplayName(resolver, uri));
      out.put("base64", base64);
      return out;
    }
  }

  private String resolveMimeType(Intent intent, ContentResolver resolver, Uri uri) {
    final String fromIntent = intent.getType();
    if (fromIntent != null && !fromIntent.trim().isEmpty()) {
      return fromIntent;
    }
    final String fromResolver = resolver.getType(uri);
    if (fromResolver != null && !fromResolver.trim().isEmpty()) {
      return fromResolver;
    }
    return "application/pdf";
  }

  private String resolveDisplayName(ContentResolver resolver, Uri uri) {
    Cursor cursor = null;
    try {
      cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
      if (cursor != null && cursor.moveToFirst()) {
        final int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
        if (index >= 0) {
          final String name = cursor.getString(index);
          if (name != null && !name.trim().isEmpty()) {
            return name;
          }
        }
      }
    } catch (Exception ignored) {
      // ignore and fallback
    } finally {
      if (cursor != null) cursor.close();
    }

    final String fallback = uri.getLastPathSegment();
    if (fallback != null && !fallback.trim().isEmpty()) {
      return fallback;
    }
    return "Document.pdf";
  }

  private void clearIntentIfCurrent(Intent consumedIntent) {
    final Activity activity = getActivity();
    if (activity == null) return;

    final Intent current = activity.getIntent();
    if (current != consumedIntent) return;

    current.setAction(Intent.ACTION_MAIN);
    current.setData(null);
    current.setType(null);
    activity.setIntent(current);
  }
}
