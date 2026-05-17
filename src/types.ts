export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  isTyping?: boolean;
};

export type RelayChatRequest = {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
};

export type RelayChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type ImageResponseFormat = "url" | "b64_json";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageSize = "auto" | "1024x1024" | "1536x1024" | "1024x1536" | "1536x864" | "3840x2160";
export type ImageOutputFormat = "png" | "jpeg";

export type RelayImageGenerationRequest = {
  model: string;
  prompt: string;
  n: 1;
  size?: ImageSize;
  quality?: ImageQuality;
  response_format?: ImageResponseFormat;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  background?: "opaque" | "transparent";
  moderation?: "auto" | "low";
  user?: string;
  stream?: boolean;
  partial_images?: number;
};

export type RelayImageEditRequest = {
  model: string;
  prompt: string;
  image: string;
  mask?: string;
  n: 1;
  size?: ImageSize;
  quality?: ImageQuality;
  response_format?: ImageResponseFormat;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  background?: "opaque" | "transparent";
  moderation?: "auto" | "low";
  input_fidelity?: "high" | "low" | "auto";
  user?: string;
  stream?: boolean;
  partial_images?: number;
};

export type RelayImageResponse = {
  created?: number;
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

export type ImageGenerationResult = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

