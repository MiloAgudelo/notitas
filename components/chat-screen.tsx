import {
  deleteMessage,
  fetchRecentMessages,
  insertMessage,
  type MessageRow,
  subscribeToMessagesRealtime,
  updateMessage,
} from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import {
  getChatGreetingTypewriterWords,
  getCoupleDisplayName,
  getInputPlaceholder,
  getTimeOfDayGreeting,
} from '@/constants/couple';
import { bubblePaperShadow, Paper, paperRoundedFont } from '@/constants/paper-theme';
import { Fonts } from '@/constants/theme';
import { LoginTypewriterLine } from '@/components/auth/login-typewriter-line';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type GestureResponderEvent,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

function makeTempId(): string {
  const c = globalThis.crypto;
  return `temp:${c?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

const RADIAL_BTN = 50;
const RADIAL_BTN_HALF = RADIAL_BTN / 2;
/** Radio del círculo donde se colocan los centros de los botones. */
const RADIAL_RADIUS = 70;
/** Ambos iconos a la izquierda del ancla (cos θ < 0), un poco más separados en el arco. */
const RADIAL_ANGLE_EDIT_DEG = 212;
const RADIAL_ANGLE_TRASH_DEG = 154;

const RADIAL_OPEN_MS = 240;
const RADIAL_OPEN_EASING = Easing.out(Easing.cubic);
const RADIAL_BTN_STAGGER_MS = 42;
/** Escala inicial sutil (sin “pop” fuerte). */
const RADIAL_BTN_SCALE_FROM = 0.88;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Dos botones en un arco del mismo lado (izquierda del dedo): lápiz un poco más arriba, papelera más abajo.
 */
function radialButtonPositions(
  anchorX: number,
  anchorY: number,
  windowWidth: number,
  windowHeight: number,
) {
  const pad = 10;
  const maxL = windowWidth - pad - RADIAL_BTN;
  const maxT = windowHeight - pad - RADIAL_BTN;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const editCx = anchorX + RADIAL_RADIUS * Math.cos(rad(RADIAL_ANGLE_EDIT_DEG));
  const editCy = anchorY + RADIAL_RADIUS * Math.sin(rad(RADIAL_ANGLE_EDIT_DEG));
  const delCx = anchorX + RADIAL_RADIUS * Math.cos(rad(RADIAL_ANGLE_TRASH_DEG));
  const delCy = anchorY + RADIAL_RADIUS * Math.sin(rad(RADIAL_ANGLE_TRASH_DEG));
  return {
    edit: {
      left: clamp(editCx - RADIAL_BTN_HALF, pad, maxL),
      top: clamp(editCy - RADIAL_BTN_HALF, pad, maxT),
    },
    trash: {
      left: clamp(delCx - RADIAL_BTN_HALF, pad, maxL),
      top: clamp(delCy - RADIAL_BTN_HALF, pad, maxT),
    },
  };
}

function RadialMenuHub({ anchorX, anchorY }: { anchorX: number; anchorY: number }) {
  const scale = useSharedValue(0.96);
  const opacity = useSharedValue(0);
  useEffect(() => {
    const t = {
      duration: RADIAL_OPEN_MS,
      easing: RADIAL_OPEN_EASING,
    };
    scale.value = withTiming(1, t);
    opacity.value = withTiming(1, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value ref
  }, []);

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.radialHub,
        { left: anchorX - 5, top: anchorY - 5 },
        anim,
      ]}
    />
  );
}

function RadialMenuOrbitButton({
  anchorX,
  anchorY,
  finalLeft,
  finalTop,
  delayMs,
  onPress,
  children,
  extraStyle,
  accessibilityLabel,
}: {
  anchorX: number;
  anchorY: number;
  finalLeft: number;
  finalTop: number;
  delayMs: number;
  onPress: () => void;
  children: ReactNode;
  extraStyle?: object;
  accessibilityLabel: string;
}) {
  const progress = useSharedValue(0);
  const finalCx = finalLeft + RADIAL_BTN_HALF;
  const finalCy = finalTop + RADIAL_BTN_HALF;
  const dx = anchorX - finalCx;
  const dy = anchorY - finalCy;

  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withTiming(1, {
        duration: RADIAL_OPEN_MS,
        easing: RADIAL_OPEN_EASING,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value ref
  }, []);

  const anim = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx * (1 - progress.value) },
      { translateY: dy * (1 - progress.value) },
      {
        scale:
          RADIAL_BTN_SCALE_FROM + (1 - RADIAL_BTN_SCALE_FROM) * progress.value,
      },
    ],
    opacity: progress.value,
  }));

  return (
    <Animated.View
      style={[{ position: 'absolute', left: finalLeft, top: finalTop }, anim]}
      pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={[styles.radialBtn, bubblePaperShadow, extraStyle]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}>
        {children}
      </Pressable>
    </Animated.View>
  );
}


function mergeInsert(prev: MessageRow[], row: MessageRow): MessageRow[] {
  if (prev.some((m) => m.id === row.id)) {
    return prev;
  }
  const tempIdx = prev.findIndex(
    (m) =>
      m.id.startsWith('temp:') &&
      m.sender_id === row.sender_id &&
      m.content === row.content,
  );
  if (tempIdx !== -1) {
    const next = [...prev];
    next[tempIdx] = row;
    return next;
  }
  return [row, ...prev];
}

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  /** Si está definido, el compositor edita ese mensaje (texto en `input`). */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const draftBeforeEditRef = useRef<string | null>(null);
  const composerInputRef = useRef<TextInput>(null);
  const [radialMenu, setRadialMenu] = useState<{
    item: MessageRow;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const radialLayout = useMemo(() => {
    if (!radialMenu) return null;
    return radialButtonPositions(
      radialMenu.anchorX,
      radialMenu.anchorY,
      windowWidth,
      windowHeight,
    );
  }, [radialMenu, windowWidth, windowHeight]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null);
      setUserEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!editingMessageId) return;
    const id = setTimeout(() => composerInputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, [editingMessageId]);

  const displayName = getCoupleDisplayName(userEmail);
  const saludo = getTimeOfDayGreeting();
  const typewriterWords = getChatGreetingTypewriterWords(displayName);
  const welcomeLine = displayName ? `${saludo}, ${displayName}` : saludo;
  const inputPlaceholder = getInputPlaceholder(displayName);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchRecentMessages(supabase, 20);
        if (!cancelled) setMessages(rows);
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'No se pudieron cargar los mensajes.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeToMessagesRealtime(supabase, {
      onInsert: (row) => {
        setMessages((prev) => mergeInsert(prev, row));
      },
      onUpdate: (row) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === row.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = row;
          return next;
        });
      },
      onDelete: (id) => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      },
    });
    return unsub;
  }, []);

  const handleDelete = useCallback(
    (item: MessageRow) => {
      if (!currentUserId) return;
      const id = item.id;
      let previous: MessageRow[] = [];
      setMessages((prev) => {
        previous = prev;
        return prev.filter((m) => m.id !== id);
      });
      void deleteMessage(supabase, { id, sender_id: currentUserId }).catch((e) => {
        console.error(e);
        setMessages(previous);
        Alert.alert('Error', 'No se pudo eliminar el mensaje.');
      });
    },
    [currentUserId],
  );

  const openRadialMenu = useCallback(
    (item: MessageRow, e: GestureResponderEvent) => {
      if (!currentUserId || item.sender_id !== currentUserId || item.id.startsWith('temp:')) {
        return;
      }
      void Haptics.selectionAsync();
      const { pageX, pageY } = e.nativeEvent;
      setRadialMenu({ item, anchorX: pageX, anchorY: pageY });
    },
    [currentUserId],
  );

  const cancelEdit = useCallback(() => {
    setInput(draftBeforeEditRef.current ?? '');
    draftBeforeEditRef.current = null;
    setEditingMessageId(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingMessageId || !currentUserId) return;
    const text = input.trim();
    if (!text) {
      Alert.alert('Vacío', 'Escribe algo o cancela.');
      return;
    }
    const id = editingMessageId;
    draftBeforeEditRef.current = null;
    setEditingMessageId(null);
    setInput('');

    let previous: MessageRow[] = [];
    setMessages((prev) => {
      previous = prev;
      return prev.map((m) => (m.id === id ? { ...m, content: text } : m));
    });
    try {
      await updateMessage(supabase, { id, content: text, sender_id: currentUserId });
      Keyboard.dismiss();
    } catch (e) {
      console.error(e);
      setMessages(previous);
      Alert.alert('Error', 'No se pudo guardar el mensaje.');
    }
  }, [editingMessageId, input, currentUserId]);

  const send = useCallback(async () => {
    if (editingMessageId) return;
    const text = input.trim();
    if (!text || sending) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Sesión', 'No hay usuario autenticado.');
      return;
    }

    const tempId = makeTempId();
    const now = new Date().toISOString();
    const optimistic: MessageRow = {
      id: tempId,
      created_at: now,
      content: text,
      sender_id: user.id,
    };

    setInput('');
    setSending(true);
    setMessages((prev) => [optimistic, ...prev]);

    try {
      const saved = await insertMessage(supabase, { content: text, sender_id: user.id });
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === tempId);
        if (idx === -1) return mergeInsert(prev, saved);
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
    } catch (e) {
      console.error(e);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Error', 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  }, [input, sending, editingMessageId]);

  const keyboardVerticalOffset = Platform.OS === 'ios' ? insets.top : 0;

  if (loading) {
    return (
      <SafeAreaView style={[styles.flex, styles.root]} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Paper.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, styles.root]} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={keyboardVerticalOffset}>
        <View style={[styles.welcomeHeader, { paddingTop: Math.max(insets.top, 10) }]}>
          <Image
            source={require('@/assets/images/couple-picture.png')}
            style={styles.avatar}
            contentFit="cover"
            transition={200}
          />
          {typewriterWords.length > 0 ? (
            <LoginTypewriterLine
              prefix={`${saludo}, `}
              words={typewriterWords}
              fontFamily={Fonts.rounded}
              fontFamilyBold={Fonts.rounded}
              compact
            />
          ) : (
            <Text style={[styles.welcomeText, paperRoundedFont]} numberOfLines={2}>
              {welcomeLine}
            </Text>
          )}
          <Pressable
            onPress={() => supabase.auth.signOut()}
            hitSlop={14}
            style={styles.signOutIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión">
            <Ionicons name="log-out-outline" size={22} color={Paper.textMuted} />
          </Pressable>
        </View>

        <FlatList
          style={styles.flex}
          data={messages}
          inverted
          /** Android + inverted suele recortar celdas mal si está activo (texto cortado en burbujas). */
          removeClippedSubviews={false}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const mine = currentUserId != null && item.sender_id === currentUserId;
            const canManage = mine && !item.id.startsWith('temp:');
            const bubble = (
              <View
                style={[
                  styles.bubble,
                  bubblePaperShadow,
                  mine ? styles.bubbleMine : styles.bubbleOther,
                ]}>
                <Text style={[styles.bubbleText, paperRoundedFont]}>{item.content}</Text>
              </View>
            );
            return (
              <View
                style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
                {canManage ? (
                  <View
                    style={mine ? styles.bubbleWrapMine : styles.bubbleWrapOther}
                    collapsable={false}>
                    {bubble}
                    <Pressable
                      onLongPress={(e) => openRadialMenu(item, e)}
                      delayLongPress={450}
                      accessibilityRole="button"
                      accessibilityLabel="Menú del mensaje. Mantén pulsado para editar o eliminar."
                      {...(Platform.OS === 'android' ? { android_ripple: null } : {})}
                      style={styles.bubbleLongPressOverlay}
                    />
                  </View>
                ) : (
                  bubble
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={[styles.empty, paperRoundedFont]}>
              Aún no hay mensajes. ¡Escribe el primero!
            </Text>
          }
        />

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {editingMessageId ? (
            <Pressable
              onPress={cancelEdit}
              style={styles.composerCancelBtn}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Cancelar edición">
              <Ionicons name="close-circle-outline" size={26} color={Paper.textMuted} />
            </Pressable>
          ) : null}
          <TextInput
            ref={composerInputRef}
            style={[styles.input, paperRoundedFont, editingMessageId && styles.inputEditing]}
            placeholder={editingMessageId ? 'Edita el mensaje…' : inputPlaceholder}
            placeholderTextColor={Paper.textMuted}
            value={input}
            onChangeText={setInput}
            editable={!sending}
            multiline
          />
          <Pressable
            style={[
              styles.sendBtn,
              sending && styles.sendBtnDisabled,
              editingMessageId && styles.sendBtnConfirm,
            ]}
            onPress={editingMessageId ? () => void saveEdit() : send}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel={editingMessageId ? 'Confirmar edición' : 'Enviar mensaje'}>
            <Ionicons
              name={editingMessageId ? 'checkmark' : 'send'}
              size={26}
              color={editingMessageId ? Paper.text : Paper.sendHeart}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={radialMenu !== null}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setRadialMenu(null)}>
        <View style={styles.radialRoot} pointerEvents="box-none">
          <Pressable
            style={styles.radialBackdrop}
            onPress={() => setRadialMenu(null)}
            accessibilityRole="button"
            accessibilityLabel="Cerrar menú"
          />
          {radialMenu && radialLayout ? (
            <>
              <RadialMenuHub
                anchorX={radialMenu.anchorX}
                anchorY={radialMenu.anchorY}
              />
              <RadialMenuOrbitButton
                anchorX={radialMenu.anchorX}
                anchorY={radialMenu.anchorY}
                finalLeft={radialLayout.edit.left}
                finalTop={radialLayout.edit.top}
                delayMs={0}
                accessibilityLabel="Editar mensaje"
                onPress={() => {
                  const msg = radialMenu.item;
                  setRadialMenu(null);
                  draftBeforeEditRef.current = input;
                  setEditingMessageId(msg.id);
                  setInput(msg.content);
                }}>
                <Ionicons name="pencil" size={22} color={Paper.text} />
              </RadialMenuOrbitButton>
              <RadialMenuOrbitButton
                anchorX={radialMenu.anchorX}
                anchorY={radialMenu.anchorY}
                finalLeft={radialLayout.trash.left}
                finalTop={radialLayout.trash.top}
                delayMs={RADIAL_BTN_STAGGER_MS}
                accessibilityLabel="Eliminar mensaje"
                extraStyle={styles.radialBtnDanger}
                onPress={() => {
                  const msg = radialMenu.item;
                  setRadialMenu(null);
                  handleDelete(msg);
                }}>
                <Ionicons name="trash-outline" size={22} color="#B54545" />
              </RadialMenuOrbitButton>
            </>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { backgroundColor: Paper.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  welcomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 12,
    backgroundColor: Paper.background,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: Paper.accent,
  },
  welcomeText: {
    flex: 1,
    color: Paper.text,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
  },
  signOutIconBtn: { padding: 6 },
  listContent: { paddingHorizontal: 14, paddingVertical: 8, flexGrow: 1 },
  bubbleRow: {
    marginVertical: 5,
    maxWidth: '100%',
  },
  bubbleRowMine: { alignItems: 'flex-end' },
  bubbleRowOther: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  bubbleWrapMine: {
    alignSelf: 'flex-end',
  },
  bubbleWrapOther: {
    alignSelf: 'flex-start',
  },
  bubbleLongPressOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    zIndex: 1,
  },
  bubbleText: {
    color: Paper.text,
    fontSize: 16,
    lineHeight: 22,
  },
  bubbleMine: {
    backgroundColor: Paper.bubbleMine,
  },
  bubbleOther: {
    backgroundColor: Paper.bubbleOtherBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Paper.bubbleOtherBorder,
  },
  empty: {
    textAlign: 'center',
    color: Paper.textMuted,
    padding: 24,
    fontSize: 15,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: Paper.background,
  },
  input: {
    flex: 1,
    backgroundColor: Paper.inputBg,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 16,
    maxHeight: 220,
    color: Paper.text,
    borderWidth: 1,
    borderColor: Paper.bubbleOtherBorder,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Paper.inputBg,
    borderWidth: 1,
    borderColor: Paper.bubbleOtherBorder,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnConfirm: {
    backgroundColor: Paper.bubbleMine,
    borderColor: Paper.accent,
  },
  composerCancelBtn: {
    paddingBottom: 10,
    justifyContent: 'center',
  },
  inputEditing: {
    borderColor: Paper.accent,
    borderWidth: 1.5,
  },
  radialRoot: {
    flex: 1,
  },
  radialBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  radialHub: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Paper.accent,
    borderWidth: 2,
    borderColor: Paper.inputBg,
    opacity: 0.95,
    zIndex: 1,
  },
  radialBtn: {
    position: 'absolute',
    width: RADIAL_BTN,
    height: RADIAL_BTN,
    borderRadius: RADIAL_BTN / 2,
    backgroundColor: Paper.inputBg,
    borderWidth: 1,
    borderColor: Paper.bubbleOtherBorder,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  radialBtnDanger: {
    borderColor: '#EEC8C8',
    backgroundColor: '#FFF8F8',
  },
});
