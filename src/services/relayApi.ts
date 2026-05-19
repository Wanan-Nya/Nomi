import { RelayConnectionSettings } from "@/context/RelaySettingsContext";
import {
  ImageGenerationResult,
  RelayChatContentPart,
  RelayChatRequest,
  RelayChatResponse,
  RelayImageEditRequest,
  RelayImageGenerationRequest,
  RelayImageResponse,
} from "@/types";

const chatEndpoint = process.env.EXPO_PUBLIC_CHAT_ENDPOINT ?? "/v1/chat/completions";
const imageGenerationEndpoint = process.env.EXPO_PUBLIC_IMAGE_GENERATION_ENDPOINT ?? "/v1/images/generations";
const imageEditEndpoint = process.env.EXPO_PUBLIC_IMAGE_EDIT_ENDPOINT ?? "/v1/images/edits";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/$/, "");
}

function buildUrl(baseUrl: string, path: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("Please set the API base URL first.");
  }

  return `${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(apiKey: string) {
  const headers: Record<string, string> = {
    Accept: "*/*",
  };

  const trimmedKey = apiKey.trim();
  if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }

  return headers;
}

async function parseJsonResponse<T>(response: Response, requestName: string): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!response.ok) {
    throw new Error(trimmed || `${requestName} failed: ${response.status}`);
  }

  if (!trimmed) {
    throw new Error(`${requestName} returned an empty response.`);
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${requestName} returned invalid JSON.`);
  }
}

async function requestJson<T>(config: RelayConnectionSettings, path: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(config.baseUrl, path), {
    method: "POST",
    headers: {
      ...authHeaders(config.apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse<T>(response, path);
}

async function requestFormData<T>(config: RelayConnectionSettings, path: string, formData: FormData): Promise<T> {
  const response = await fetch(buildUrl(config.baseUrl, path), {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: formData,
  });

  return parseJsonResponse<T>(response, path);
}

export async function sendChatMessage(config: RelayConnectionSettings, messages: RelayChatRequest["messages"]) {
  const data = await requestJson<RelayChatResponse>(config, chatEndpoint, {
    model: config.model,
    messages,
  });

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("The chat endpoint returned no usable content.");
  }

  return content;
}

export async function generateImage(
  config: RelayConnectionSettings,
  prompt: string,
  options: {
    size?: RelayImageGenerationRequest["size"];
    quality?: RelayImageGenerationRequest["quality"];
    responseFormat?: RelayImageGenerationRequest["response_format"];
    outputFormat?: RelayImageGenerationRequest["output_format"];
  } = {}
): Promise<ImageGenerationResult> {
  const payload: RelayImageGenerationRequest = {
    model: config.model,
    prompt,
    n: 1,
    size: options.size,
    quality: options.quality,
    response_format: options.responseFormat ?? "url",
    output_format: options.outputFormat ?? "png",
  };

  const data = await requestJson<RelayImageResponse>(config, imageGenerationEndpoint, payload);
  const image = data.data?.[0];
  if (!image?.url && !image?.b64_json) {
    throw new Error("The image endpoint returned no usable result.");
  }

  return image;
}

export async function editImage(
  config: RelayConnectionSettings,
  input: {
    prompt: string;
    images: Array<{
      uri: string;
      name?: string;
      type?: string;
    }>;
    size?: RelayImageEditRequest["size"];
    quality?: RelayImageEditRequest["quality"];
    responseFormat?: RelayImageEditRequest["response_format"];
    outputFormat?: RelayImageEditRequest["output_format"];
    inputFidelity?: RelayImageEditRequest["input_fidelity"];
  }
): Promise<ImageGenerationResult> {
  if (!input.images.length) {
    throw new Error("Please choose at least one reference image.");
  }

  const formData = new FormData();
  formData.append("model", config.model);
  formData.append("prompt", input.prompt);
  formData.append("n", "1");
  formData.append("response_format", input.responseFormat ?? "url");
  formData.append("output_format", input.outputFormat ?? "png");

  if (input.size) {
    formData.append("size", input.size);
  }
  if (input.quality) {
    formData.append("quality", input.quality);
  }
  if (input.inputFidelity) {
    formData.append("input_fidelity", input.inputFidelity);
  }

  input.images.forEach((image, index) => {
    formData.append(
      "image",
      {
        uri: image.uri,
        name: image.name ?? `image-${index + 1}.jpg`,
        type: image.type ?? "image/jpeg",
      } as any
    );
  });

  const data = await requestFormData<RelayImageResponse>(config, imageEditEndpoint, formData);
  const image = data.data?.[0];
  if (!image?.url && !image?.b64_json) {
    throw new Error("The image edit endpoint returned no usable result.");
  }

  return image;
}
