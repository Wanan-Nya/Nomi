import React, { memo, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { Buffer } from "buffer";
import { File, Paths } from "expo-file-system";

import { PrimaryButton } from "@/components/PrimaryButton";
import { useRelaySettings } from "@/context/RelaySettingsContext";
import { editImage, generateImage } from "@/services/relayApi";
import { ImageGenerationResult, ImageOutputFormat, ImageQuality, ImageResponseFormat, ImageSize } from "@/types";

type Mode = "generate" | "edit";

type OptionGroupProps<T extends string> = {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
};

type SelectedImage = {
  uri: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

type ImageHistoryEntry = {
  id: string;
  mode: Mode;
  prompt: string;
  createdAt: number;
  size: ImageSize;
  quality: ImageQuality;
  responseFormat: ImageResponseFormat;
  outputFormat: ImageOutputFormat;
  selectedImages: SelectedImage[];
  result: ImageGenerationResult & { localUri?: string };
};

const HISTORY_KEY = "@nomi-mobile/image-history-v1";

const sizeOptions = ["auto", "1024x1024", "1536x1024", "1024x1536", "1536x864"] as const;
const qualityOptions = ["low", "medium", "high", "auto"] as const;
const responseFormatOptions = ["url", "b64_json"] as const;
const outputFormatOptions = ["png", "jpeg"] as const;

const OptionGroup = memo(function OptionGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: OptionGroupProps<T>) {
  return (
    <View style={styles.optionBlock}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionRow}>
        {options.map((item) => {
          const active = item === value;
          return (
            <Pressable
              key={item}
              onPress={() => onChange(item)}
              style={[styles.optionChip, active && styles.optionChipActive]}
            >
              <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}) as <T extends string>(props: OptionGroupProps<T>) => React.ReactElement;

function getFileExtension(format: ImageOutputFormat) {
  return format === "jpeg" ? "jpg" : "png";
}

async function materializeResult(result: ImageGenerationResult, outputFormat: ImageOutputFormat) {
  const extension = getFileExtension(outputFormat);
  const file = new File(Paths.cache, `nomi-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);

  if (result.url) {
    const response = await fetch(result.url);
    if (!response.ok) {
      throw new Error(`下载图片失败：${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    file.write(bytes);
  } else if (result.b64_json) {
    const bytes = Buffer.from(result.b64_json, "base64");
    file.write(bytes);
  } else {
    throw new Error("没有可保存的图片内容。");
  }

  return {
    ...result,
    localUri: file.uri,
  };
}

async function saveResultToGallery(result: ImageGenerationResult, outputFormat: ImageOutputFormat) {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new Error("需要相册权限才能保存图片。");
  }

  let uri = result.localUri;
  if (!uri) {
    const materialized = await materializeResult(result, outputFormat);
    uri = materialized.localUri;
  }

  if (!uri) {
    throw new Error("没有可保存的图片内容。");
  }

  await MediaLibrary.saveToLibraryAsync(uri);
}

function thumbnailUri(result?: ImageGenerationResult | null) {
  return result?.localUri ?? result?.url;
}

type Props = {
  onScrollDirection?: (direction: "up" | "down") => void;
};

export function ImageScreen({ onScrollDirection }: Props) {
  const { settings } = useRelaySettings();
  const [mode, setMode] = useState<Mode>("generate");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImageGenerationResult | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [size, setSize] = useState<ImageSize>("1536x1024");
  const [quality, setQuality] = useState<ImageQuality>("high");
  const [responseFormat, setResponseFormat] = useState<ImageResponseFormat>("url");
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>("png");
  const [history, setHistory] = useState<ImageHistoryEntry[]>([]);
  const [scrollY, setScrollY] = useState(0);
  const modeHint = mode === "generate" ? "直接生成一张新图" : `已选择 ${selectedImages.length} 张参考图`;

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => {
        if (!raw) {
          return;
        }

        try {
          const parsed = JSON.parse(raw) as ImageHistoryEntry[];
          if (Array.isArray(parsed)) {
            setHistory(parsed);
          }
        } catch {
          // Ignore invalid cached history.
        }
      })
      .catch(() => {
        // Ignore cache load errors.
      });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history)).catch(() => {
      // Ignore history persistence failures.
    });
  }, [history]);

  const previewUri = useMemo(() => thumbnailUri(result), [result]);

  const visibleHistory = useMemo(() => history.slice().sort((left, right) => right.createdAt - left.createdAt), [history]);

  async function handlePickImages() {
    setError("");
    setStatus("");

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("需要相册权限才能选择图片。");
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 4,
      base64: false,
    });

    if (picked.canceled || !picked.assets?.length) {
      return;
    }

    setSelectedImages(
      picked.assets.map((asset) => ({
        uri: asset.uri,
        fileName: asset.fileName ?? undefined,
        mimeType: asset.mimeType ?? undefined,
        fileSize: asset.fileSize ?? undefined,
      }))
    );
    setResult(null);
    setStatus("");
  }

  function removeSelectedImage(index: number) {
    setSelectedImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function restoreFromHistory(entry: ImageHistoryEntry, asEdit: boolean) {
    setMode(asEdit ? "edit" : "generate");
    setPrompt(entry.prompt);
    setSize(entry.size);
    setQuality(entry.quality);
    setResponseFormat(entry.responseFormat);
    setOutputFormat(entry.outputFormat);
    setStatus("");
    setError("");

    if (asEdit) {
      const source = entry.mode === "edit" && entry.selectedImages.length ? entry.selectedImages : [{ uri: entry.result.localUri ?? entry.result.url ?? "" }];
      const nextImages = source
        .filter((item) => Boolean(item.uri))
        .map((item, index) => ({
          uri: item.uri,
          fileName: item.fileName ?? `reference-${index + 1}.png`,
          mimeType: item.mimeType ?? "image/png",
          fileSize: item.fileSize,
        }));

      setSelectedImages(nextImages);
    } else {
      setSelectedImages([]);
    }
  }

  async function recordHistory(next: ImageHistoryEntry) {
    setHistory((current) => [next, ...current].slice(0, 20));
  }

  async function runGeneration(nextMode: Mode) {
    if (!prompt.trim() || loading) {
      return;
    }

    if (nextMode === "edit" && !selectedImages.length) {
      setError("请先选择至少一张参考图。");
      return;
    }

    setError("");
    setStatus("");
    setLoading(true);

    try {
      const trimmedPrompt = prompt.trim();
      const generated =
        nextMode === "generate"
          ? await generateImage(settings.image, trimmedPrompt, {
              size,
              quality,
              responseFormat,
              outputFormat,
            })
          : await editImage(settings.image, {
              prompt: trimmedPrompt,
              images: selectedImages.map((item, index) => ({
                uri: item.uri,
                name: item.fileName ?? `reference-${index + 1}.jpg`,
                type: item.mimeType ?? "image/jpeg",
              })),
              size,
              quality,
              responseFormat,
              outputFormat,
              inputFidelity: "high",
            });

      const materialized = await materializeResult(generated, outputFormat);
      setResult(materialized);
      setStatus(nextMode === "generate" ? "生成成功" : "编辑成功");

      await recordHistory({
        id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        mode: nextMode,
        prompt: trimmedPrompt,
        createdAt: Date.now(),
        size,
        quality,
        responseFormat,
        outputFormat,
        selectedImages: selectedImages.slice(),
        result: materialized,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : nextMode === "generate" ? "生成失败" : "编辑失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveResult() {
    if (!result) {
      setError("还没有可保存的图片。");
      return;
    }

    setError("");
    setStatus("");
    setSaving(true);

    try {
      await saveResultToGallery(result, outputFormat);
      setStatus("已保存到相册");
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const canUseEdit = mode === "edit" && selectedImages.length > 0;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
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
      <View style={styles.modeSwitch}>
        <Pressable onPress={() => setMode("generate")} style={[styles.modeChip, mode === "generate" && styles.modeChipActive]}>
          <Text style={[styles.modeChipText, mode === "generate" && styles.modeChipTextActive]}>文生图</Text>
        </Pressable>
        <Pressable onPress={() => setMode("edit")} style={[styles.modeChip, mode === "edit" && styles.modeChipActive]}>
          <Text style={[styles.modeChipText, mode === "edit" && styles.modeChipTextActive]}>图生图</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>生成参数</Text>
        <Text style={styles.helper}>{modeHint}</Text>
        <OptionGroup label="尺寸" value={size} options={sizeOptions} onChange={setSize} />
        <OptionGroup label="质量" value={quality} options={qualityOptions} onChange={setQuality} />
        <OptionGroup label="返回格式" value={responseFormat} options={responseFormatOptions} onChange={setResponseFormat} />
        <OptionGroup label="输出格式" value={outputFormat} options={outputFormatOptions} onChange={setOutputFormat} />
      </View>

      {mode === "edit" ? (
        <View style={styles.card}>
          <Text style={styles.label}>参考图</Text>
          <View style={styles.pickHeader}>
            <Text style={styles.helper}>可以多选图片，让模型按照参考内容重新编辑。</Text>
            <PrimaryButton title={selectedImages.length ? `重新选择 (${selectedImages.length})` : "选择图片"} onPress={handlePickImages} />
          </View>
          {selectedImages.length ? (
            <View style={styles.referenceGrid}>
              {selectedImages.map((image, index) => (
                <View key={`${image.uri}-${index}`} style={styles.referenceCard}>
                  <View style={styles.referenceHeader}>
                    <Text style={styles.referenceIndex}>图 {index + 1}</Text>
                    <Pressable onPress={() => removeSelectedImage(index)} style={styles.removeButton}>
                      <Text style={styles.removeButtonText}>移除</Text>
                    </Pressable>
                  </View>
                  <Image source={{ uri: image.uri }} style={styles.referenceImage} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.helper}>先选一张或多张图片，再在底部输入编辑说明。</Text>
          )}
        </View>
      ) : null}

      {status ? (
        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.preview}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle}>预览</Text>
          {result ? <PrimaryButton title={saving ? "保存中..." : "保存到相册"} onPress={handleSaveResult} loading={saving} /> : null}
        </View>

        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.image} />
        ) : (
          <View style={styles.emptyPreview}>
            <Text style={styles.emptyText}>{mode === "generate" ? "生成结果会显示在这里" : "编辑结果会显示在这里"}</Text>
          </View>
        )}

        {result?.revised_prompt ? <Text style={styles.helper}>模型改写后的提示词：{result.revised_prompt}</Text> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <Text style={styles.label}>生成历史</Text>
          <Text style={styles.helper}>{visibleHistory.length} 条</Text>
        </View>
        {visibleHistory.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRow}>
            {visibleHistory.map((entry) => {
              const thumbnail = entry.result.localUri ?? entry.result.url;
              return (
                <View key={entry.id} style={styles.historyCard}>
                  {thumbnail ? <Image source={{ uri: thumbnail }} style={styles.historyImage} /> : <View style={styles.historyEmpty} />}
                  <Text style={styles.historyMode}>{entry.mode === "generate" ? "文生图" : "图生图"}</Text>
                  <Text style={styles.historyPrompt} numberOfLines={3}>
                    {entry.prompt || "无提示词"}
                  </Text>
                  <View style={styles.historyActions}>
                    <Pressable onPress={() => restoreFromHistory(entry, false)} style={styles.historyButton}>
                      <Text style={styles.historyButtonText}>再生成</Text>
                    </Pressable>
                    <Pressable onPress={() => restoreFromHistory(entry, true)} style={[styles.historyButton, styles.historyButtonPrimary]}>
                      <Text style={styles.historyButtonText}>重新编辑</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <Text style={styles.helper}>这里会保存最近的生成记录，方便回退和重做。</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{mode === "generate" ? "提示词" : "编辑说明"}</Text>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          style={styles.input}
          placeholder={mode === "generate" ? "描述你想生成的图片" : "比如：参考这张图的构图，把主体改成夜景插画风"}
          placeholderTextColor="#7182A4"
        />

        <View style={styles.bottomActions}>
          {mode === "edit" ? (
            <PrimaryButton title={loading ? "编辑中..." : "开始编辑"} onPress={() => void runGeneration("edit")} loading={loading} disabled={!canUseEdit} />
          ) : (
            <PrimaryButton title={loading ? "生成中..." : "开始生成"} onPress={() => void runGeneration("generate")} loading={loading} />
          )}
          {mode === "edit" ? (
            <Pressable onPress={handlePickImages} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>添加参考图</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 16,
    gap: 12,
  },
  modeSwitch: {
    flexDirection: "row",
    gap: 10,
    padding: 6,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  modeChip: {
    flex: 1,
    borderRadius: 14,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  modeChipActive: {
    backgroundColor: "#5E85FF",
  },
  modeChipText: {
    color: "#9BA9C7",
    fontSize: 15,
    fontWeight: "700",
  },
  modeChipTextActive: {
    color: "#FFFFFF",
  },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  label: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
  },
  helper: {
    color: "#8FA0C4",
    fontSize: 12,
    lineHeight: 18,
  },
  optionBlock: {
    gap: 8,
  },
  optionLabel: {
    color: "#DCE6FF",
    fontSize: 12,
    fontWeight: "700",
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  optionChipActive: {
    backgroundColor: "#5E85FF",
  },
  optionChipText: {
    color: "#A9B7D6",
    fontSize: 12,
    fontWeight: "700",
  },
  optionChipTextActive: {
    color: "#FFFFFF",
  },
  pickHeader: {
    gap: 10,
  },
  referenceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  referenceCard: {
    width: "48%",
    gap: 8,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(8, 16, 32, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  referenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  referenceIndex: {
    color: "#DCE6FF",
    fontSize: 12,
    fontWeight: "700",
  },
  removeButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  removeButtonText: {
    color: "#F7FAFF",
    fontSize: 11,
    fontWeight: "700",
  },
  referenceImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  statusBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.3)",
  },
  statusText: {
    color: "#B9F6CE",
    fontSize: 13,
    lineHeight: 18,
  },
  errorBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255, 92, 92, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 92, 92, 0.35)",
  },
  errorText: {
    color: "#FFB4B4",
    fontSize: 13,
    lineHeight: 18,
  },
  preview: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  previewTitle: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
  },
  image: {
    width: "100%",
    minHeight: 220,
    borderRadius: 18,
    backgroundColor: "rgba(8, 16, 32, 0.95)",
  },
  emptyPreview: {
    minHeight: 220,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 16, 32, 0.95)",
  },
  emptyText: {
    color: "#8FA0C4",
    fontSize: 13,
  },
  historyRow: {
    gap: 10,
    paddingRight: 4,
  },
  historyCard: {
    width: 210,
    gap: 8,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(8, 16, 32, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  historyImage: {
    width: "100%",
    height: 120,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  historyEmpty: {
    width: "100%",
    height: 120,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  historyMode: {
    color: "#9CB8FF",
    fontSize: 11,
    fontWeight: "700",
  },
  historyPrompt: {
    color: "#F7FAFF",
    fontSize: 12,
    lineHeight: 18,
  },
  historyActions: {
    flexDirection: "row",
    gap: 8,
  },
  historyButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  historyButtonPrimary: {
    backgroundColor: "#5E85FF",
  },
  historyButtonText: {
    color: "#F7FAFF",
    fontSize: 11,
    fontWeight: "800",
  },
  bottomActions: {
    gap: 10,
  },
  input: {
    minHeight: 112,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(8, 16, 32, 0.95)",
    color: "#F7FAFF",
    textAlignVertical: "top",
    fontSize: 15,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  secondaryButtonText: {
    color: "#DCE6FF",
    fontSize: 14,
    fontWeight: "800",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
