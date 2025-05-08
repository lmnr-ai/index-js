/**
 * Agent models for the index-js project
 */

import { MessageType, ThinkingBlock } from '../llm';

/**
 * State of the agent
 */
export interface AgentState {
  messages: MessageType[];
}

/**
 * Result of executing an action
 */
export interface ActionResult {
  isDone?: boolean;
  content?: string | Record<string, any>;
  error?: string;
  giveControl?: boolean;
}

/**
 * Model for an action
 */
export interface ActionModel {
  name: string;
  params: Record<string, any>;
}

/**
 * Output model for agent LLM
 */
export interface AgentLLMOutput {
  action: ActionModel;
  thought?: string;
  summary?: string;
  thinkingBlock?: ThinkingBlock;
}

/**
 * Output model for agent
 */
export interface AgentOutput {
  agentState?: AgentState;
  result: ActionResult;
  stepCount: number;
  storageState?: any;
  traceId?: string;
}

/**
 * Base class for chunks in the agent stream
 */
export interface AgentStreamChunk {
  type: string;
}

/**
 * Content for step chunks
 */
export interface StepChunkContent {
  actionResult: ActionResult;
  summary: string;
  traceId?: string;
  screenshot?: string;
}

/**
 * Chunk containing a step result
 */
export interface StepChunk extends AgentStreamChunk {
  type: 'step';
  content: StepChunkContent;
}

/**
 * Content for timeout chunks
 */
export interface TimeoutChunkContent {
  actionResult: ActionResult;
  summary: string;
  step: number;
  agentState?: AgentState;
  traceId?: string;
  screenshot?: string;
}

/**
 * Chunk containing a timeout
 */
export interface TimeoutChunk extends AgentStreamChunk {
  type: 'step_timeout';
  content: TimeoutChunkContent;
}

/**
 * Chunk containing an error
 */
export interface ErrorChunk extends AgentStreamChunk {
  type: 'error';
  content: string;
}

/**
 * Chunk containing the final output
 */
export interface FinalOutputChunk extends AgentStreamChunk {
  type: 'final_output';
  content: AgentOutput;
}
