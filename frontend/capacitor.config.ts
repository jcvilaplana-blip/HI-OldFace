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
    allowMixedContent: false,
    // Necesario para la ubicación del conductor en segundo plano (taxi): sin esto Android corta
    // las posiciones a los 5 minutos con la app en segundo plano (@capacitor-community/background-geolocation)
    useLegacyBridge: true
  }
};

export default config;
