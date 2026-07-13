import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Font from 'expo-font';
import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { AuthProvider } from '@/src/context/AuthContext';
import { ChatProvider } from '@/src/context/ChatContext';

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

async function loadCustomFonts() {
  try {
    await Font.loadAsync({
      Fredoka: 'https://fonts.gstatic.com/s/fredoka/v14/X7nP4b87HvSqjb_WIi2yDCRwoQ_k7367_B-i2yQag0-mac3O8SLMFuOL.ttf',
      Nunito: 'https://fonts.gstatic.com/s/nunito/v26/XRXV3I6Li01BKofINeaBTMnFcQIG.ttf',
    });
  } catch {}
}

export default function RootLayout() {
  const [iconsLoaded, iconError] = useIconFonts();
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => { loadCustomFonts().finally(() => setFontsReady(true)); }, []);

  useEffect(() => {
    if ((iconsLoaded || iconError) && fontsReady) SplashScreen.hideAsync();
  }, [iconsLoaded, iconError, fontsReady]);

  if (!iconsLoaded && !iconError) return null;
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ChatProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
        </ChatProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
