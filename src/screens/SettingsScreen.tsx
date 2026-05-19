import React, { memo, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { useRelaySettings } from "@/context/RelaySettingsContext";

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  helper?: string;
};

const Field = memo(function Field({ label, value, onChange, placeholder, multiline, secureTextEntry, helper }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#6F7E9E"
        style={[styles.fieldInput, multiline && styles.fieldInputMultiline]}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
    </View>
  );
});

type ImageFieldProps = {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  helper: string;
  aspectRatio?: number;
  round?: boolean;
  cropRatio?: [number, number];
};

const ImageField = memo(function ImageField({ title, value, onChange, onClear, helper, aspectRatio = 16 / 9, round, cropRatio }: ImageFieldProps) {
  async function handlePick() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: cropRatio,
      quality: 1,
      base64: false,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    onChange(result.assets[0].uri);
  }

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{title}</Text>
      <View style={styles.imageCard}>
        <Pressable onPress={handlePick} style={styles.imageButton}>
          {value ? (
            <Image
              source={{ uri: value }}
              style={[
                styles.previewImage,
                {
                  aspectRatio,
                  borderRadius: round ? 999 : 16,
                },
              ]}
            />
          ) : (
            <View
              style={[
                styles.emptyPreview,
                {
                  aspectRatio,
                  borderRadius: round ? 999 : 16,
                },
              ]}
            >
              <Text style={styles.emptyPreviewText}>点击选择并裁剪</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.imageActions}>
          <Pressable onPress={handlePick} style={styles.actionButton}>
            <Text style={styles.actionButtonText}>{value ? "重新选择" : "选择图片"}</Text>
          </Pressable>
          <Pressable onPress={onClear} style={[styles.actionButton, styles.actionButtonGhost]}>
            <Text style={styles.actionButtonGhostText}>清除</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.fieldHelper}>{helper}</Text>
    </View>
  );
});

type ModelDraft = {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  imageModel: string;
};

type Props = {
  onClose: () => void;
  onScrollDirection?: (direction: "up" | "down") => void;
};

function emptyDraft(): ModelDraft {
  return {
    name: "",
    baseUrl: "",
    apiKey: "",
    chatModel: "",
    imageModel: "",
  };
}

export function SettingsScreen({ onScrollDirection }: Props) {
  const {
    settings,
    addModelCard,
    updateModelCard,
    setActiveChatModelId,
    setActiveImageModelId,
    setAiName,
    setPersona,
    setChatBackgroundUri,
    setUserAvatarUri,
    setAiAvatarUri,
  } = useRelaySettings();
  const [scrollY, setScrollY] = useState(0);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorMode, setEditorMode] = useState<"chat" | "image">("chat");
  const [draft, setDraft] = useState<ModelDraft>(emptyDraft);
  const [editorTitle, setEditorTitle] = useState("");

  const chatModels = useMemo(
    () => settings.models.filter((model) => model.id !== settings.activeImageModelId),
    [settings.activeImageModelId, settings.models]
  );
  const imageModel = useMemo(
    () => settings.models.find((model) => model.id === settings.activeImageModelId),
    [settings.activeImageModelId, settings.models]
  );
  const activeChat = chatModels.find((model) => model.id === settings.activeChatModelId) ?? chatModels[0] ?? settings.models[0];

  function openNewChatModel() {
    setEditorMode("chat");
    setEditorTitle("添加模型");
    setDraft(emptyDraft());
    setEditorVisible(true);
  }

  function openChatModel(modelId: string) {
    const model = chatModels.find((item) => item.id === modelId);
    if (!model) {
      return;
    }

    setEditorMode("chat");
    setEditorTitle("编辑聊天模型");
    setDraft({
      id: model.id,
      name: model.name,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      chatModel: model.chatModel,
      imageModel: model.imageModel,
    });
    setEditorVisible(true);
  }

  function openImageModel() {
    if (!imageModel) {
      return;
    }

    setEditorMode("image");
    setEditorTitle("编辑作图模型");
    setDraft({
      id: imageModel.id,
      name: imageModel.name,
      baseUrl: imageModel.baseUrl,
      apiKey: imageModel.apiKey,
      chatModel: imageModel.chatModel,
      imageModel: imageModel.imageModel,
    });
    setEditorVisible(true);
  }

  function saveDraft() {
    if (editorMode === "chat") {
      if (draft.id) {
        updateModelCard(draft.id, {
          name: draft.name,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          chatModel: draft.chatModel,
          imageModel: draft.imageModel,
        });
        setActiveChatModelId(draft.id);
      } else {
        const id = addModelCard({
          name: draft.name,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          chatModel: draft.chatModel,
          imageModel: draft.imageModel,
        });
        setActiveChatModelId(id);
      }
    } else if (draft.id) {
      updateModelCard(draft.id, {
        name: draft.name,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        chatModel: draft.chatModel,
        imageModel: draft.imageModel,
      });
      setActiveImageModelId(draft.id);
    }

    setEditorVisible(false);
  }

  const clearChatBackground = () => setChatBackgroundUri("");
  const clearUserAvatar = () => setUserAvatarUri("");
  const clearAiAvatar = () => setAiAvatarUri("");

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      onScroll={(event) => {
        const y = event.nativeEvent.contentOffset.y;
        const delta = y - scrollY;
        if (Math.abs(delta) > 12) {
          onScrollDirection?.(delta > 0 ? "up" : "down");
        }
        setScrollY(y);
      }}
      scrollEventThrottle={16}
    >
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>聊天模型</Text>
            <Text style={styles.sectionHelper}>点击卡片查看或编辑详情。这里只显示自定义名称。</Text>
          </View>
          <Pressable onPress={openNewChatModel} style={styles.addButton}>
            <Text style={styles.addButtonText}>添加模型</Text>
          </Pressable>
        </View>

        <View style={styles.activeRow}>
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeLabel}>当前聊天</Text>
            <Text style={styles.activeBadgeValue} numberOfLines={1}>
              {activeChat?.name ?? "未配置"}
            </Text>
          </View>
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeLabel}>当前作图</Text>
            <Text style={styles.activeBadgeValue} numberOfLines={1}>
              {imageModel?.name ?? "未配置"}
            </Text>
          </View>
        </View>

        <View style={styles.modelList}>
          {chatModels.map((model) => {
            const active = model.id === settings.activeChatModelId;
            return (
              <Pressable
                key={model.id}
                onPress={() => openChatModel(model.id)}
                style={({ pressed }) => [styles.modelCard, active && styles.modelCardActive, pressed && styles.modelCardPressed]}
              >
                <Text style={styles.modelName}>{model.name}</Text>
                <Text style={styles.modelMeta}>{active ? "当前模型" : "点按查看详情"}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>作图模型</Text>
            <Text style={styles.sectionHelper}>作图模型只保留单独一张卡片，不参与添加列表。</Text>
          </View>
        </View>

        {imageModel ? (
          <Pressable onPress={openImageModel} style={({ pressed }) => [styles.imageModelCard, pressed && styles.modelCardPressed]}>
            <Text style={styles.modelName}>{imageModel.name}</Text>
            <Text style={styles.modelMeta}>点按查看详情</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>AI 命名与人设</Text>
        <Field
          label="AI 名称"
          value={settings.aiName}
          onChange={setAiName}
          placeholder="小诺"
          helper="会显示在聊天界面里。"
        />
        <Field
          label="AI 人设"
          value={settings.persona}
          onChange={setPersona}
          placeholder="一个耐心、清晰、说中文的 AI 助手"
          multiline
          helper="会作为系统提示词的一部分发给模型。"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>聊天外观</Text>
        <ImageField
          title="聊天背景"
          value={settings.chatBackgroundUri}
          onChange={setChatBackgroundUri}
          onClear={clearChatBackground}
          helper="选择一张图片作为所有页面的背景。会先裁剪，再保存。"
          aspectRatio={16 / 10}
          cropRatio={[16, 10]}
        />
        <ImageField
          title="用户头像"
          value={settings.userAvatarUri}
          onChange={setUserAvatarUri}
          onClear={clearUserAvatar}
          helper="聊天中会显示在你的消息旁边。"
          aspectRatio={1}
          round
          cropRatio={[1, 1]}
        />
        <ImageField
          title="AI 头像"
          value={settings.aiAvatarUri}
          onChange={setAiAvatarUri}
          onClear={clearAiAvatar}
          helper="聊天中会显示在 AI 消息旁边。"
          aspectRatio={1}
          round
          cropRatio={[1, 1]}
        />
      </View>

      <View style={styles.tipBox}>
        <Text style={styles.tipTitle}>提示</Text>
        <Text style={styles.tipText}>设置修改后会立即生效，不需要重启应用。</Text>
      </View>

      <Modal visible={editorVisible} transparent animationType="fade" onRequestClose={() => setEditorVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditorVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => null}>
            <Text style={styles.modalTitle}>{editorTitle}</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
              <Field label="自定义名称" value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder="模型名称" />
              <Field
                label="Base URL"
                value={draft.baseUrl}
                onChange={(value) => setDraft((current) => ({ ...current, baseUrl: value }))}
                placeholder="https://relay.example.com"
              />
              <Field
                label="API Key"
                value={draft.apiKey}
                onChange={(value) => setDraft((current) => ({ ...current, apiKey: value }))}
                placeholder="输入密钥"
                secureTextEntry
              />
              <Field
                label="聊天模型"
                value={draft.chatModel}
                onChange={(value) => setDraft((current) => ({ ...current, chatModel: value }))}
                placeholder="gpt-4o-mini"
              />
              <Field
                label="作图模型"
                value={draft.imageModel}
                onChange={(value) => setDraft((current) => ({ ...current, imageModel: value }))}
                placeholder="gpt-image-2"
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setEditorVisible(false)} style={styles.modalGhostButton}>
                <Text style={styles.modalGhostButtonText}>取消</Text>
              </Pressable>
              <Pressable onPress={saveDraft} style={styles.modalPrimaryButton}>
                <Text style={styles.modalPrimaryButtonText}>保存</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 12,
  },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
  },
  sectionHelper: {
    marginTop: 4,
    color: "#8FA0C4",
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 220,
  },
  addButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5E85FF",
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  activeRow: {
    flexDirection: "row",
    gap: 10,
  },
  activeBadge: {
    flex: 1,
    gap: 2,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(8,16,32,0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  activeBadgeLabel: {
    color: "#9FB0D4",
    fontSize: 11,
    fontWeight: "700",
  },
  activeBadgeValue: {
    color: "#F7FAFF",
    fontSize: 13,
    fontWeight: "800",
  },
  modelList: {
    gap: 10,
  },
  modelCard: {
    gap: 4,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(8,16,32,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  imageModelCard: {
    gap: 4,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(8,16,32,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  modelCardActive: {
    borderColor: "rgba(94,133,255,0.7)",
    backgroundColor: "rgba(94,133,255,0.16)",
  },
  modelCardPressed: {
    opacity: 0.88,
  },
  modelName: {
    color: "#F7FAFF",
    fontSize: 14,
    fontWeight: "800",
  },
  modelMeta: {
    color: "#8FA0C4",
    fontSize: 11,
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
  },
  fieldInput: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(8, 16, 32, 0.95)",
    color: "#F7FAFF",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  fieldInputMultiline: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  fieldHelper: {
    color: "#8FA0C4",
    fontSize: 12,
    lineHeight: 17,
  },
  imageCard: {
    gap: 10,
  },
  imageButton: {
    width: "100%",
  },
  previewImage: {
    width: "100%",
    backgroundColor: "rgba(8, 16, 32, 0.95)",
  },
  emptyPreview: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 16, 32, 0.95)",
  },
  emptyPreviewText: {
    color: "#8FA0C4",
    fontSize: 13,
  },
  imageActions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5E85FF",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  actionButtonGhost: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  actionButtonGhostText: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "800",
  },
  tipBox: {
    gap: 8,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
  },
  tipTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
  },
  tipText: {
    color: "#A7B6D8",
    fontSize: 13,
    lineHeight: 19,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "80%",
    padding: 14,
    borderRadius: 22,
    backgroundColor: "#0E1730",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.14)",
  },
  modalTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  modalContent: {
    gap: 10,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  modalGhostButton: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  modalGhostButtonText: {
    color: "#DCE6FF",
    fontSize: 14,
    fontWeight: "800",
  },
  modalPrimaryButton: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#5E85FF",
  },
  modalPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
