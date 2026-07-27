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
    SplashScreen: {
      launchShowDuration: 1800,
      backgroundColor: "#000d1b",
      androidSplashResourceName: "splash",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    CapacitorUpdater: {
      autoUpdate: true,
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
