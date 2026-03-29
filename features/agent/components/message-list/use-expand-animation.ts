import { useCallback, useRef, useState } from "react";
import { LayoutAnimation, Platform } from "react-native";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
} from "react-native-reanimated";

const EXPAND_DURATION = 280;
const EXPAND_EASING = Easing.out(Easing.cubic);
const IS_WEB = Platform.OS === "web";

const NATIVE_ANIM = LayoutAnimation.create(
  200,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

function animateLayoutNative() {
  LayoutAnimation.configureNext(NATIVE_ANIM);
}

interface UseExpandAnimationOptions {
  initialExpanded?: boolean;
}

export function useExpandAnimation(options?: UseExpandAnimationOptions) {
  const initialExpanded = options?.initialExpanded ?? false;
  const [expanded, setExpanded] = useState(initialExpanded);
  const [shouldRender, setShouldRender] = useState(initialExpanded);
  const measuredHeight = useSharedValue(0);
  const progress = useSharedValue(initialExpanded ? 1 : 0);
  const chevronRotation = useSharedValue(initialExpanded ? 1 : 0);
  const pendingExpand = useRef(false);

  const startExpandAnimation = useCallback(() => {
    progress.value = withTiming(1, {
      duration: EXPAND_DURATION,
      easing: EXPAND_EASING,
    });
  }, [progress]);

  const onMeasure = useCallback(
    (height: number) => {
      if (height <= 0) return;
      if (pendingExpand.current) {
        measuredHeight.value = height;
        pendingExpand.current = false;
        startExpandAnimation();
      } else {
        measuredHeight.value = height;
      }
    },
    [measuredHeight, startExpandAnimation],
  );

  const expand = useCallback(() => {
    if (!IS_WEB) animateLayoutNative();
    setShouldRender(true);
    setExpanded(true);
    chevronRotation.value = withTiming(1, {
      duration: 200,
      easing: EXPAND_EASING,
    });
    if (IS_WEB) {
      if (measuredHeight.value > 0) {
        startExpandAnimation();
      } else {
        pendingExpand.current = true;
      }
    } else {
      progress.value = 1;
    }
  }, [chevronRotation, measuredHeight, startExpandAnimation, progress]);

  const collapse = useCallback(() => {
    if (!IS_WEB) animateLayoutNative();
    setExpanded(false);
    pendingExpand.current = false;
    chevronRotation.value = withTiming(0, {
      duration: 200,
      easing: EXPAND_EASING,
    });
    if (IS_WEB) {
      progress.value = withTiming(
        0,
        { duration: EXPAND_DURATION, easing: EXPAND_EASING },
        (finished) => {
          if (finished) {
            runOnJS(setShouldRender)(false);
          }
        },
      );
    } else {
      progress.value = 0;
      setShouldRender(false);
    }
  }, [progress, chevronRotation]);

  const toggle = useCallback(() => {
    if (expanded) collapse();
    else expand();
  }, [expanded, expand, collapse]);

  const containerStyle = useAnimatedStyle(() => {
    if (!IS_WEB) {
      return {};
    }
    const h = measuredHeight.value;
    const p = progress.value;
    if (p >= 0.99) {
      return { opacity: 1 };
    }
    return {
      height: h > 0 ? h * p : 0,
      opacity: p,
      overflow: "hidden" as const,
    };
  });

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value * 90}deg` }],
  }));

  return {
    expanded,
    shouldRender,
    expand,
    collapse,
    toggle,
    onMeasure,
    containerStyle,
    chevronStyle,
  };
}
