import React, { memo, useCallback } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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

type Props = {
  onClose: () => void;
};

export function SettingsScreen({ onClose }: Props) {
  const {
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
  } = useRelaySettings();
  const clearChatBackground = useCallback(() => setChatBackgroundUri(""), [setChatBackgroundUri]);
  const clearUserAvatar = useCallback(() => setUserAvatarUri(""), [setUserAvatarUri]);
  const clearAiAvatar = useCallback(() => setAiAvatarUri(""), [setAiAvatarUri]);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.headerCard}>
        <View>
          <Text style={styles.pageTitle}>设置</Text>
          <Text style={styles.pageSubtitle}>在这里配置聊天、作图和外观资源，修改会立即生效。</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>返回</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>聊天设置</Text>
        <Field
          label="聊天 API Base URL"
          value={settings.chat.baseUrl}
          onChange={setChatBaseUrl}
          placeholder="https://relay.example.com"
          helper="填写聊天接口的中转站地址。"
        />
        <Field
          label="聊天 API Key"
          value={settings.chat.apiKey}
          onChange={setChatApiKey}
          placeholder="输入聊天接口密钥"
          secureTextEntry
          helper="如果你的中转站不需要密钥，这里可以留空。"
        />
        <Field
          label="聊天模型"
          value={settings.chat.model}
          onChange={setChatModel}
          placeholder="gpt-4o-mini"
          helper="直接输入模型名即可。"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>图片生成设置</Text>
        <Field
          label="图片 API Base URL"
          value={settings.image.baseUrl}
          onChange={setImageBaseUrl}
          placeholder="https://relay.example.com"
          helper="填写图片接口的中转站地址。"
        />
        <Field
          label="图片 API Key"
          value={settings.image.apiKey}
          onChange={setImageApiKey}
          placeholder="输入图片接口密钥"
          secureTextEntry
          helper="如果和聊天共用同一个 key，也可以直接填一样的。"
        />
        <Field
          label="图片模型"
          value={settings.image.model}
          onChange={setImageModel}
          placeholder="gpt-image-2"
          helper="直接输入模型名即可。"
        />
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
        <Text style={styles.tipText}>
          你改完设置后可以直接回到聊天页或作图页，新的配置会立刻生效，不需要重启应用。
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 18,
    gap: 12,
  },
  headerCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.14)",
  },
  pageTitle: {
    color: "#F5F7FF",
    fontSize: 24,
    fontWeight: "900",
  },
  pageSubtitle: {
    marginTop: 4,
    color: "#A7B6D8",
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 240,
  },
  closeButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  closeButtonText: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "800",
  },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  sectionTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
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
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 16, 32, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  emptyPreviewText: {
    color: "#8FA0C4",
    fontSize: 13,
    fontWeight: "700",
  },
  imageActions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    height: 40,
    borderRadius: 12,
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
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  actionButtonGhostText: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "800",
  },
  tipBox: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: "rgba(143,180,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(143,180,255,0.16)",
  },
  tipTitle: {
    color: "#F5F7FF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 4,
  },
  tipText: {
    color: "#DCE6FF",
    fontSize: 13,
    lineHeight: 19,
  },
});
