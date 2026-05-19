import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, BackHandler, ImageBackground, PanResponder, Platform, SafeAreaView, StatusBar, StyleSheet, Text, ToastAndroid, View } from "react-native";

import { HamburgerButton } from "@/components/HamburgerButton";
import { TabSwitch } from "@/components/TabSwitch";
import { SideDrawer } from "@/components/SideDrawer";
import { RelaySettingsProvider, useRelaySettings } from "@/context/RelaySettingsContext";
import { ChatScreen } from "@/screens/ChatScreen";
import { ImageScreen } from "@/screens/ImageScreen";
import { MemoryScreen } from "@/screens/MemoryScreen";
import { TaskBoardScreen } from "@/screens/TaskBoardScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";

type Mode = "chat" | "image";
type Page = "home" | "settings" | "memory" | "tasks";

function MainApp() {
  const { settings, isReady } = useRelaySettings();
  const [mode, setMode] = useState<Mode>("chat");
  const [page, setPage] = useState<Page>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const backgroundSource = useMemo(
    () => (settings.chatBackgroundUri ? { uri: settings.chatBackgroundUri } : null),
    [settings.chatBackgroundUri]
  );
  const chromeAnim = useRef(new Animated.Value(0)).current;
  const tabsAnim = useRef(new Animated.Value(0)).current;
  const menuRowAnim = useRef(new Animated.Value(1)).current;
  const modeAnim = useRef(new Animated.Value(0)).current;
  const lastBackPressRef = useRef(0);

  const statusBarOffset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
  const topBarHeight = statusBarOffset + 56;
  const headerVisible = chromeVisible && !drawerOpen;

  const activateMode = useCallback((nextMode: Mode) => {
    setDrawerOpen(false);
    setPage("home");
    setChromeVisible(true);
    setMode(nextMode);
  }, []);

  useEffect(() => {
    Animated.timing(chromeAnim, {
      toValue: headerVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [chromeAnim, headerVisible]);

  useEffect(() => {
    Animated.timing(menuRowAnim, {
      toValue: headerVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [headerVisible, menuRowAnim]);

  useEffect(() => {
    setChromeVisible(true);
  }, [page]);

  useEffect(() => {
    const shouldShowTabs = page === "home" && headerVisible;
    Animated.timing(tabsAnim, {
      toValue: shouldShowTabs ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [headerVisible, page, tabsAnim]);

  useEffect(() => {
    Animated.timing(modeAnim, {
      toValue: mode === "image" ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [mode, modeAnim]);

  useEffect(() => {
    const onBackPress = () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }

      if (page !== "home") {
        setPage("home");
        setMode("chat");
        setChromeVisible(true);
        return true;
      }

      if (mode !== "chat") {
        setMode("chat");
        setChromeVisible(true);
        return true;
      }

      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastBackPressRef.current = now;
      if (Platform.OS === "android") {
        ToastAndroid.show("再按一次返回键退出", ToastAndroid.SHORT);
      }
      return true;
    };

    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => subscription.remove();
  }, [drawerOpen, mode, page]);

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (drawerOpen) {
            return false;
          }

          return Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
        },
        onPanResponderRelease: (_, gesture) => {
          if (drawerOpen) {
            return;
          }

          if (gesture.dx < -60) {
            if (page === "home") {
              activateMode("image");
            }
            return;
          }

          if (gesture.dx > 60) {
            if (page === "home" && mode === "chat") {
              setDrawerOpen(true);
            } else if (page === "home") {
              activateMode("chat");
            } else {
              setDrawerOpen(true);
            }
          }
        },
      }),
    [activateMode, drawerOpen, mode, page]
  );

  const handleScrollDirection = useCallback(
    (direction: "up" | "down") => {
      if (drawerOpen) {
        return;
      }

      setChromeVisible(direction === "down");
    },
    [drawerOpen]
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

  const homeScreen = (
    <View
      style={[styles.screenLayer, page === "home" ? styles.screenVisible : styles.screenHidden]}
      pointerEvents={page === "home" ? "auto" : "none"}
    >
      <View style={styles.homeStage} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.screenLayer,
            {
              opacity: modeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              }),
              transform: [
                {
                  translateX: modeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -32],
                  }),
                },
              ],
            },
          ]}
          pointerEvents={mode === "chat" ? "auto" : "none"}
        >
          <ChatScreen onScrollDirection={handleScrollDirection} />
        </Animated.View>
        <Animated.View
          style={[
            styles.screenLayer,
            {
              opacity: modeAnim,
              transform: [
                {
                  translateX: modeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [32, 0],
                  }),
                },
              ],
            },
          ]}
          pointerEvents={mode === "image" ? "auto" : "none"}
        >
          <ImageScreen onScrollDirection={handleScrollDirection} />
        </Animated.View>
      </View>
    </View>
  );

  const overlayScreen =
    page === "settings" ? (
      <View style={styles.screenOverlay} pointerEvents="auto">
        <SettingsScreen onClose={() => setPage("home")} onScrollDirection={handleScrollDirection} />
      </View>
    ) : page === "memory" ? (
      <View style={styles.screenOverlay} pointerEvents="auto">
        <MemoryScreen onClose={() => setPage("home")} onScrollDirection={handleScrollDirection} />
      </View>
    ) : page === "tasks" ? (
      <View style={styles.screenOverlay} pointerEvents="auto">
        <TaskBoardScreen onClose={() => setPage("home")} onScrollDirection={handleScrollDirection} />
      </View>
    ) : null;

  const shell = (
    <>
      <View style={styles.dim} />
      <Animated.View
        style={[
          styles.chrome,
          {
            height: topBarHeight,
            opacity: chromeAnim,
            transform: [
              {
                translateY: chromeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-topBarHeight, 0],
                }),
              },
            ],
          },
        ]}
        pointerEvents={headerVisible ? "auto" : "none"}
      >
        <View style={[styles.topBar, { paddingTop: statusBarOffset }]} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.topBarRow,
              {
                opacity: menuRowAnim,
                transform: [
                  {
                    translateY: menuRowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-24, 0],
                    }),
                  },
                  {
                    scale: menuRowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.96, 1],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents={headerVisible ? "auto" : "none"}
          >
            <HamburgerButton onPress={() => setDrawerOpen(true)} />
            <Animated.View
              style={[
                styles.topBarCenter,
                {
                  opacity: tabsAnim,
                  transform: [
                    {
                      scale: tabsAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.92, 1],
                      }),
                    },
                  ],
                },
              ]}
              pointerEvents={page === "home" && headerVisible ? "auto" : "none"}
            >
              {page === "home" ? (
                <TabSwitch
                  value={mode}
                  onChange={(nextMode) => {
                    activateMode(nextMode);
                  }}
                />
              ) : null}
            </Animated.View>
            <View style={styles.topBarSpacer} />
          </Animated.View>
        </View>
      </Animated.View>
      <View style={[styles.screenWrap, { top: topBarHeight }]} {...swipeResponder.panHandlers}>
        {homeScreen}
        {overlayScreen}
      </View>
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
        onOpenTasks={() => {
          setPage("tasks");
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
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: "#081120",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(146, 171, 255, 0.14)",
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  topBarCenter: {
    flex: 1,
  },
  topBarSpacer: {
    width: 42,
    height: 42,
  },
  screenWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  homeStage: {
    flex: 1,
  },
  screenLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  screenOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  screenVisible: {
    opacity: 1,
  },
  screenHidden: {
    opacity: 0,
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


