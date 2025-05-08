import { LaminarSpanContext, Laminar, observe } from '@lmnr-ai/lmnr';

import { MessageManager } from './messageManager';
import {
  ActionResult,
  AgentLLMOutput,
  AgentOutput,
  AgentState,
  AgentStreamChunk,
  FinalOutputChunk,
  StepChunk,
  ErrorChunk,
  TimeoutChunk,
} from './models';
import { Browser, BrowserConfig } from '../browser/browser';
import { Controller } from '../controller/controller';
import { MessageType, ThinkingBlock } from '../llm';
import { logger } from '../logger';
import { trace } from '@opentelemetry/api';
import { newUUID, otelTraceIdToUUID } from './utils';
import { AISdkAdapter } from '../llm/ai-sdk-adapter';
import { LanguageModelV1 } from 'ai';


/**
 * Agent class for executing tasks using LLM and browser automation
 */
export class Agent {
  private llm: AISdkAdapter;
  private controller: Controller;
  private browser: Browser;
  private messageManager: MessageManager;
  private state: AgentState;

  /**
   * Create a new Agent instance
   * 
   * @param llm - LLM provider to use
   * @param browserConfig - Optional browser configuration
   */
  constructor(
    llm: LanguageModelV1,
    browserConfig?: BrowserConfig
  ) {
    this.llm = new AISdkAdapter(llm);
    this.controller = new Controller();

    // Initialize browser with provided config or defaults
    this.browser = new Browser(browserConfig || {});

    const actionDescriptions = this.controller.getActionDescriptions();

    this.messageManager = new MessageManager(actionDescriptions);

    this.state = {
      messages: [],
    };
  }

  /**
   * Execute one step of the task
   * 
   * @param step - Current step number
   * @param previousResult - Optional result from previous step
   * @param stepSpanContext - Optional Laminar span context for tracing
   * @returns Tuple of action result and summary
   */
  private async step(
    step: number,
    previousResult?: ActionResult,
    stepSpanContext?: LaminarSpanContext
  ): Promise<{
    result: ActionResult;
    summary: string;
  }> {
    return await observe(
      {
        name: 'agent.step',
        parentSpanContext: stepSpanContext,
        input: {
          step,
        }
      },
      async () => {
        const state = await this.browser.updateState();

        if (previousResult) {
          this.messageManager.addCurrentStateMessage(state, previousResult);
        }

        const inputMessages = this.messageManager.getMessages();

        let modelOutput: AgentLLMOutput;
        try {
          // Generate the next action using the LLM
          modelOutput = await this.generateAction(inputMessages);
        } catch (e) {
          // If model call failed, remove the last state message from history before retrying
          this.messageManager.removeLastMessage();
          throw e;
        }

        if (previousResult) {
          // Remove the state message we just added because we want to append it in a different format
          this.messageManager.removeLastMessage();
        }

        // Add the model's response to the message history
        this.messageManager.addMessageFromModelOutput(step, previousResult || null, modelOutput, state.screenshot);

        try {
          // Execute the action
          const result = await this.controller.executeAction(
            modelOutput.action,
            this.browser
          );

          if (result.isDone) {
            logger.info(`Result: ${result.content}`);
          }

          return {
            result,
            summary: modelOutput.summary || '',
          };

        } catch (e) {
          // Handle action execution errors
          throw e;
        }
      });
  }

  /**
   * Generate the next action using the LLM
   * 
   * @param inputMessages - List of messages to send to the LLM
   * @returns Parsed agent LLM output
   */
  private async generateAction(inputMessages: MessageType[]): Promise<AgentLLMOutput> {
    return await observe(
      {
        name: 'agent.generateAction',
        ignoreInput: true,
      },
      async () => {
        // Call LLM to generate the next action
        const response = await this.llm.call(inputMessages);

        // Extract content between <output> tags using regex, including variations like <output_32>
        const pattern = /<output(?:[^>]*)>(.*?)<\/output(?:[^>]*)>/s;
        const match = pattern.exec(response.content);

        let jsonStr = "";

        if (!match) {
          // If <output> tags are not found, try to extract JSON content directly
          let cleanContent = response.content;

          // Remove any closing output tags that might exist
          cleanContent = cleanContent.replace(/<\/output(?:[^>]*)>/g, "");

          // Remove any opening output tags
          cleanContent = cleanContent.replace(/<output(?:[^>]*)>/g, "");

          // Remove any markdown code blocks
          jsonStr = cleanContent.replace(/```json/g, "").replace(/```/g, "").trim();
        } else {
          // Extract just the content between the tags
          jsonStr = match[1].trim();
        }

        try {
          // First try to parse it directly
          try {
            JSON.parse(jsonStr);
          } catch (jsonError) {
            // If direct parsing fails, try to clean the string
            // Replace escape characters with their actual characters
            jsonStr = jsonStr
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t');

            // Clean control characters except valid JSON whitespace (\n, \r, \t)
            jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
          }

          // Parse the JSON string to an object
          const jsonObj = JSON.parse(jsonStr.trim());

          // Create AgentLLMOutput from the parsed JSON
          const output: AgentLLMOutput = {
            action: jsonObj.action,
            thought: jsonObj.thought,
            summary: jsonObj.summary,
          };

          logger.info(`💡 Thought: ${output.thought}`);
          logger.info(`💡 Summary: ${output.summary}`);
          logger.info(`🛠️ Action: ${JSON.stringify(output.action)}`);

          if (response.thinking) {
            output.thinkingBlock = response.thinking as ThinkingBlock;
          }

          return output;
        } catch (e) {
          throw new Error(`Could not parse response: ${e}\nResponse was: ${jsonStr}`);
        }
      }
    );
  }

  /**
   * Set up agent messages based on state or initialize with system message
   * 
   * @param prompt - User prompt
   * @param agentState - Optional serialized agent state
   * @param startUrl - Optional URL to navigate to after setup
   * @param outputModel - Optional output model specification
   */
  private async setupMessages(
    prompt: string,
    agentState?: string,
    startUrl?: string,
    outputModel?: any
  ): Promise<void> {
    if (agentState) {
      // Initialize from existing state
      const state: AgentState = JSON.parse(agentState);
      this.messageManager.setMessages(state.messages);

      // Update browser state
      const browserState = await this.browser.updateState();
      this.messageManager.addCurrentStateMessage(browserState, null, prompt);
    } else {
      // Initialize with system message and user prompt
      await this.messageManager.addSystemMessageAndUserPrompt(prompt, outputModel);

      if (startUrl) {
        await this.browser.goto(startUrl);
        const browserState = await this.browser.updateState();
        this.messageManager.addCurrentStateMessage(browserState);
      }
    }
  }

  /**
   * Execute the task with maximum number of steps and return the final result
   * 
   * @param params - Run parameters
   * @returns Agent output
   */
  public async run({
    prompt,
    maxSteps = 100,
    agentState,
    parentSpanContext,
    sessionId,
    returnAgentState = false,
    returnStorageState = false,
    startUrl,
    outputModel
  }: {
    prompt: string;
    maxSteps?: number;
    agentState?: string;
    parentSpanContext?: LaminarSpanContext;
    closeContext?: boolean;
    sessionId?: string;
    returnAgentState?: boolean;
    returnStorageState?: boolean;
    startUrl?: string;
    outputModel?: any;
  }): Promise<AgentOutput> {
    if (!prompt && !agentState) {
      throw new Error("Either prompt or agentState must be provided");
    }

    try {
      return await observe(
        {
          name: 'agent.run',
          parentSpanContext,
          input: {
            prompt,
            maxSteps,
            stream: false,
          },
          // output is set manually below
          ignoreOutput: true
        },
        async () => {
          if (sessionId) {
            Laminar.setSpanAttributes({
              "lmnr.internal.agent_session_id": sessionId
            });
          }

          await this.setupMessages(prompt, agentState, startUrl, outputModel);

          let step = 0;
          let result: ActionResult | undefined;
          let isDone = false;

          // Generate a trace ID (this should use Laminar in a real implementation)
          const otelTraceId = trace.getActiveSpan()?.spanContext().traceId;
          const traceId = otelTraceId ? otelTraceIdToUUID(otelTraceId) : newUUID();

          try {
            while (!isDone && step < maxSteps) {
              logger.info(`📍 Step ${step}`);

              const { result: stepResult } = await this.step(step, result);
              result = stepResult;
              step += 1;
              isDone = result.isDone || false;

              if (isDone) {
                logger.info(`✅ Task completed successfully in ${step} steps`);
                break;
              }
            }

            if (!isDone) {
              logger.info('❌ Maximum number of steps reached');
            }

          } catch (e) {
            logger.info(`❌ Error in run: ${e}`);
            throw e;
          } finally {
            let storageState;

            if (returnStorageState) {
              storageState = await this.browser.getStorageState();
            }

            await this.browser.close();

            Laminar.setSpanAttributes({
              "lmnr.span.output": JSON.stringify(result)
            });

            return {
              agentState: returnAgentState ? this.getState() : undefined,
              result: result || { error: "No result produced" },
              storageState,
              stepCount: step,
              traceId,
            };
          }
        }
      );
    } finally {
      if (Laminar.initialized()) {
        await Laminar.flush();
      }
    }
  }

  /**
   * Execute the task with maximum number of steps and stream step chunks as they happen
   * 
   * @param params - Run stream parameters
   * @returns Stream of agent stream chunks
   */
  public async runStream({
    prompt,
    maxSteps = 100,
    agentState,
    parentSpanContext,
    timeout,
    sessionId,
    returnScreenshots = false,
    returnAgentState = false,
    returnStorageState = false,
    startUrl,
    outputModel
  }: {
    prompt: string;
    maxSteps?: number;
    agentState?: string;
    parentSpanContext?: LaminarSpanContext;
    closeContext?: boolean;
    timeout?: number;
    sessionId?: string;
    returnScreenshots?: boolean;
    returnAgentState?: boolean;
    returnStorageState?: boolean;
    startUrl?: string;
    outputModel?: any;
  }): Promise<ReadableStream<AgentStreamChunk>> {
    const agent = this;
    try {
      return new ReadableStream<AgentStreamChunk>({
        async start(controller) {
          const span = Laminar.startSpan({
            name: 'agent.run_stream',
            parentSpanContext: parentSpanContext || undefined,
            input: {
              prompt,
              maxSteps,
              stream: true,
            },
          });

          if (sessionId) {
            span.setAttribute("lmnr.internal.agent_session_id", sessionId);
          }
          const traceId = otelTraceIdToUUID(span.spanContext().traceId);

          Laminar.withSpan(span, async () => {
            await agent.setupMessages(prompt, agentState, startUrl, outputModel);
          });

          let step = 0;
          let result: ActionResult | undefined;
          let isDone = false;

          let startTime: number | null = null;
          if (timeout != null) {
            startTime = Date.now();
          }

          try {
            // Execute steps and stream results
            Laminar.withSpan(span, async () => {
              while (!isDone && step < maxSteps) {
                logger.info(`📍 Step ${step}`);

                const { result: stepResult, summary } = await agent.step(step, result);
                result = stepResult;
                step += 1;
                isDone = result?.isDone || false;

                let screenshot = null;
                if (returnScreenshots) {
                  const state = agent.browser.getState();
                  screenshot = state.screenshot;
                }

                if (timeout != null && startTime != null && Date.now() - startTime > timeout) {
                  controller.enqueue({
                    type: 'step_timeout',
                    content: {
                      actionResult: result,
                      summary,
                      step,
                      agentState: returnAgentState ? agent.getState() : undefined,
                      screenshot,
                      traceId
                    }
                  } as TimeoutChunk);

                  controller.close();
                  await agent.browser.close();
                  return;
                }

                controller.enqueue({
                  type: 'step',
                  content: {
                    actionResult: result,
                    summary,
                    traceId,
                    screenshot
                  }
                } as StepChunk);

                if (isDone) {
                  logger.info(`✅ Task completed successfully in ${step} steps`);

                  let storageState;
                  if (returnStorageState) {
                    storageState = await agent.browser.getStorageState();
                  }

                  // Send the final output as a chunk
                  const finalOutput: AgentOutput = {
                    agentState: returnAgentState ? agent.getState() : undefined,
                    result: result,
                    storageState,
                    stepCount: step,
                    traceId,
                  };

                  span.setAttribute("lmnr.span.output", JSON.stringify(result));
                  controller.enqueue({
                    type: 'final_output',
                    content: finalOutput
                  } as FinalOutputChunk);

                  controller.close();
                  await agent.browser.close();
                  break;
                }
              }

              if (!isDone) {
                logger.info('❌ Maximum number of steps reached');
                controller.enqueue({
                  type: 'error',
                  content: `Maximum number of steps reached: ${maxSteps}`
                } as ErrorChunk);
                controller.close();
                await agent.browser.close();
              }
            },
              true
            );

          } catch (e) {
            logger.error(`❌ Error in run: ${e}`);
            span.recordException(e as Error);
            span.end();
            await agent.browser.close();
            controller.enqueue({
              type: 'error',
              content: `Error in run stream: ${e}`
            } as ErrorChunk);

            controller.close();
          }
        },

        async cancel() {
          await agent.browser.close();
        },
      });
    } finally {
      if (Laminar.initialized()) {
        await Laminar.flush();
      }
    }
  }

  /**
   * Get the current state of the agent
   * 
   * @returns The current agent state
   */
  getState(): AgentState {
    this.state.messages = this.messageManager.getMessages();
    return this.state;
  }
}
