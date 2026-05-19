export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt?: number;
  isTyping?: boolean;
  parts?: RelayChatContentPart[];
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  id: string;
  kind: "image" | "file";
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  text?: string;
};

export type TaskStatus = "open" | "done";

export type TaskItem = {
  id: string;
  title: string;
  note: string;
  dueText?: string;
  priority: number;
  status: TaskStatus;
  source: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type RelayChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "low" | "high";
      };
    };

export type RelayChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | RelayChatContentPart[];
};

export type RelayChatRequest = {
  model: string;
  messages: RelayChatMessage[];
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
  localUri?: string;
};
