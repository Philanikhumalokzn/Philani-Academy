import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.philani.academy',
  appName: 'Philani Academy',
  webDir: 'out',
  server: {
    url: 'https://philaniacademy.org'
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffffff',
      overlaysWebView: true,
    },
  }
};

export default config;
