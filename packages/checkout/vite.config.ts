import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plain web build — no react-native-web plugin. `packages/checkout` exists
// specifically to avoid the Expo/RN-Web bundle weight (Bloom, NativeWind,
// react-native-web) for anonymous payers who need a fast first paint. See
// spec §6.
export default defineConfig({
  plugins: [react()],
});
