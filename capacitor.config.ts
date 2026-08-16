import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.amayatechnologies.kuditrack',
  appName: 'KudiAI Track',
  webDir: 'build',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
    },
    SplashScreen: {
      launchShowDuration: 1800,
      backgroundColor: "#fdfefe",
      androidSplashResourceName: "splash",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    CapacitorUpdater: {
      // "onlyDownload": Capgo auto-downloads new bundles but does NOT mark them as
      // the "next" bundle.  This prevents CapacitorUpdaterPlugin.installNext() from
      // reloading the WebView on every appMovedToBackground() event, which was the
      // cause of the apparent cold-restart on minimize / photo-picker / CCT return.
      // We apply downloaded bundles manually at the next cold start (index.js).
      autoUpdate: "onlyDownload",
      updateUrl: "https://api.capgo.app/updates",
      statsUrl: "https://api.capgo.app/stats",
      channelUrl: "https://api.capgo.app/channel_self",
    },
    PushNotifications: {
      presentationOptions: [],
    },
  },
};

export default config;
