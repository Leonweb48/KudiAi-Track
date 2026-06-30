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
    },
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#1B2A5E',
    },
  },
};

export default config;
