import { LoginScreen } from '@/components/auth/login-screen';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Paper } from '@/constants/paper-theme';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

/** Light navigation theme only — app is paper aesthetic; never use DarkTheme here. */
const paperNavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Paper.background,
    card: Paper.background,
    text: Paper.text,
    primary: Paper.accent,
  },
};

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <ThemeProvider value={paperNavigationTheme}>
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Paper.background }}>
          <ActivityIndicator size="large" color={Paper.accent} />
        </View>
        <StatusBar style="dark" />
      </ThemeProvider>
    );
  }

  if (!session) {
    return (
      <ThemeProvider value={paperNavigationTheme}>
        <LoginScreen />
        <StatusBar style="dark" />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={paperNavigationTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Paper.background },
        }}>
        <Stack.Screen name="index" />
      </Stack>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
