import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sen.app',
  appName: 'SEN',
  webDir: 'public',
  bundledWebRuntime: false,
  server: { androidScheme: 'https' },
};

export default config;
