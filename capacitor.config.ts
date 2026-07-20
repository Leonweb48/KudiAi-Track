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
