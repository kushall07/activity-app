import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Text, type ColorValue } from 'react-native';
import { onBeforeSignOut, useApp } from '../../auth/AppContext';
import { Loading } from '../../components/ui';
import { registerForPush, unregisterPush } from '../../lib/push';
import { useMe } from '../../lib/useMe';
import { colors } from '../../theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

/** Main app once onboarding is done: Explore, My plans, Post (centre), Chats, Profile. */
export default function TabsLayout() {
  const { api, status } = useApp();
  const me = useMe();
  const ready = status === 'signedIn' && !!me.data?.onboarding.complete;

  // Ask for notifications once the member is in the app (not during onboarding).
  useEffect(() => {
    if (!ready) return;
    void registerForPush(api);
    return onBeforeSignOut(unregisterPush);
  }, [api, ready]);

  if (status === 'signedOut') return <Redirect href="/login" />;
  if (me.data && !me.data.onboarding.complete) return <Redirect href="/" />;
  if (!me.data) return <Loading />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="explore" options={{ title: 'Explore', tabBarIcon: icon('🧭') }} />
      <Tabs.Screen name="plans" options={{ title: 'My plans', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="post" options={{ title: 'Post', tabBarIcon: icon('➕') }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: icon('💬') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
