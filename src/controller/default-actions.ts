import { ActionResult } from '../agent/models';
import { Browser } from '../browser/browser';
import { Controller } from './controller';
import { logger } from '../logger';

/**
 * Register all default browser actions to the provided controller
 * @param controller - The controller to register actions to
 */
export function registerDefaultActions(controller: Controller): void {
  // Done action
  controller.registerAction({
    name: 'done',
    description: 'Use this action when you have completed the task.',
    params: {
      output: {
        type: 'string',
        description: 'Output of the task.'
      }
    },
    func: async ({ output }: { output: string }): Promise<ActionResult> =>
    ({
      isDone: true,
      content: output
    }),
  });

  // Done with structured output action
  controller.registerAction({
    name: 'done_with_structured_output',
    description: 'Use this action ONLY when you are provided with a structured output model. Otherwise, use simple `done` action.',
    params: {
      output: {
        type: 'object',
        description: 'JSON object that adheres to the provided output model.'
      }
    },
    func: async ({ output }: { output: Record<string, any> }): Promise<ActionResult> =>
    ({
      isDone: true,
      content: JSON.stringify(output) // Convert object to string
    }),
  });

  // Give human control action
  controller.registerAction({
    name: 'give_human_control',
    description: 'Give human control of the browser. Use this action when you need to use user information, such as first name, last name, email, phone number, booking information, login/password, etc. to proceed with the task. Also, if you can\'t solve the CAPTCHA, use this action.',
    params: {
      message: {
        type: 'string',
        description: 'Message to give to the human, explaining why you need human intervention.'
      }
    },
    func: async ({ message }: { message: string, }): Promise<ActionResult> =>
    ({
      giveControl: true,
      content: message,
      isDone: true
    }),
  });

  // Search Google action
  controller.registerAction({
    name: 'search_google',
    description: 'Open google search in new tab and search for the query.',
    params: {
      query: {
        type: 'string',
        description: 'Query to search for in Google.'
      },
    },
    func: async ({ query, browser }: { query: string, browser: Browser }): Promise<ActionResult> => {
      const page = await browser.getCurrentPage();
      await page.goto(`https://www.google.com/search?q=${query}&udm=14`);
      await page.waitForLoadState();
      const msg = `Searched for '${query}' in Google`;
      logger.info(msg);
      return { content: msg };
    },
    browserContext: true
  });

  // Go to URL action
  controller.registerAction({
    name: 'go_to_url',
    description: 'Navigate to URL in the current tab',
    params: {
      url: {
        type: 'string',
        description: 'URL to navigate to.'
      },
    },
    func: async ({ url, browser }: { url: string, browser: Browser }): Promise<ActionResult> => {
      try {
        const page = await browser.getCurrentPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await new Promise(resolve => setTimeout(resolve, 1500)); // Sleep for 1.5 seconds
        const msg = `Navigated to ${url}`;
        logger.info(msg);
        return { content: msg };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error navigating to URL: ${errorMessage}`);
        return { error: errorMessage };
      }
    },
    browserContext: true
  });

  // Go back to previous page action
  controller.registerAction({
    name: 'go_back_to_previous_page',
    description: 'Go back to the previous page',
    func: async ({ browser }: { browser: Browser }): Promise<ActionResult> => {
      try {
        const page = await browser.getCurrentPage();
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Sleep for 2 seconds
        const msg = 'Navigated back to the previous page';
        logger.info(msg);
        return { content: msg };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug(`During go_back: ${errorMessage}`);
        return { error: errorMessage };
      }
    },
    browserContext: true
  });

  // Click spreadsheet cell action
  controller.registerAction({
    name: 'click_spreadsheet_cell',
    description: 'Click on the cell in the spreadsheet.',
    params: {
      row: {
        type: 'string',
        description: 'Row of the cell to click on, it should be a number formatted as a string. e.g. "1"'
      },
      column: {
        type: 'string',
        description: 'Column of the cell to click on, it should be a letter formatted as a string. e.g. "A"'
      },
    },
    func: async ({ row, column, browser }: { row: string, column: string, browser: Browser }): Promise<ActionResult> => {
      const page = await browser.getCurrentPage();
      const state = browser.getState();

      const elements = Object.values(state.interactiveElements);
      const rowElement = elements.find(element => element.browserAgentId === `row_${row}`);
      const columnElement = elements.find(element => element.browserAgentId === `column_${column}`);

      if (!rowElement || !columnElement) {
        return {
          error: 'Row or column element not found - pay close attention to the row and column numbers.'
        }
      }

      await page.mouse.click(state.viewport.width / 2, state.viewport.height / 2);
      await new Promise(resolve => setTimeout(resolve, 50));

      await page.mouse.click(rowElement.center.x, rowElement.center.y);
      await new Promise(resolve => setTimeout(resolve, 50));

      return {
        content: `Clicked on spreadsheet cell with row ${row} and column ${column}`
      }
    },
    browserContext: true
  });

  // Click element action
  controller.registerAction({
    name: 'click_element',
    description: 'Click on the element with index.',
    params: {
      index: {
        type: 'number',
        description: 'Index of the element to click on.'
      },
      waitAfterClick: {
        type: 'boolean',
        description: 'If True, wait for 2 second after clicking the element. Only set it to True when you think that clicking will trigger loading state, for instance navigation to new page, search, loading of a content, etc.'
      }
    },
    func: async ({
      index,
      browser,
      waitAfterClick = false
    }: {
      index: number | string,
      browser: Browser,
      waitAfterClick?: boolean
    }): Promise<ActionResult> => {
      // Clean index if it contains any non-numeric characters
      const cleanedIndexStr = String(index).replace(/\D/g, '');
      if (cleanedIndexStr === '') {
        logger.error(`Index is not a number. Index: ${index}`);
        return { error: "`index` should be a valid number." };
      }

      const cleanedIndex = parseInt(cleanedIndexStr, 10);
      const state = browser.getState();

      if (!state.interactiveElements[cleanedIndex]) {
        return { error: `Element with index ${cleanedIndex} does not exist - retry or use alternative actions.` };
      }

      const element = state.interactiveElements[cleanedIndex];
      const initialPages = browser.context ? browser.context.pages.length : 0;

      try {
        const page = await browser.getCurrentPage();
        await page.mouse.click(element.center.x, element.center.y);

        let msg = `Clicked element with index ${cleanedIndex}: <${element.tagName}></${element.tagName}>`;

        logger.info(msg);
        if (browser.context && browser.context.pages.length > initialPages) {
          const newTabMsg = 'New tab opened - switching to it';
          msg += ` - ${newTabMsg}`;
          logger.info(newTabMsg);
          await browser.switchToTab(-1);
        }

        if (waitAfterClick) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Sleep for 2 seconds
        }

        return { content: msg };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { error: errorMessage };
      }
    },
    browserContext: true
  });

  // Wait for page to load action
  controller.registerAction({
    name: 'wait_for_page_to_load',
    description: 'Use this action to wait for the page to load, if you see that the content on the clean screenshot is empty or loading UI elements such as skeleton screens. This action will wait for page to load. Then you can continue with your actions.',
    func: async (): Promise<ActionResult> => {
      return { content: 'Waited for page to load' };
    },
  });

  // Enter text action
  controller.registerAction({
    name: 'enter_text',
    description: 'Enter text with a keyboard. Use it AFTER you have clicked on an input element. This action will override the current text in the element.',
    params: {
      text: {
        type: 'string',
        description: 'Text to enter with a keyboard.'
      },
      pressEnter: {
        type: 'boolean',
        description: 'If True, press Enter after entering the text.'
      },
    },
    func: async ({
      text,
      pressEnter,
      browser
    }: {
      text: string,
      pressEnter: boolean,
      browser: Browser
    }): Promise<ActionResult> => {
      try {
        const page = await browser.getCurrentPage();
        // clear the element
        await page.keyboard.press("ControlOrMeta+a");
        await new Promise(resolve => setTimeout(resolve, 100)); // Sleep for 0.1 seconds
        await page.keyboard.press("Backspace");
        await new Promise(resolve => setTimeout(resolve, 100)); // Sleep for 0.1 seconds

        // input text into the element
        await page.keyboard.type(text);

        if (pressEnter) {
          await page.keyboard.press("Enter");
          await new Promise(resolve => setTimeout(resolve, 2000)); // Sleep for 2 seconds
        }

        const msg = `Entered "${text}" on the keyboard. Make sure to double check that the text was entered to where you intended.`;
        logger.info(msg);
        return { content: msg };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { error: `Failed to enter text. Error: ${errorMessage}` };
      }
    },
    browserContext: true
  });
} 