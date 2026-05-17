import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type RelayConnectionSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type RelaySettings = {
  chat: RelayConnectionSettings;
  image: RelayConnectionSettings;
  aiName: string;
  persona: string;
  chatBackgroundUri: string;
  userAvatarUri: string;
  aiAvatarUri: string;
};

type RelaySettingsContextValue = {
  settings: RelaySettings;
  isReady: boolean;
  setChatBaseUrl: (value: string) => void;
  setChatApiKey: (value: string) => void;
  setChatModel: (value: string) => void;
  setImageBaseUrl: (value: string) => void;
  setImageApiKey: (value: string) => void;
  setImageModel: (value: string) => void;
  setAiName: (value: string) => void;
  setPersona: (value: string) => void;
  setChatBackgroundUri: (value: string) => void;
  setUserAvatarUri: (value: string) => void;
  setAiAvatarUri: (value: string) => void;
};

const STORAGE_KEY = "@nomi-mobile/relay-settings-v2";

const defaultSettings: RelaySettings = {
  chat: {
    baseUrl: process.env.EXPO_PUBLIC_CHAT_API_BASE_URL?.trim() || process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || "",
    apiKey: process.env.EXPO_PUBLIC_CHAT_API_KEY?.trim() || process.env.EXPO_PUBLIC_API_KEY?.trim() || "",
    model: process.env.EXPO_PUBLIC_CHAT_MODEL?.trim() || "gpt-4o-mini",
  },
  image: {
    baseUrl: process.env.EXPO_PUBLIC_IMAGE_API_BASE_URL?.trim() || process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || "",
    apiKey: process.env.EXPO_PUBLIC_IMAGE_API_KEY?.trim() || process.env.EXPO_PUBLIC_API_KEY?.trim() || "",
    model: process.env.EXPO_PUBLIC_IMAGE_MODEL?.trim() || "gpt-image-2",
  },
  aiName: process.env.EXPO_PUBLIC_AI_NAME?.trim() || "小诺",
  persona:
    process.env.EXPO_PUBLIC_AI_PERSONA?.trim() ||
    "一个耐心、清晰、说中文的 AI 助手。回答尽量简洁，必要时分步骤说明。",
  chatBackgroundUri: "",
  userAvatarUri: "",
  aiAvatarUri: "",
};

function mergeSettings(partial?: Partial<RelaySettings> | null): RelaySettings {
  if (!partial) {
    return defaultSettings;
  }

  return {
    chat: {
      baseUrl: partial.chat?.baseUrl?.trim() || defaultSettings.chat.baseUrl,
      apiKey: partial.chat?.apiKey?.trim() || defaultSettings.chat.apiKey,
      model: partial.chat?.model?.trim() || defaultSettings.chat.model,
    },
    image: {
      baseUrl: partial.image?.baseUrl?.trim() || defaultSettings.image.baseUrl,
      apiKey: partial.image?.apiKey?.trim() || defaultSettings.image.apiKey,
      model: partial.image?.model?.trim() || defaultSettings.image.model,
    },
    aiName: partial.aiName?.trim() || defaultSettings.aiName,
    persona: partial.persona?.trim() || defaultSettings.persona,
    chatBackgroundUri: partial.chatBackgroundUri?.trim() || "",
    userAvatarUri: partial.userAvatarUri?.trim() || "",
    aiAvatarUri: partial.aiAvatarUri?.trim() || "",
  };
}

function safeParseSettings(raw: string | null) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Partial<RelaySettings>;
  } catch {
    return null;
  }
}

const RelaySettingsContext = createContext<RelaySettingsContextValue | undefined>(undefined);

export function RelaySettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<RelaySettings>(defaultSettings);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) {
          return;
        }

        setSettings(mergeSettings(safeParseSettings(raw)));
      } catch {
        if (!cancelled) {
          setSettings(defaultSettings);
        }
      } finally {
        if (!cancelled) {
          setIsReady(true);
        }
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateConnectionSetting = useCallback(
    (section: "chat" | "image", key: keyof RelayConnectionSettings, value: string) => {
      setSettings((current) => ({
        ...current,
        [section]: {
          ...current[section],
          [key]: value.trim(),
        },
      }));
    },
    []
  );

  const updateSetting = useCallback(<K extends keyof RelaySettings>(key: K, value: RelaySettings[K]) => {
    setSettings((current) => ({
      ...current,
      [key]: typeof value === "string" ? value.trim() : value,
    }));
  }, []);

  const setChatBaseUrl = useCallback((baseUrl: string) => updateConnectionSetting("chat", "baseUrl", baseUrl), [updateConnectionSetting]);
  const setChatApiKey = useCallback((apiKey: string) => updateConnectionSetting("chat", "apiKey", apiKey), [updateConnectionSetting]);
  const setChatModel = useCallback((model: string) => updateConnectionSetting("chat", "model", model), [updateConnectionSetting]);
  const setImageBaseUrl = useCallback((baseUrl: string) => updateConnectionSetting("image", "baseUrl", baseUrl), [updateConnectionSetting]);
  const setImageApiKey = useCallback((apiKey: string) => updateConnectionSetting("image", "apiKey", apiKey), [updateConnectionSetting]);
  const setImageModel = useCallback((model: string) => updateConnectionSetting("image", "model", model), [updateConnectionSetting]);
  const setAiName = useCallback((aiName: string) => updateSetting("aiName", aiName), [updateSetting]);
  const setPersona = useCallback((persona: string) => updateSetting("persona", persona), [updateSetting]);
  const setChatBackgroundUri = useCallback((chatBackgroundUri: string) => updateSetting("chatBackgroundUri", chatBackgroundUri), [updateSetting]);
  const setUserAvatarUri = useCallback((userAvatarUri: string) => updateSetting("userAvatarUri", userAvatarUri), [updateSetting]);
  const setAiAvatarUri = useCallback((aiAvatarUri: string) => updateSetting("aiAvatarUri", aiAvatarUri), [updateSetting]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {
      // Ignore write errors so the UI stays responsive.
    });
  }, [isReady, settings]);

  const value = useMemo<RelaySettingsContextValue>(
    () => ({
      settings,
      isReady,
      setChatBaseUrl,
      setChatApiKey,
      setChatModel,
      setImageBaseUrl,
      setImageApiKey,
      setImageModel,
      setAiName,
      setPersona,
      setChatBackgroundUri,
      setUserAvatarUri,
      setAiAvatarUri,
    }),
    [
      isReady,
      settings,
      setChatBaseUrl,
      setChatApiKey,
      setChatModel,
      setImageBaseUrl,
      setImageApiKey,
      setImageModel,
      setAiName,
      setPersona,
      setChatBackgroundUri,
      setUserAvatarUri,
      setAiAvatarUri,
    ]
  );

  return <RelaySettingsContext.Provider value={value}>{children}</RelaySettingsContext.Provider>;
}

export function useRelaySettings() {
  const context = useContext(RelaySettingsContext);
  if (!context) {
    throw new Error("useRelaySettings must be used within RelaySettingsProvider");
  }

  return context;
}
