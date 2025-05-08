import { ActionResult, AgentLLMOutput } from './models';
import { BrowserState } from '../browser/models';
import { TextContent, ImageContent, MessageType, MessageContent } from '../llm';
import { typeToCustomJtd, loadDemoImageAsB64 } from './utils';
import { scaleB64Image } from '../browser/utils';
import { systemMessage } from './prompts';

export class MessageManager {
  private _messages: MessageType[] = [];
  private actionDescriptions: string;

  constructor(actionDescriptions: string) {
    this._messages = [];
    this.actionDescriptions = actionDescriptions;
  }

  public async addSystemMessageAndUserPrompt(prompt: string, outputModel: any | null = null): Promise<void> {
    const complexLayoutHighlight = await loadDemoImageAsB64('complex_layout_highlight.png');
    const complexLayoutSmallElements = await loadDemoImageAsB64('complex_layout_small_elements.png');
    const stillLoading = await loadDemoImageAsB64('loading.png');
    const stillLoading2 = await loadDemoImageAsB64('loading2.png');
    const scrollOverElementExample = await loadDemoImageAsB64('scroll.png');

    const systemMsg: MessageType = {
      role: 'system',
      content: systemMessage(this.actionDescriptions),
    };

    this._messages.push(systemMsg);

    let outputModelStr = '';
    if (outputModel) {
      let outputFormat = '';
      if (typeof outputModel === 'function') {
        outputFormat = JSON.stringify(typeToCustomJtd(outputModel), null, 2);
      } else if (typeof outputModel === 'string') {
        outputFormat = outputModel;
      }

      outputModelStr = `

When you are ready to complete the task use \`done_with_structured_output\` action. Strictly provide output in the following JSON format and infer which fields best match the information you have gathered:

<output_model>
${outputFormat}
</output_model>
`;
    }

    this._messages.push({
      role: 'user',
      content: [
        { type: 'text', text: '<complex_layout_example>' } as TextContent,
        { type: 'text', text: "Here's an example of a complex layout. As an example, if you want to select a 'Roster' section for Colorado Rockies. Then you need to click on element with index 121." } as TextContent,
        { type: 'image', imageB64: complexLayoutHighlight } as ImageContent,
        { type: 'text', text: '</complex_layout_example>' } as TextContent,
        { type: 'text', text: '<small_elements_example>' } as TextContent,
        { type: 'text', text: "Here's an example of small elements on the page and their functions. Element 7, represented by 'x' icon, is a 'clear text' button. Element 8 is a 'submit' button, represented by '=' icon. This clarification should help you better understand similar layouts." } as TextContent,
        { type: 'image', imageB64: complexLayoutSmallElements } as ImageContent,
        { type: 'text', text: '</small_elements_example>' } as TextContent,
        { type: 'text', text: '<loading_pages_example>' } as TextContent,
        { type: 'text', text: "Here are some examples of loading pages. If the main content on the page is empty or if there are loading elements, such as skeleton screens, page is still loading. Then, you HAVE to perform `wait_for_page_to_load` action." } as TextContent,
        { type: 'image', imageB64: stillLoading } as ImageContent,
        { type: 'image', imageB64: stillLoading2 } as ImageContent,
        { type: 'text', text: '</loading_pages_example>' } as TextContent,
        { type: 'text', text: '<scroll_over_element_example>' } as TextContent,
        { type: 'text', text: "In some cases, to reveal more content, you need to scroll in scrollable areas of the webpage. Scrollable areas have VERTICAL scrollbars very clearly visible on their right side. In the screenshot below, you can clearly see a scrollbar on the right side of the list of search items. This indicates that the list is scrollable. To scroll over this area, you need to identify any element within the scrollable area and use its index with `scroll_down_over_element` action to scroll over it. In this example, approriate element is with index 15." } as TextContent,
        { type: 'image', imageB64: scrollOverElementExample } as ImageContent,
        { type: 'text', text: '</scroll_over_element_example>', cacheControl: true } as TextContent,
        {
          type: 'text', text: `Here is the task you need to complete:

<task>
${prompt}
</task>

Today's date and time is: ${new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })} - keep this date and time in mind when planning your actions.${outputModelStr}`
        } as TextContent,
      ]
    });
  }

  getMessagesAsState(): MessageType[] {
    return this._messages.filter(msg => msg.isStateMessage);
  }

  removeLastMessage(): void {
    if (this._messages.length > 1) {
      this._messages.pop();
    }
  }

  addCurrentStateMessage(
    state: BrowserState,
    previousResult: ActionResult | null = null,
    userFollowUpMessage: string | null = null,
  ): void {
    let highlightedElements = '';

    if (state.interactiveElements) {
      for (const [_, element] of Object.entries(state.interactiveElements)) {
        // exclude sheets elements
        if (element.browserAgentId.startsWith("row_") || element.browserAgentId.startsWith("column_")) {
          continue;
        }

        let startTag = `[${element.index}]<${element.tagName}`;

        if (element.inputType) {
          startTag += ` type="${element.inputType}"`;
        }

        startTag += ">";
        const elementText = element.text.replace(/\n/g, ' ');
        highlightedElements += `${startTag}${elementText}</${element.tagName}>\n`;
      }
    }

    const scrollDistanceAboveViewport = state.viewport.scrollDistanceAboveViewport || 0;
    const scrollDistanceBelowViewport = state.viewport.scrollDistanceBelowViewport || 0;

    let elementsText = '';
    if (scrollDistanceAboveViewport > 0) {
      elementsText = `${scrollDistanceAboveViewport}px scroll distance above current viewport\n`;
    } else {
      elementsText = '[Start of page]\n';
    }

    if (highlightedElements !== '') {
      elementsText += `\nHighlighted elements:\n${highlightedElements}`;
    }

    if (scrollDistanceBelowViewport > 0) {
      elementsText += `\n${scrollDistanceBelowViewport}px scroll distance below current viewport\n`;
    } else {
      elementsText += '\n[End of page]';
    }

    let previousActionOutput = '';
    if (previousResult) {
      previousActionOutput = previousResult.content
        ? `<previous_action_output>\n${previousResult.content}\n</previous_action_output>\n\n`
        : '';

      if (previousResult.error) {
        previousActionOutput += `<previous_action_error>\n${previousResult.error}\n</previous_action_error>\n\n`;
      }
    }

    const userFollowUpStr = userFollowUpMessage
      ? `<user_follow_up_message>\n${userFollowUpMessage}\n</user_follow_up_message>\n\n`
      : '';

    const stateDescription = `${previousActionOutput}${userFollowUpStr}
<viewport>
Current URL: ${state.url}

Open tabs:
${state.tabs}

Current viewport information:
${elementsText}
</viewport>`;

    const stateMsg: MessageType = {
      role: 'user',
      content: [
        { type: 'text', text: stateDescription } as TextContent,
        { type: 'text', text: '<current_state_clean_screenshot>' } as TextContent,
        { type: 'image', imageB64: state.screenshot } as ImageContent,
        { type: 'text', text: '</current_state_clean_screenshot>' } as TextContent,
        { type: 'text', text: '<current_state>' } as TextContent,
        { type: 'image', imageB64: state.screenshotWithHighlights } as ImageContent,
        { type: 'text', text: '</current_state>' } as TextContent,
      ]
    };

    this._messages.push(stateMsg);
  }

  async addMessageFromModelOutput(
    step: number,
    previousResult: ActionResult | null,
    modelOutput: AgentLLMOutput,
    screenshot?: string
  ): Promise<void> {
    let previousActionOutput = '';

    for (const msg of this._messages) {
      if (msg.isStateMessage) {
        msg.content = [
          typeof msg.content === 'string'
            ? { type: 'text', text: msg.content } as TextContent
            : msg.content[0]
        ];
      }
    }

    if (previousResult && screenshot) {
      previousActionOutput = previousResult.content
        ? `<action_output_${step - 1}>\n${previousResult.content}\n</action_output_${step - 1}>`
        : '';

      if (previousResult.error) {
        previousActionOutput += `<action_error_${step - 1}>\n${previousResult.error}\n</action_error_${step - 1}>`;
      }

      const usrMsg: MessageType = {
        role: 'user',
        content: [
          { type: 'text', text: previousActionOutput, cacheControl: true } as TextContent,
          { type: 'text', text: `<state_${step}>` } as TextContent,
          { type: 'image', imageB64: await scaleB64Image(screenshot, 0.75) } as ImageContent,
          { type: 'text', text: `</state_${step}>` } as TextContent,
        ],
        isStateMessage: true,
      };

      this._messages.push(usrMsg);
    }

    const { browser, ...restActionParams } = modelOutput.action.params;

    const assistantContent: MessageContent[] = [
      {
        type: 'text',
        text: `<output_${step}>
${JSON.stringify({
          thought: modelOutput.thought,
          action: {
            name: modelOutput.action.name,
            params: restActionParams,
          },
          summary: modelOutput.summary
        }, null, 2).trim()}
</output_${step}>`
      } as TextContent
    ];

    if (modelOutput.thinkingBlock) {
      assistantContent.unshift(modelOutput.thinkingBlock);
    }

    const msg: MessageType = {
      role: 'assistant',
      content: assistantContent,
    };

    this._messages.push(msg);
  }

  getMessages(): MessageType[] {
    let foundFirstCacheControl = false;

    // clear all past cache control except the latest one
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const msg = this._messages[i];

      // ignore system messages
      if (msg.role === 'system') {
        continue;
      }

      if (foundFirstCacheControl) {
        this.removeCacheControl(msg);
      }

      if (this.hasCacheControl(msg)) {
        foundFirstCacheControl = true;
      }
    }

    return this._messages;
  }

  setMessages(messages: MessageType[]): void {
    this._messages = messages;
  }

  private hasCacheControl(message: MessageType): boolean {
    return (message.content as MessageContent[]).some(content =>
      content.type === 'text' && 'cacheControl' in content && content.cacheControl === true
    );
  }

  private removeCacheControl(message: MessageType): void {
    for (const content of message.content as MessageContent[]) {
      if (content.type === 'text' && 'cacheControl' in content) {
        content.cacheControl = false;
      }
    }
  }
}
