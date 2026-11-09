import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.agrimball.selahmemory',
  appName: 'Selah Memory',
  webDir: 'dist/bible-memory/browser',
  backgroundColor: '#0b1120',
  android: {
    backgroundColor: '#0b1120',
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#0b1120',
    contentInset: 'always',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
      overlaysWebView: false,
    },
  },
};

export default config;
