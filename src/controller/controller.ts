import { ActionModel, ActionResult } from '../agent/models';
import { Browser } from '../browser/browser';
import { logger } from '../logger';
import { registerDefaultActions } from './default-actions';

/**
 * Represents a registered action
 */
interface Action {
  name: string;
  description: string;
  function: Function;
  browserContext: boolean;
  params: Record<string, ActionParameter>;
}

type ActionFunction = (...args: any[]) => Promise<ActionResult>;

interface ActionParameter {
  type: string;
  description: string;
}

/**
 * Controller for browser actions with integrated registry functionality
 */
export class Controller {
  private _actions: Record<string, Action> = {};

  constructor() {
    // Register default actions
    registerDefaultActions(this);
  }

  /**
   * Register an action
   * 
   * @param name - The name of the action
   * @param description - Description of what the action does
   * @param func - The function to be executed
   * @param browserContext - Whether the function requires browser context
   */
  registerAction({
    name,
    description,
    func,
    params,
    browserContext = false
  }: {
    name: string,
    description: string,
    func: ActionFunction,
    params?: Record<string, ActionParameter>,
    browserContext?: boolean
  }): void {
    this._actions[name] = {
      name,
      description,
      function: func,
      browserContext,
      params: params || {}
    };
  }

  /**
   * Execute an action from an ActionModel
   * 
   * @param action - The action model to execute
   * @param browser - The browser instance
   * @returns The result of the action
   */
  async executeAction(
    action: ActionModel,
    browser: Browser
  ): Promise<ActionResult> {
    const actionName = action.name;
    const params = action.params || {};

    logger.info(`Executing action: ${actionName} with params: ${JSON.stringify(params)}`);

    const actionObj = this._actions[actionName];

    if (!actionObj) {
      throw new Error(`Action ${actionName} not found`);
    }

    try {
      // Add browser to kwargs if it's needed
      if (actionObj.browserContext && browser) {
        params.browser = browser;
      }

      const result = await actionObj.function(params);
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Error executing action ${actionName}: ${errorMessage}`);
    }
  }

  /**
   * Get descriptions of all registered actions
   * 
   * @returns String representation of all actions and their metadata
   */
  getActionDescriptions(): string {
    const actionInfo: string[] = [];

    for (const [name, action] of Object.entries(this._actions)) {

      actionInfo.push(JSON.stringify({
        name,
        description: action.description,
        parameters: action.params
      }, null, 2));
    }

    return actionInfo.join('\n\n');
  }
} 