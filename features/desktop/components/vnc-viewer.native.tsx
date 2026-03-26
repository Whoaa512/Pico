import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
    type LayoutChangeEvent,
    type NativeSyntheticEvent,
    type TextInputChangeEventData,
    type TextInputKeyPressEventData,
} from 'react-native';
import {
    Canvas,
    Image,
    Circle,
    Skia,
    AlphaType,
    ColorType,
    type SkImage,
} from '@shopify/react-native-skia';
import {
    GestureDetector,
    Gesture,
    GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { vnc } from '@pi-ui/client';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    useVncSession,
    type FramebufferUpdateEvent,
    type DisplayInitEvent,
} from '../hooks/use-vnc-session';

interface VncViewerProps {
    serverUrl: string;
    accessToken: string;
    vncPort: number;
    vncPassword?: string | null;
    onToggleFullscreen?: (fullscreen: boolean) => void;
}

const CURSOR_RADIUS = 6;
const CURSOR_COLOR = 'rgba(255, 80, 80, 0.8)';
const CURSOR_BORDER_COLOR = 'rgba(255, 255, 255, 0.9)';
const LONG_PRESS_MS = 500;
const TAP_MOVE_THRESHOLD = 8;
const TRACKPAD_SENSITIVITY = 1.5;

export function VncViewer({
    serverUrl,
    accessToken,
    vncPassword,
    onToggleFullscreen,
}: VncViewerProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const [immersive, setImmersive] = useState(false);
    const [kbdVisible, setKbdVisible] = useState(false);
    const [skImage, setSkImage] = useState<SkImage | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    const inputRef = useRef<TextInput>(null);
    const lastTextRef = useRef('______');

    const framebufferRef = useRef<Uint8ClampedArray | null>(null);
    const fbWidthRef = useRef(0);
    const fbHeightRef = useRef(0);

    const cursorXRef = useRef(0);
    const cursorYRef = useRef(0);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const buttonMaskRef = useRef(0);
    const prevTranslationRef = useRef({ x: 0, y: 0 });
    const prevScrollYRef = useRef(0);

    const wsUrl = useMemo(() => {
        const url = new URL(serverUrl);
        const wsScheme = url.protocol === 'https:' ? 'wss' : 'ws';
        return `${wsScheme}://${url.host}/api/desktop/ws?access_token=${encodeURIComponent(accessToken)}`;
    }, [serverUrl, accessToken]);

    const blitRect = useCallback((
        fb: Uint8ClampedArray,
        fbW: number,
        rect: { x: number; y: number; width: number; height: number; rgba: Uint8ClampedArray },
    ) => {
        for (let row = 0; row < rect.height; row++) {
            const srcStart = row * rect.width * 4;
            const dstStart = ((rect.y + row) * fbW + rect.x) * 4;
            fb.set(rect.rgba.subarray(srcStart, srcStart + rect.width * 4), dstStart);
        }
    }, []);

    const copyRect = useCallback((
        fb: Uint8ClampedArray,
        fbW: number,
        rect: { x: number; y: number; width: number; height: number; srcX: number; srcY: number },
    ) => {
        const tmp = new Uint8ClampedArray(rect.width * rect.height * 4);
        for (let row = 0; row < rect.height; row++) {
            const srcStart = ((rect.srcY + row) * fbW + rect.srcX) * 4;
            const tmpStart = row * rect.width * 4;
            tmp.set(fb.subarray(srcStart, srcStart + rect.width * 4), tmpStart);
        }
        for (let row = 0; row < rect.height; row++) {
            const dstStart = ((rect.y + row) * fbW + rect.x) * 4;
            const tmpStart = row * rect.width * 4;
            fb.set(tmp.subarray(tmpStart, tmpStart + rect.width * 4), dstStart);
        }
    }, []);

    const buildSkImage = useCallback((fb: Uint8ClampedArray, width: number, height: number): SkImage | null => {
        const data = Skia.Data.fromBytes(new Uint8Array(fb.buffer, fb.byteOffset, fb.byteLength));
        return Skia.Image.MakeImage(
            {
                width,
                height,
                alphaType: AlphaType.Opaque,
                colorType: ColorType.RGBA_8888,
            },
            data,
            width * 4,
        );
    }, []);

    const handleFramebufferUpdate = useCallback((event: FramebufferUpdateEvent) => {
        let fb = framebufferRef.current;
        const fbW = fbWidthRef.current;
        const fbH = fbHeightRef.current;

        if (!fb || fbW !== event.width || fbH !== event.height) {
            fb = new Uint8ClampedArray(event.width * event.height * 4);
            framebufferRef.current = fb;
            fbWidthRef.current = event.width;
            fbHeightRef.current = event.height;
        }

        for (const rect of event.rects) {
            if (rect.kind === 'rgba') {
                blitRect(fb, event.width, rect);
            } else if (rect.kind === 'copy') {
                copyRect(fb, event.width, rect);
            } else if (rect.kind === 'resize') {
                const newFb = new Uint8ClampedArray(rect.width * rect.height * 4);
                framebufferRef.current = newFb;
                fbWidthRef.current = rect.width;
                fbHeightRef.current = rect.height;
                fb = newFb;
            }
        }

        const img = buildSkImage(fb, fbWidthRef.current, fbHeightRef.current);
        if (img) {
            setSkImage(img);
        }
    }, [blitRect, copyRect, buildSkImage]);

    const handleDisplayInit = useCallback((event: DisplayInitEvent) => {
        const fb = new Uint8ClampedArray(event.width * event.height * 4);
        framebufferRef.current = fb;
        fbWidthRef.current = event.width;
        fbHeightRef.current = event.height;
        cursorXRef.current = Math.floor(event.width / 2);
        cursorYRef.current = Math.floor(event.height / 2);
        setCursorPos({ x: cursorXRef.current, y: cursorYRef.current });
    }, []);

    const session = useVncSession({
        wsUrl,
        password: vncPassword,
        autoConnect: true,
        onFramebufferUpdate: handleFramebufferUpdate,
        onDisplayInit: handleDisplayInit,
    });

    const clampCursor = useCallback(() => {
        cursorXRef.current = Math.max(0, Math.min(fbWidthRef.current - 1, cursorXRef.current));
        cursorYRef.current = Math.max(0, Math.min(fbHeightRef.current - 1, cursorYRef.current));
    }, []);

    const scale = useMemo(() => {
        if (session.framebufferWidth === 0 || session.framebufferHeight === 0) return 1;
        if (canvasSize.width === 0 || canvasSize.height === 0) return 1;
        return vnc.computeContainedRemoteDisplayScale(
            canvasSize.width, canvasSize.height,
            session.framebufferWidth, session.framebufferHeight,
        );
    }, [canvasSize, session.framebufferWidth, session.framebufferHeight]);

    const imageLayout = useMemo(() => {
        const w = session.framebufferWidth * scale;
        const h = session.framebufferHeight * scale;
        const x = (canvasSize.width - w) / 2;
        const y = (canvasSize.height - h) / 2;
        return { x, y, width: w, height: h };
    }, [scale, canvasSize, session.framebufferWidth, session.framebufferHeight]);

    const cursorScreen = useMemo(() => ({
        x: imageLayout.x + cursorPos.x * scale,
        y: imageLayout.y + cursorPos.y * scale,
    }), [cursorPos, scale, imageLayout]);

    const panGesture = useMemo(() =>
        Gesture.Pan()
            .minDistance(0)
            .onStart(() => {
                prevTranslationRef.current = { x: 0, y: 0 };
            })
            .onUpdate((e) => {
                const deltaX = e.translationX - prevTranslationRef.current.x;
                const deltaY = e.translationY - prevTranslationRef.current.y;
                prevTranslationRef.current = { x: e.translationX, y: e.translationY };
                cursorXRef.current += deltaX / scale * TRACKPAD_SENSITIVITY;
                cursorYRef.current += deltaY / scale * TRACKPAD_SENSITIVITY;
                clampCursor();
                const x = Math.floor(cursorXRef.current);
                const y = Math.floor(cursorYRef.current);
                setCursorPos({ x, y });
                session.sendPointerEvent(buttonMaskRef.current, x, y);
            })
            .onEnd(() => {
                if (buttonMaskRef.current !== 0) {
                    buttonMaskRef.current = 0;
                    session.sendPointerEvent(0, Math.floor(cursorXRef.current), Math.floor(cursorYRef.current));
                }
            }),
        [scale, clampCursor, session],
    );

    const tapGesture = useMemo(() =>
        Gesture.Tap()
            .maxDuration(250)
            .maxDistance(TAP_MOVE_THRESHOLD)
            .onEnd(() => {
                const x = Math.floor(cursorXRef.current);
                const y = Math.floor(cursorYRef.current);
                session.sendPointerEvent(1, x, y);
                setTimeout(() => session.sendPointerEvent(0, x, y), 50);
            }),
        [session],
    );

    const longPressGesture = useMemo(() =>
        Gesture.LongPress()
            .minDuration(LONG_PRESS_MS)
            .onStart(() => {
                const x = Math.floor(cursorXRef.current);
                const y = Math.floor(cursorYRef.current);
                session.sendPointerEvent(4, x, y);
                setTimeout(() => session.sendPointerEvent(0, x, y), 100);
            }),
        [session],
    );

    const twoFingerPanGesture = useMemo(() =>
        Gesture.Pan()
            .minPointers(2)
            .maxPointers(2)
            .onStart(() => {
                prevScrollYRef.current = 0;
            })
            .onUpdate((e) => {
                const deltaY = e.translationY - prevScrollYRef.current;
                prevScrollYRef.current = e.translationY;
                const x = Math.floor(cursorXRef.current);
                const y = Math.floor(cursorYRef.current);
                if (Math.abs(deltaY) > 2) {
                    session.sendWheelEvent(deltaY, x, y, 0);
                }
            }),
        [session],
    );

    const composedGesture = useMemo(() =>
        Gesture.Race(
            twoFingerPanGesture,
            Gesture.Exclusive(longPressGesture, tapGesture, panGesture),
        ),
        [panGesture, tapGesture, longPressGesture, twoFingerPanGesture],
    );

    const handleCanvasLayout = useCallback((e: LayoutChangeEvent) => {
        setCanvasSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
    }, []);

    const handleToggleKeyboard = useCallback(() => {
        const next = !kbdVisible;
        setKbdVisible(next);
        if (next) {
            setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            inputRef.current?.blur();
        }
    }, [kbdVisible]);

    const handleToggleFullscreen = useCallback(() => {
        const next = !immersive;
        setImmersive(next);
        onToggleFullscreen?.(next);
    }, [immersive, onToggleFullscreen]);

    const handleTextChange = useCallback((e: NativeSyntheticEvent<TextInputChangeEventData>) => {
        const newText = e.nativeEvent.text;
        const oldText = lastTextRef.current;

        if (newText.length > oldText.length) {
            const added = newText.slice(oldText.length);
            for (const ch of added) {
                const code = ch.codePointAt(0);
                if (code != null) {
                    const keysym = code <= 0xff ? code : (0x01000000 | code) >>> 0;
                    session.sendKeyEvent(true, keysym);
                    session.sendKeyEvent(false, keysym);
                }
            }
        } else if (newText.length < oldText.length) {
            const deleted = oldText.length - newText.length;
            for (let i = 0; i < deleted; i++) {
                session.sendKeyEvent(true, 0xff08);
                session.sendKeyEvent(false, 0xff08);
            }
        }

        lastTextRef.current = newText;
    }, [session]);

    const handleKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const { key } = e.nativeEvent;
        const keysym = vnc.resolveVncKeysymFromKeyboardEvent({ key });
        if (keysym != null && vnc.KEYSYM_BY_KEY[key]) {
            session.sendKeyEvent(true, keysym);
            session.sendKeyEvent(false, keysym);
        }
    }, [session]);

    const handleInputBlur = useCallback(() => {
        if (kbdVisible) {
            setKbdVisible(false);
        }
    }, [kbdVisible]);

    const handleReconnect = useCallback(() => {
        session.disconnect();
        session.connect();
    }, [session]);

    const isConnected = session.connectionState === 'connected';
    const isConnecting = session.connectionState === 'connecting' || session.connectionState === 'handshaking';
    const showChrome = !isConnected || !!session.error;

    return (
        <GestureHandlerRootView style={styles.root}>
            <KeyboardAvoidingView
                style={styles.root}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <StatusBar hidden={immersive} />

                {showChrome && (
                    <View style={[styles.chromeBar, { backgroundColor: colors.surfaceRaised, borderBottomColor: colors.border }]}>
                        <Text style={[styles.chromeStatus, { color: colors.textSecondary }]} numberOfLines={1}>
                            {session.connectionState === 'error'
                                ? session.error ?? 'Connection error'
                                : isConnecting
                                    ? 'Connecting...'
                                    : 'Disconnected'}
                        </Text>
                        {(session.connectionState === 'disconnected' || session.connectionState === 'error') && (
                            <Pressable
                                onPress={handleReconnect}
                                style={({ pressed }) => [
                                    styles.chromeButton,
                                    { backgroundColor: colors.border, opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <Text style={[styles.chromeButtonText, { color: colors.text }]}>Reconnect</Text>
                            </Pressable>
                        )}
                        {isConnecting && <ActivityIndicator size="small" />}
                    </View>
                )}

                <View style={styles.canvasContainer} onLayout={handleCanvasLayout}>
                    <GestureDetector gesture={composedGesture}>
                        <View style={StyleSheet.absoluteFill}>
                            <Canvas style={StyleSheet.absoluteFill}>
                                {skImage && (
                                    <Image
                                        image={skImage}
                                        x={imageLayout.x}
                                        y={imageLayout.y}
                                        width={imageLayout.width}
                                        height={imageLayout.height}
                                        fit="fill"
                                    />
                                )}
                                {isConnected && (
                                    <>
                                        <Circle
                                            cx={cursorScreen.x}
                                            cy={cursorScreen.y}
                                            r={CURSOR_RADIUS + 1}
                                            color={CURSOR_BORDER_COLOR}
                                        />
                                        <Circle
                                            cx={cursorScreen.x}
                                            cy={cursorScreen.y}
                                            r={CURSOR_RADIUS}
                                            color={CURSOR_COLOR}
                                        />
                                    </>
                                )}
                            </Canvas>
                        </View>
                    </GestureDetector>
                </View>

                {isConnected && !immersive && (
                    <View style={[styles.toolbar, { backgroundColor: colors.surfaceRaised, borderTopColor: colors.border }]}>
                        <Text style={[styles.statusText, { color: colors.textSecondary }]} numberOfLines={1}>
                            {session.framebufferWidth}x{session.framebufferHeight}
                        </Text>
                        <Pressable
                            onPress={handleToggleKeyboard}
                            style={({ pressed }) => [
                                styles.toolbarButton,
                                {
                                    backgroundColor: kbdVisible ? colors.activeIndicator : colors.border,
                                    opacity: pressed ? 0.7 : 1,
                                },
                            ]}
                        >
                            <Text style={[styles.toolbarButtonText, { color: kbdVisible ? colors.background : colors.text }]}>
                                Keyboard
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={handleToggleFullscreen}
                            style={({ pressed }) => [
                                styles.toolbarButton,
                                { backgroundColor: colors.border, opacity: pressed ? 0.7 : 1 },
                            ]}
                        >
                            <Text style={[styles.toolbarButtonText, { color: colors.text }]}>
                                {immersive ? 'Exit' : 'Fullscreen'}
                            </Text>
                        </Pressable>
                    </View>
                )}

                <TextInput
                    ref={inputRef}
                    style={styles.hiddenInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    blurOnSubmit={false}
                    multiline
                    onChange={handleTextChange}
                    onKeyPress={handleKeyPress}
                    onBlur={handleInputBlur}
                    defaultValue="______"
                />
            </KeyboardAvoidingView>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#111',
    },
    chromeBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
        borderBottomWidth: 0.5,
    },
    chromeStatus: {
        flex: 1,
        fontSize: 12,
        fontFamily: Fonts.mono,
    },
    chromeButton: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 4,
    },
    chromeButtonText: {
        fontSize: 12,
        fontFamily: Fonts.sansMedium,
    },
    canvasContainer: {
        flex: 1,
        backgroundColor: '#000',
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
        borderTopWidth: 0.5,
    },
    toolbarButton: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 4,
    },
    toolbarButtonText: {
        fontSize: 12,
        fontFamily: Fonts.sansMedium,
    },
    statusText: {
        flex: 1,
        fontSize: 11,
        fontFamily: Fonts.mono,
    },
    hiddenInput: {
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: 1,
        height: 1,
        opacity: 0.01,
        fontSize: 16,
    },
});
