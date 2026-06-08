package com.amayatechnologies.kuditrack;

import android.app.Activity;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

@CapacitorPlugin(name = "SpeechToText")
public class SpeechPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String language = call.getString("language", "en-US");

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Say your transaction…");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);

        startActivityForResult(call, intent, "handleResult");
    }

    @ActivityCallback
    private void handleResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> matches =
                result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (matches != null && !matches.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("transcript", matches.get(0));
                call.resolve(ret);
                return;
            }
        }
        call.reject("cancelled");
    }
}
