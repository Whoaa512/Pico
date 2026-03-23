import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { Fonts } from "@/constants/theme";
import type { DiffTab } from "./context";

interface DiffTabBarProps {
  tabs: DiffTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  isDark: boolean;
}

export const DiffTabBar = memo(function DiffTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  isDark,
}: DiffTabBarProps) {
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#666" : "#999";
  const activeBg = isDark ? "#1E1E1E" : "#FFFFFF";
  const inactiveBg = isDark ? "#141414" : "#F0F0F0";
  const borderColor = isDark ? "#2A2A2A" : "#E0E0E0";
  const verbColor = isDark ? "#888" : "#888";

  return (
    <View style={[s.container, { borderBottomColor: borderColor }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onSelect(tab.id)}
              style={[
                s.tab,
                {
                  backgroundColor: isActive ? activeBg : inactiveBg,
                  borderBottomColor: isActive ? activeBg : borderColor,
                },
              ]}
            >
              <Text
                style={[s.verb, { color: verbColor }]}
                numberOfLines={1}
              >
                {tab.toolName === "edit" ? "E" : "W"}
              </Text>
              <Text
                style={[
                  s.fileName,
                  { color: isActive ? textColor : mutedColor },
                ]}
                numberOfLines={1}
              >
                {tab.fileName}
              </Text>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                hitSlop={6}
                style={({ hovered }: any) => [
                  s.closeBtn,
                  hovered && { backgroundColor: isDark ? "#333" : "#E0E0E0" },
                ]}
              >
                <X
                  size={10}
                  color={isActive ? mutedColor : isDark ? "#555" : "#BBB"}
                  strokeWidth={2}
                />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

const s = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    flexDirection: "row",
  },
  scrollContent: {
    flexDirection: "row",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 2,
    maxWidth: 180,
  },
  verb: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  fileName: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
    flexShrink: 1,
  },
  closeBtn: {
    width: 16,
    height: 16,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
});
