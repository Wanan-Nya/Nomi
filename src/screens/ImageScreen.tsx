import React, { memo, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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

type SelectedImage = ImagePicker.ImagePickerAsset;

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

async function saveResultToGallery(result: ImageGenerationResult, outputFormat: ImageOutputFormat) {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new Error("需要相册权限才能保存图片。");
  }

  const extension = getFileExtension(outputFormat);
  const file = new File(Paths.cache, `nomi-result-${Date.now()}.${extension}`);

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

  await MediaLibrary.saveToLibraryAsync(file.uri);
}

export function ImageScreen() {
  const { settings } = useRelaySettings();
  const [mode, setMode] = useState<Mode>("generate");
  const [prompt, setPrompt] = useState("一只橘色的小猫，温暖插画风格");
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
  const modeHint = mode === "generate" ? "直接生成一张新图" : `已选择 ${selectedImages.length} 张参考图`;

  const previewUri = useMemo(() => {
    if (result?.url) {
      return result.url;
    }

    if (result?.b64_json) {
      const mimeType = outputFormat === "jpeg" ? "image/jpeg" : "image/png";
      return `data:${mimeType};base64,${result.b64_json}`;
    }

    return undefined;
  }, [outputFormat, result?.b64_json, result?.url]);

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

    setSelectedImages(picked.assets);
    setResult(null);
    setStatus("");
  }

  function removeSelectedImage(index: number) {
    setSelectedImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleGenerate() {
    if (!prompt.trim() || loading) {
      return;
    }

    setError("");
    setStatus("");
    setLoading(true);

    try {
      const image = await generateImage(settings.image, prompt.trim(), {
        size,
        quality,
        responseFormat,
        outputFormat,
      });
      setResult(image);
      setStatus("生成成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEdit() {
    if (!prompt.trim() || loading) {
      return;
    }

    if (!selectedImages.length) {
      setError("请先选择至少一张参考图。");
      return;
    }

    setError("");
    setStatus("");
    setLoading(true);

    try {
      const image = await editImage(settings.image, {
        prompt: prompt.trim(),
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
      setResult(image);
      setStatus("编辑成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : "编辑失败";
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
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.modeSwitch}>
        <Pressable onPress={() => setMode("generate")} style={[styles.modeChip, mode === "generate" && styles.modeChipActive]}>
          <Text style={[styles.modeChipText, mode === "generate" && styles.modeChipTextActive]}>文生图</Text>
        </Pressable>
        <Pressable onPress={() => setMode("edit")} style={[styles.modeChip, mode === "edit" && styles.modeChipActive]}>
          <Text style={[styles.modeChipText, mode === "edit" && styles.modeChipTextActive]}>图生图</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{mode === "generate" ? "提示词" : "编辑说明"}</Text>
        <Text style={styles.helper}>{modeHint}</Text>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          style={styles.input}
          placeholder={mode === "generate" ? "描述你想生成的图片" : "比如：参考第1张的画风，把第2张重画成插画风"}
          placeholderTextColor="#7182A4"
        />

        {mode === "edit" ? (
          <View style={styles.pickBlock}>
            <PrimaryButton title={selectedImages.length ? `重新选择参考图 (${selectedImages.length})` : "选择参考图"} onPress={handlePickImages} />
            {selectedImages.length ? (
              <View style={styles.referenceSection}>
                <Text style={styles.helper}>按选择顺序发送。你可以在提示词里写清楚“第1张参考风格，第2张重画主体”等要求。</Text>
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
              </View>
            ) : (
              <Text style={styles.helper}>先选一张或多张图片，再输入你希望怎么重绘、融合或改图。</Text>
            )}
          </View>
        ) : null}

        <OptionGroup label="尺寸" value={size} options={sizeOptions} onChange={setSize} />
        <OptionGroup label="质量" value={quality} options={qualityOptions} onChange={setQuality} />
        <OptionGroup label="返回格式" value={responseFormat} options={responseFormatOptions} onChange={setResponseFormat} />
        <OptionGroup label="输出格式" value={outputFormat} options={outputFormatOptions} onChange={setOutputFormat} />

        {mode === "generate" ? (
          <PrimaryButton title={loading ? "生成中..." : "开始生成"} onPress={handleGenerate} loading={loading} />
        ) : (
          <PrimaryButton title={loading ? "编辑中..." : "开始编辑"} onPress={handleEdit} loading={loading} disabled={!canUseEdit} />
        )}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {status ? (
        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{status}</Text>
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
        {result?.b64_json ? <Text style={styles.helper}>当前返回的是 base64 数据，保存时会自动转成本地图片文件。</Text> : null}
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
    paddingVertical: 12,
    alignItems: "center",
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
  input: {
    minHeight: 120,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(8, 16, 32, 0.95)",
    color: "#F7FAFF",
    textAlignVertical: "top",
    fontSize: 15,
  },
  pickBlock: {
    gap: 10,
  },
  referenceSection: {
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
    fontSize: 13,
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
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  optionChipActive: {
    backgroundColor: "#5E85FF",
    borderColor: "#5E85FF",
  },
  optionChipText: {
    color: "#A9B7D6",
    fontSize: 12,
    fontWeight: "700",
  },
  optionChipTextActive: {
    color: "#FFFFFF",
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
  statusBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.30)",
  },
  statusText: {
    color: "#B9F6CE",
    fontSize: 13,
    lineHeight: 18,
  },
  preview: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  previewTitle: {
    color: "#F7FAFF",
    fontSize: 16,
    fontWeight: "800",
  },
  image: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  emptyPreview: {
    minHeight: 220,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 16, 32, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  emptyText: {
    color: "#8FA0C4",
    fontSize: 14,
  },
});
