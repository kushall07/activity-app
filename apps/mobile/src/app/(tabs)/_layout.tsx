import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';
import { useApp } from '../../auth/AppContext';
import { Loading } from '../../components/ui';
import { useMe } from '../../lib/useMe';
import { colors } from '../../theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

/** Main app once onboarding is done: Explore, Post (centre), My plans, Profile. */
export default function TabsLayout() {
  const { status } = useApp();
  const me = useMe();
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
      <Tabs.Screen name="post" options={{ title: 'Post', tabBarIcon: icon('➕') }} />
      <Tabs.Screen name="plans" options={{ title: 'My plans', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
