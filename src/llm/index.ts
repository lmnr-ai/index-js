/**
 * TypeScript implementation of the LLM interfaces and classes
 */

// Re-export the original message roles, interface types for compatibility
export enum MessageRole {
  SYSTEM = "system",
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool", // For OpenAI function calling responses
}

// Base interface for message content
export interface MessageContent {
  cacheControl?: boolean;
  type: "text" | "image" | "tool-result" | "thinking";
}

// Text content in a message
export interface TextContent extends MessageContent {
  text: string;
  type: "text";
}

// Image content in a message
export interface ImageContent extends MessageContent {
  imageB64?: string;
  imageUrl?: string;
  type: "image";
}

export interface ToolContent extends MessageContent {
  tool: string;
  type: "tool-result";
  toolCallId?: string;
  name?: string;
  result?: any;
}

// Thinking block in a message
export interface ThinkingBlock extends MessageContent {
  thinking: string;
  signature: string;
  type: "thinking";
}


export interface BaseMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent[] | string;
  isStateMessage?: boolean;
}

export interface SystemMessage extends BaseMessage {
  role: 'system';
  content: string;
  providerOptions?: Record<string, any>;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: MessageContent[] | string;
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: MessageContent[] | string;
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  content: MessageContent[] | string;
  name?: string;
  toolCallId?: string;
}

export type MessageType = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// LLM Response interface
export interface LLMResponse {
  content: string;
  rawResponse: any;
  usage: Record<string, number>;
  thinking?: ThinkingBlock;
}

