import React, { useMemo, useState } from "react";
import { ActivityIndicator, ImageBackground, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";

import { HamburgerButton } from "@/components/HamburgerButton";
import { TabSwitch } from "@/components/TabSwitch";
import { SideDrawer } from "@/components/SideDrawer";
import { RelaySettingsProvider, useRelaySettings } from "@/context/RelaySettingsContext";
import { ChatScreen } from "@/screens/ChatScreen";
import { ImageScreen } from "@/screens/ImageScreen";
import { MemoryScreen } from "@/screens/MemoryScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";

type Mode = "chat" | "image";
type Page = "home" | "settings" | "memory";

function MainApp() {
  const { settings, isReady } = useRelaySettings();
  const [mode, setMode] = useState<Mode>("chat");
  const [page, setPage] = useState<Page>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const backgroundSource = useMemo(
    () => (settings.chatBackgroundUri ? { uri: settings.chatBackgroundUri } : null),
    [settings.chatBackgroundUri]
  );

  if (!isReady) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#8FB4FF" size="large" />
          <Text style={styles.loadingTitle}>正在加载 Nomi</Text>
        </View>
      </SafeAreaView>
    );
  }

  const screen = page === "settings" ? (
    <SettingsScreen onClose={() => setPage("home")} />
  ) : page === "memory" ? (
    <MemoryScreen onClose={() => setPage("home")} />
  ) : mode === "chat" ? (
    <ChatScreen />
  ) : (
    <ImageScreen />
  );

  const shell = (
    <>
      <View style={styles.dim} />
      <View style={styles.menuButtonWrap}>
        <HamburgerButton onPress={() => setDrawerOpen(true)} />
      </View>
      {page === "home" ? (
        <View style={styles.modeSwitchWrap}>
          <TabSwitch
            value={mode}
            onChange={(nextMode) => {
              setMode(nextMode);
              setPage("home");
            }}
          />
        </View>
      ) : null}
      <View style={styles.screenWrap}>{screen}</View>
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      {backgroundSource ? (
        <ImageBackground source={backgroundSource} style={styles.background} resizeMode="cover">
          {shell}
        </ImageBackground>
      ) : (
        <View style={styles.background}>{shell}</View>
      )}
      <SideDrawer
        open={drawerOpen}
        mode={mode}
        page={page}
        onClose={() => setDrawerOpen(false)}
        onOpenChat={() => {
          setMode("chat");
          setPage("home");
        }}
        onOpenImage={() => {
          setMode("image");
          setPage("home");
        }}
        onOpenSettings={() => {
          setPage("settings");
        }}
        onOpenMemory={() => {
          setPage("memory");
        }}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <RelaySettingsProvider>
      <MainApp />
    </RelaySettingsProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#081120",
  },
  background: {
    flex: 1,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(8, 17, 32, 0.74)",
  },
  menuButtonWrap: {
    position: "absolute",
    top: 12,
    left: 16,
    zIndex: 30,
  },
  modeSwitchWrap: {
    position: "absolute",
    top: 12,
    left: 76,
    right: 76,
    zIndex: 30,
  },
  screenWrap: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingTitle: {
    color: "#DCE6FF",
    fontSize: 15,
    fontWeight: "700",
  },
});
