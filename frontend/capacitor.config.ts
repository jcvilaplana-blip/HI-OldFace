import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oldface.app',
  appName: 'OldFace',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Para desarrollo en dispositivo, descomenta y pon tu IP:
    // url: 'http://192.168.1.100:5173',
    // cleartext: true
  },
  plugins: {
    // Geolocalización
    Geolocation: {
      requestAlwaysPermission: false
    },
    // Push Notifications
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    // Browser (para POLL)
    Browser: {
      scheme: 'https'
    }
  },
  // iOS
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff'
  },
  // Android
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false
  }
};

export default config;
