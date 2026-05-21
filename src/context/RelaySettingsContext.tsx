import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type RelayConnectionSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type RelayModelCard = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  imageModel: string;
};

export type RelaySettings = {
  models: RelayModelCard[];
  activeChatModelId: string;
  activeImageModelId: string;
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
  addModelCard: (card?: Partial<RelayModelCard>) => string;
  updateModelCard: (id: string, patch: Partial<RelayModelCard>) => void;
  removeModelCard: (id: string) => void;
  setActiveChatModelId: (id: string) => void;
  setActiveImageModelId: (id: string) => void;
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

const STORAGE_KEY = "@nomi-mobile/relay-settings-v3";

function trim(value?: string | null) {
  return value?.trim() ?? "";
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultCard(kind: "chat" | "image"): RelayModelCard {
  const baseUrl = trim(kind === "chat" ? process.env.EXPO_PUBLIC_CHAT_API_BASE_URL : process.env.EXPO_PUBLIC_IMAGE_API_BASE_URL) ||
    trim(process.env.EXPO_PUBLIC_API_BASE_URL);
  const apiKey = trim(kind === "chat" ? process.env.EXPO_PUBLIC_CHAT_API_KEY : process.env.EXPO_PUBLIC_IMAGE_API_KEY) ||
    trim(process.env.EXPO_PUBLIC_API_KEY);
  const model = trim(kind === "chat" ? process.env.EXPO_PUBLIC_CHAT_MODEL : process.env.EXPO_PUBLIC_IMAGE_MODEL) ||
    (kind === "chat" ? "gpt-4o-mini" : "gpt-image-2");

  return {
    id: `${kind}-default`,
    name: kind === "chat" ? "默认聊天模型" : "默认作图模型",
    baseUrl,
    apiKey,
    chatModel: kind === "chat" ? model : "gpt-4o-mini",
    imageModel: kind === "image" ? model : "gpt-image-2",
  };
}

function createDefaultSettings(): RelaySettings {
  const chatCard = createDefaultCard("chat");
  const imageCard = createDefaultCard("image");

  return {
    models: [chatCard, imageCard],
    activeChatModelId: chatCard.id,
    activeImageModelId: imageCard.id,
    chat: {
      baseUrl: chatCard.baseUrl,
      apiKey: chatCard.apiKey,
      model: chatCard.chatModel,
    },
    image: {
      baseUrl: imageCard.baseUrl,
      apiKey: imageCard.apiKey,
      model: imageCard.imageModel,
    },
    aiName: trim(process.env.EXPO_PUBLIC_AI_NAME) || "小诺",
    persona:
      trim(process.env.EXPO_PUBLIC_AI_PERSONA) ||
      "一个耐心、清晰、说中文的 AI 助手。回答尽量简洁，必要时分步骤说明。",
    chatBackgroundUri: "",
    userAvatarUri: "",
    aiAvatarUri: "",
  };
}

const defaultSettings = createDefaultSettings();

function normalizeCard(card: Partial<RelayModelCard>, fallbackName: string, fallbackId?: string): RelayModelCard {
  return {
    id: trim(card.id) || fallbackId || makeId("model"),
    name: trim(card.name) || fallbackName,
    baseUrl: trim(card.baseUrl),
    apiKey: trim(card.apiKey),
    chatModel: trim(card.chatModel) || "gpt-4o-mini",
    imageModel: trim(card.imageModel) || "gpt-image-2",
  };
}

function isRelayModelCard(value: unknown): value is Partial<RelayModelCard> {
  return Boolean(value && typeof value === "object");
}

function resolveConnection(card: RelayModelCard | undefined, kind: "chat" | "image"): RelayConnectionSettings {
  if (!card) {
    return {
      baseUrl: "",
      apiKey: "",
      model: kind === "chat" ? "gpt-4o-mini" : "gpt-image-2",
    };
  }

  return {
    baseUrl: card.baseUrl.trim(),
    apiKey: card.apiKey.trim(),
    model: kind === "chat" ? card.chatModel.trim() || card.imageModel.trim() || "gpt-4o-mini" : card.imageModel.trim() || card.chatModel.trim() || "gpt-image-2",
  };
}

function normalizeSettings(partial?: Partial<RelaySettings> | null): RelaySettings {
  if (!partial) {
    return defaultSettings;
  }

  const legacyChat = partial.chat ? normalizeCard(
    {
      id: "chat-legacy",
      name: "聊天模型",
      baseUrl: partial.chat.baseUrl,
      apiKey: partial.chat.apiKey,
      chatModel: partial.chat.model,
      imageModel: partial.chat.model,
    },
    "聊天模型",
    "chat-legacy"
  ) : null;
  const legacyImage = partial.image ? normalizeCard(
    {
      id: "image-legacy",
      name: "作图模型",
      baseUrl: partial.image.baseUrl,
      apiKey: partial.image.apiKey,
      chatModel: partial.image.model,
      imageModel: partial.image.model,
    },
    "作图模型",
    "image-legacy"
  ) : null;

  const modelSource = (Array.isArray(partial.models) && partial.models.length > 0 ? partial.models : [legacyChat, legacyImage]) as Array<
    Partial<RelayModelCard> | null
  >;
  const normalizedModels = modelSource.flatMap((card, index) => (card ? [normalizeCard(card, `模型 ${index + 1}`)] : []))
    .reduce<RelayModelCard[]>((acc, card) => {
      const existingIndex = acc.findIndex((item) => item.id === card.id);
      if (existingIndex >= 0) {
        acc[existingIndex] = card;
      } else {
        acc.push(card);
      }
      return acc;
    }, []);

  if (!normalizedModels.length) {
    normalizedModels.push(createDefaultCard("chat"), createDefaultCard("image"));
  }

  const activeChatModelId = trim(partial.activeChatModelId) || normalizedModels[0].id;
  const activeImageModelId = trim(partial.activeImageModelId) || normalizedModels.find((item) => item.id === activeChatModelId)?.id || normalizedModels[1]?.id || normalizedModels[0].id;

  const chatCard = normalizedModels.find((item) => item.id === activeChatModelId) ?? normalizedModels[0];
  const imageCard = normalizedModels.find((item) => item.id === activeImageModelId) ?? chatCard;

  return {
    models: normalizedModels,
    activeChatModelId: chatCard.id,
    activeImageModelId: imageCard.id,
    chat: resolveConnection(chatCard, "chat"),
    image: resolveConnection(imageCard, "image"),
    aiName: partial.aiName !== undefined && partial.aiName !== null ? trim(partial.aiName) : defaultSettings.aiName,
    persona: partial.persona !== undefined && partial.persona !== null ? trim(partial.persona) : defaultSettings.persona,
    chatBackgroundUri: trim(partial.chatBackgroundUri),
    userAvatarUri: trim(partial.userAvatarUri),
    aiAvatarUri: trim(partial.aiAvatarUri),
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

        setSettings(normalizeSettings(safeParseSettings(raw)));
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

  const commit = useCallback((updater: (current: RelaySettings) => RelaySettings) => {
    setSettings((current) => normalizeSettings(updater(current)));
  }, []);

  const addModelCard = useCallback(
    (card?: Partial<RelayModelCard>) => {
      const id = trim(card?.id) || makeId("model");
      commit((current) => ({
        ...current,
        models: [
          ...current.models,
          normalizeCard(
            {
              id,
              name: card?.name,
              baseUrl: card?.baseUrl,
              apiKey: card?.apiKey,
              chatModel: card?.chatModel,
              imageModel: card?.imageModel,
            },
            `模型 ${current.models.length + 1}`,
            id
          ),
        ],
      }));

      return id;
    },
    [commit]
  );

  const updateModelCard = useCallback(
    (id: string, patch: Partial<RelayModelCard>) => {
      commit((current) => ({
        ...current,
        models: current.models.map((card) =>
          card.id === id
            ? normalizeCard(
                {
                  ...card,
                  ...patch,
                  id,
                },
                card.name || "模型",
                id
              )
            : card
        ),
      }));
    },
    [commit]
  );

  const removeModelCard = useCallback(
    (id: string) => {
      commit((current) => {
        const models = current.models.filter((card) => card.id !== id);
        const nextModels = models.length > 0 ? models : [createDefaultCard("chat")];
        const nextChat = current.activeChatModelId === id ? nextModels[0].id : current.activeChatModelId;
        const nextImage = current.activeImageModelId === id ? nextModels[Math.min(1, nextModels.length - 1)]?.id ?? nextModels[0].id : current.activeImageModelId;

        return {
          ...current,
          models: nextModels,
          activeChatModelId: nextChat,
          activeImageModelId: nextImage,
        };
      });
    },
    [commit]
  );

  const setActiveChatModelId = useCallback(
    (id: string) => {
      commit((current) => ({
        ...current,
        activeChatModelId: current.models.some((card) => card.id === id) ? id : current.activeChatModelId,
      }));
    },
    [commit]
  );

  const setActiveImageModelId = useCallback(
    (id: string) => {
      commit((current) => ({
        ...current,
        activeImageModelId: current.models.some((card) => card.id === id) ? id : current.activeImageModelId,
      }));
    },
    [commit]
  );

  const updateActiveChatCard = useCallback(
    (patch: Partial<RelayModelCard>) => {
      commit((current) => ({
        ...current,
        models: current.models.map((card) =>
          card.id === current.activeChatModelId
            ? normalizeCard(
                {
                  ...card,
                  ...patch,
                  id: card.id,
                },
                card.name,
                card.id
              )
            : card
        ),
      }));
    },
    [commit]
  );

  const updateActiveImageCard = useCallback(
    (patch: Partial<RelayModelCard>) => {
      commit((current) => ({
        ...current,
        models: current.models.map((card) =>
          card.id === current.activeImageModelId
            ? normalizeCard(
                {
                  ...card,
                  ...patch,
                  id: card.id,
                },
                card.name,
                card.id
              )
            : card
        ),
      }));
    },
    [commit]
  );

  const setAiName = useCallback((value: string) => {
    commit((current) => ({ ...current, aiName: trim(value) }));
  }, [commit]);

  const setPersona = useCallback((value: string) => {
    commit((current) => ({ ...current, persona: trim(value) }));
  }, [commit]);

  const setChatBackgroundUri = useCallback((value: string) => {
    commit((current) => ({ ...current, chatBackgroundUri: trim(value) }));
  }, [commit]);

  const setUserAvatarUri = useCallback((value: string) => {
    commit((current) => ({ ...current, userAvatarUri: trim(value) }));
  }, [commit]);

  const setAiAvatarUri = useCallback((value: string) => {
    commit((current) => ({ ...current, aiAvatarUri: trim(value) }));
  }, [commit]);

  const setChatBaseUrl = useCallback((value: string) => updateActiveChatCard({ baseUrl: value }), [updateActiveChatCard]);
  const setChatApiKey = useCallback((value: string) => updateActiveChatCard({ apiKey: value }), [updateActiveChatCard]);
  const setChatModel = useCallback((value: string) => updateActiveChatCard({ chatModel: value }), [updateActiveChatCard]);
  const setImageBaseUrl = useCallback((value: string) => updateActiveImageCard({ baseUrl: value }), [updateActiveImageCard]);
  const setImageApiKey = useCallback((value: string) => updateActiveImageCard({ apiKey: value }), [updateActiveImageCard]);
  const setImageModel = useCallback((value: string) => updateActiveImageCard({ imageModel: value }), [updateActiveImageCard]);

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
      addModelCard,
      updateModelCard,
      removeModelCard,
      setActiveChatModelId,
      setActiveImageModelId,
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
      addModelCard,
      isReady,
      removeModelCard,
      setActiveChatModelId,
      setActiveImageModelId,
      setAiAvatarUri,
      setAiName,
      setChatApiKey,
      setChatBackgroundUri,
      setChatBaseUrl,
      setChatModel,
      setImageApiKey,
      setImageBaseUrl,
      setImageModel,
      setPersona,
      setUserAvatarUri,
      settings,
      updateModelCard,
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



