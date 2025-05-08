/**
 * Adapter for using AI SDK providers directly with existing code
 */
import {
  CoreAssistantMessage,
  CoreMessage,
  CoreSystemMessage,
  CoreToolMessage,
  CoreUserMessage,
  ImagePart,
  LanguageModelV1,
  TextPart,
  generateText
} from 'ai';
import {
  ImageContent,
  LLMResponse,
  MessageType,
  TextContent,
  ThinkingBlock,
  ToolContent,
} from './index';
import { logger } from '../logger';
import { backOff } from 'exponential-backoff';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import { getTracer } from '@lmnr-ai/lmnr';

/**
 * Adapter that wraps an AI SDK provider to match our BaseLLMProvider interface
 */
export class AISdkAdapter {
  provider: LanguageModelV1;
  fallbackProvider?: AISdkAdapter;

  constructor(provider: LanguageModelV1) {
    this.provider = provider;
    if (this.provider.provider === 'anthropic') {
      this.fallbackProvider = new AISdkAdapter(bedrock(this.provider.modelId));
    }
  }

  /**
   * Format our message type to AI SDK format
   */
  private formatMessages(messages: MessageType[]): CoreMessage[] {
    return messages.map(message => {
      if (message.role === 'tool') {
        const toolContent = message.content as ToolContent[];
        return {
          role: message.role,
          content: toolContent
            .filter(content => content.type === 'tool-result')
            .map(content => ({
              type: 'tool-result',
              toolCallId: (content as ToolContent).toolCallId,
              toolName: (content as ToolContent).tool,
              result: (content as ToolContent).result,
              providerOptions: {
                anthropic: (content as ToolContent).cacheControl ? {
                  cacheControl: {
                    type: 'ephemeral'
                  }
                } : {}
              }
            })) as CoreToolMessage['content'],
          name: message.name,
        } as CoreToolMessage;
      }
      if (message.role === 'system') {
        return {
          role: message.role,
          content: message.content
        } as CoreSystemMessage;
      }
      if (typeof message.content === 'string') {
        return {
          role: message.role,
          content: message.content
        };
      }

      const formattedContent: (TextPart | ImagePart)[] = [];

      message.content.forEach(content => {
        if (content.type === 'text') {
          const textContent = content as TextContent;
          const providerOptions = textContent.cacheControl ? {
            anthropic: {
              cacheControl: {
                type: 'ephemeral'
              }
            }
          } : {};
          formattedContent.push({
            type: 'text',
            text: textContent.text,
            providerOptions
          } as TextPart);
        } else if (content.type === 'image') {
          const imgContent = content as ImageContent;
          const providerOptions = imgContent.cacheControl ? {
            anthropic: {
              cacheControl: {
                type: 'ephemeral'
              }
            }
          } : {};
          formattedContent.push({
            type: 'image',
            image: imgContent.imageUrl || `data:image/png;base64,${imgContent.imageB64}`,
            providerOptions
          } as ImagePart);
        }
      });

      return {
        role: message.role as 'user' | 'assistant',
        content: formattedContent.length === 1 && formattedContent[0].type === 'text'
          ? formattedContent[0].text  // Use text directly for simple text messages
          : formattedContent,         // Use array for multi-modal
      } as CoreUserMessage | CoreAssistantMessage;
    });
  }

  /**
   * Call the AI SDK provider with proper retry and fallback handling
   */
  async call(
    messages: MessageType[],
    temperature: number = 1.0,
    maxTokens?: number,
    options: Record<string, any> = {}
  ): Promise<LLMResponse> {
    const backoffOptions = {
      numOfAttempts: options.maxRetries || 3,
      startingDelay: 500,
      maxDelay: 10000,
      timeMultiple: 2,
      retry: async (error: any): Promise<boolean> => {
        const shouldRetry = !options.noRetry &&
          (error.status === 429 || error.status >= 500);

        if (shouldRetry) {
          logger.info(`Retrying API call due to error: ${error.message}`);
        }

        return shouldRetry;
      }
    };

    try {
      // Use backoff library for retries with exponential backoff
      return await backOff(async () => {
        try {
          // Format messages for AI SDK
          const formattedMessages = this.formatMessages(messages);

          // Extract system message if present
          let systemMessage;
          let userMessages = [...formattedMessages];

          if (formattedMessages.length > 0 && formattedMessages[0].role === 'system') {
            systemMessage = formattedMessages[0].content;
            userMessages = formattedMessages.slice(1);
          }

          // Configure options for the AI SDK call
          const sdkOptions = {
            temperature,
            maxTokens,
            ...options
          };

          // Use AI SDK to generate response
          const response = await generateText({
            model: this.provider,
            messages: userMessages,
            system: systemMessage,
            experimental_telemetry: {
              isEnabled: true,
              tracer: getTracer()
            },
            ...sdkOptions
          });

          // Format the response to match our expected LLMResponse format
          return {
            content: response.text,
            rawResponse: response,
            usage: {
              prompt_tokens: response.usage?.promptTokens || 0,
              completion_tokens: response.usage?.completionTokens || 0,
              total_tokens: response.usage?.totalTokens || 0
            },
            thinking: options.includeThinking ? {
              thinking: response.reasoning || "",
              signature: response.reasoningDetails.map(detail => detail.type === "text" ? (detail.signature ?? "") : "").join("\n"),
              type: "thinking"
            } as ThinkingBlock : undefined
          };
        } catch (error: any) {
          logger.error(`Error calling AI SDK provider: ${error.message}`);
          throw error;
        }
      }, backoffOptions);

    } catch (error: unknown) {
      // If primary provider fails after all retries, try fallback if available
      if (this.fallbackProvider) {
        logger.warn(`Primary provider failed after retries, using fallback provider`);
        try {
          return await this.fallbackProvider.call(messages, temperature, maxTokens, options);
        } catch (fallbackError: unknown) {
          logger.error(`Fallback provider also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
          throw fallbackError;
        }
      }

      // No fallback or fallback also failed
      throw error;
    }
  }
}
