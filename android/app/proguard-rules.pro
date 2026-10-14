# Release shrinking + obfuscation (R8) — turned on 2026-10-14 because Google Play scored "DEX code optimization →
# Obfuscation" at 1% (anything under 25% can limit visibility/publishing; fix-by Feb 2027).
#
# Capacitor finds plugins by class name (capacitor.plugins.json) and calls their methods by name from JavaScript, so
# those names must survive. capacitor-android ships consumer rules for plugin classes/methods; the rules below also keep
# the libraries that ship none and use reflection / JSON internally, and our own native code. Everything else
# (AndroidX, Material, Kotlin, Firebase, Play services — which bring their own rules) is shrunk and obfuscated.

# Capacitor bridge + every plugin package in this app
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class com.getcapacitor.community.** { *; }
-keep class ee.forgr.** { *; }
-keep class io.ionic.libs.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }

# Our app and its own native plugins (NotificationSettingsPlugin, SpeechPlugin, MainActivity)
-keep class com.amayatechnologies.kuditrack.** { *; }

# JavaScript bridges added to the WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Readable crash reports (Play deobfuscates with the mapping file built into the AAB)
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions,SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Optional dependencies some libraries reference but never need on Android
-dontwarn org.slf4j.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn com.google.errorprone.annotations.**
