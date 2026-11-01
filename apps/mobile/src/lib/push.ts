import { pushDataSchema, type PushData, type RegisterDevice } from '@activity/shared';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import type { ApiClient } from './api';

let registered: RegisterDevice | null = null;
/** The chat on screen right now: its message pushes are not shown as banners. */
let visibleChatId: string | null = null;

export function setVisibleChat(chatId: string | null) {
  visibleChatId = chatId;
}

/** Where a tapped notification should take the member. */
export function routeFor(data: PushData): Parameters<typeof router.push>[0] {
  switch (data.kind) {
    case 'request.new':
      return { pathname: '/requests/[planId]', params: { planId: data.planId } };
    case 'request.accepted':
    case 'chat.message':
      return { pathname: '/chat/[id]', params: { id: data.chatId } };
    case 'plan.cancelled':
      return { pathname: '/plan/[id]', params: { id: data.planId } };
  }
}

/** Foreground behaviour and taps. Call once at startup. */
export function configureNotifications(): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const parsed = pushDataSchema.safeParse(n.request.content.data);
      const hide =
        parsed.success &&
        parsed.data.kind === 'chat.message' &&
        parsed.data.chatId === visibleChatId;
      return {
        shouldShowBanner: !hide,
        shouldShowList: !hide,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const parsed = pushDataSchema.safeParse(response.notification.request.content.data);
    if (parsed.success) router.push(routeFor(parsed.data));
  });
  return () => sub.remove();
}

/**
 * Asks for permission (once) and registers the native push token with the API.
 * Uses the raw FCM/APNs token because the backend sends through Amazon SNS,
 * not Expo's push service. Never throws: push is optional.
 */
export async function registerForPush(api: ApiClient): Promise<void> {
  try {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Plans and chats',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status === 'undetermined') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return;
    const token = await Notifications.getDevicePushTokenAsync();
    const device: RegisterDevice = { platform: Platform.OS, token: String(token.data) };
    await api.registerDevice(device);
    registered = device;
  } catch {
    // Simulators, missing Firebase config in dev builds, no network: try again next launch.
  }
}

/** On sign-out, so the next person on this phone does not get this member's pushes. */
export async function unregisterPush(api: ApiClient): Promise<void> {
  if (!registered) return;
  await api.removeDevice(registered).catch(() => undefined);
  registered = null;
}
