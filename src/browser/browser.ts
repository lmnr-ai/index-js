import {
  BrowserContext,
  Page,
  Browser as PlaywrightBrowser,
  chromium,
} from 'playwright';
import { logger } from '../logger';
import { backOff } from 'exponential-backoff';
import { Detector } from './detector';
import { BrowserState, TabInfo, Viewport, InteractiveElement } from './models';
import { findVisibleInteractiveElements } from './findVisibleInteractiveElements';
import { observe } from '@lmnr-ai/lmnr';
import { putHighlightElementsOnScreenshot } from './utils';

/**
 * Viewport size interface
 */
export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Browser configuration interface
 */
export interface BrowserConfig {
  cdpUrl?: string;
  viewportSize?: ViewportSize;
  storageState?: any;
  detector?: Detector;
}

/**
 * Implementation of the Browser interface using Playwright
 */
export class Browser {
  private config: BrowserConfig;
  private closeContext: boolean;
  private browser: PlaywrightBrowser | undefined;
  public context: BrowserContext | undefined;
  private currentPage: Page | undefined;
  private state: BrowserState | undefined;
  private cdpSession: any = null;
  private detector: Detector | undefined;

  /**
   * Create a new browser instance
   * @param config Browser configuration
   * @param closeContext Whether to close the context when done
   */
  constructor(config: BrowserConfig = {}, closeContext: boolean = true) {
    this.config = {
      viewportSize: { width: 1024, height: 768 },
      ...config
    };
    this.closeContext = closeContext;
    this.initState();
    this.detector = config.detector;
  }

  /**
   * Initialize the browser state
   * @param url Initial URL
   */
  private initState(url: string = ''): void {
    this.state = {
      url,
      tabs: [],
      viewport: new Viewport(),
      interactiveElements: {},
    };
  }

  /**
   * Initialize the browser instance
   */
  private async initBrowser(): Promise<this> {
    // Start playwright if needed
    logger.debug('Initializing browser context');

    // Initialize browser if needed
    if (!this.browser) {
      if (this.config.cdpUrl) {
        logger.info(`Connecting to remote browser via CDP ${this.config.cdpUrl}`);
        let attempts = 0;
        while (true) {
          try {
            this.browser = await chromium.connectOverCDP(
              this.config.cdpUrl,
              {
                timeout: 2500,
              }
            );
            break;
          } catch (e) {
            logger.error(`Failed to connect to remote browser via CDP ${this.config.cdpUrl}: ${e}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts += 1;
            if (attempts > 3) {
              throw e;
            }
          }
        }
        logger.info(`Connected to remote browser via CDP ${this.config.cdpUrl}`);
      } else {
        logger.info('Launching new browser instance');
        this.browser = await chromium.launch({
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-site-isolation-trials',
            '--disable-features=IsolateOrigins,site-per-process',
            `--window-size=${this.config.viewportSize?.width},${this.config.viewportSize?.height}`,
          ]
        });
      }
    }

    // Create context if needed
    if (!this.context) {
      if (this.browser.contexts().length > 0) {
        this.context = this.browser.contexts()[0];
      } else {
        this.context = await this.browser.newContext({
          viewport: this.config.viewportSize,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36',
          javaScriptEnabled: true,
          bypassCSP: true,
          ignoreHTTPSErrors: true
        });
      }

      // Apply anti-detection scripts
      await this.applyAntiDetectionScripts();

      this.context?.on('page', this.onPageChange.bind(this));
    }

    if (this.config.storageState && this.config.storageState.cookies) {
      await this.context?.addCookies(this.config.storageState.cookies);
    }

    // Create page if needed
    if (!this.currentPage) {
      const pages = this.context?.pages() ?? [];
      if (pages.length > 0) {
        this.currentPage = pages[pages.length - 1];
      } else {
        this.currentPage = await this.context?.newPage() ?? null;
      }
    }

    return this;
  }

  /**
   * Handle page change events
   * @param page New page
   */
  private async onPageChange(page: Page): Promise<void> {
    logger.info(`Current page changed to ${page.url()}`);
    this.cdpSession = await this.context?.newCDPSession(page);
    this.currentPage = page;
  }

  /**
   * Apply scripts to avoid detection as automation
   */
  private async applyAntiDetectionScripts(): Promise<void> {
    await this.context?.addInitScript(() => {
      // Webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US']
      });

      // Plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // Chrome runtime
      (window as any).chrome = { runtime: {} };

      // Permissions
      const originalQuery = window.navigator.permissions.query;
      (window as any).navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      (function () {
        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function attachShadow(options) {
          return originalAttachShadow.call(this, { ...options, mode: "open" });
        };
      })();
    });
  }

  /**
   * Close the browser instance and cleanup resources
   */
  public async close(): Promise<void> {
    logger.debug('Closing browser');

    try {
      // Close CDP session if exists
      this.cdpSession = null;

      // Close browser
      if (this.browser && this.closeContext) {
        try {
          await this.browser.close();
        } catch (e) {
          logger.info(`Failed to close browser: ${e}`);
        }
        this.browser = undefined;
      }
    } catch (e) {
      logger.error(`Error during browser cleanup: ${e}`);
    } finally {
      this.context = undefined;
      this.currentPage = undefined;
      this.state = undefined;
      this.browser = undefined;
    }
  }

  /**
   * Navigate to a URL
   * @param url URL to navigate to
   */
  public async goto(url: string): Promise<void> {
    const page = await this.getCurrentPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Get information about all tabs
   * @returns List of tab information
   */
  public async getTabsInfo(): Promise<TabInfo[]> {
    if (!this.context) {
      await this.initBrowser();
    }

    const pages = this.context?.pages() ?? [];
    const tabsInfo: TabInfo[] = [];
    for (let pageId = 0; pageId < pages.length; pageId++) {
      const page = pages[pageId];
      const tabInfo: TabInfo = {
        pageId,
        url: page.url(),
        title: await page.title()
      };
      tabsInfo.push(tabInfo);
    }

    return tabsInfo;
  }

  /**
   * Switch to a specific tab by its page_id
   * @param pageId Page ID to switch to
   */
  public async switchToTab(pageId: number): Promise<void> {
    if (!this.context) {
      await this.initBrowser();
    }

    const pages = this.context?.pages() ?? [];
    if (pageId >= pages.length) {
      throw new Error(`No tab found with page_id: ${pageId}`);
    }

    const page = pages[pageId];
    this.currentPage = page;

    await page.bringToFront();
    await page.waitForLoadState();
  }

  /**
   * Create a new tab and optionally navigate to a URL
   * @param url Optional URL to navigate to
   */
  public async createNewTab(url?: string): Promise<void> {
    if (!this.context) {
      await this.initBrowser();
    }

    const newPage = await this.context?.newPage();
    if (!newPage) return;

    this.currentPage = newPage;

    await newPage.waitForLoadState();

    if (url) {
      await newPage.goto(url, { waitUntil: 'domcontentloaded' });
    }
  }

  /**
   * Close the current tab
   */
  public async closeCurrentTab(): Promise<void> {
    if (!this.currentPage) {
      return;
    }

    await this.currentPage.close();

    // Switch to the first available tab if any exist
    if (this.context && (this.context.pages()?.length ?? 0) > 0) {
      await this.switchToTab(0);
    }
  }

  /**
   * Get the current page
   * @returns Current page
   */
  public async getCurrentPage(): Promise<Page> {
    if (!this.currentPage) {
      await this.initBrowser();
    }
    return this.currentPage!;
  }

  /**
   * Get the current browser state
   * @returns Current browser state
   */
  public getState(): BrowserState {
    return this.state!;
  }

  /**
   * Update the browser state with current page information and return it
   * @returns Updated browser state
   */
  public async updateState(): Promise<BrowserState> {
    try {
      // Apply exponential backoff with up to 3 attempts
      this.state = await backOff(
        async () => await observe(
          {
            name: 'browser.updateState',
            ignoreOutput: true,
          },
          this._updateState.bind(this)
        ),
        {
          numOfAttempts: 3,
          startingDelay: 500, // Start with 500ms
          timeMultiple: 1.5,  // Exponential multiplier
          delayFirstAttempt: false,
          retry: (e: Error) => {
            logger.warn(`Failed to update state, retrying: ${e.message}`);
            return true; // Always retry on error
          }
        });
      return this.state;
    } catch (e) {
      logger.error(`All attempts to update state failed: ${e}`);
      throw e;
    }
  }

  /**
   * Update and return state
   * @returns Updated browser state
   */
  private async _updateState(): Promise<BrowserState> {
    try {
      if (!this.currentPage) {
        await this.initBrowser();
      }
      const url = this.currentPage?.url() ?? '';

      // Check if we're on Google Sheets to enable specialized detection
      const detectSheets = url.includes('docs.google.com/spreadsheets/d');

      // Get screenshot using fast method
      const screenshot = await this.fastScreenshot();

      // Get interactive elements
      const interactiveElementsData = await this.getInteractiveElements(screenshot, detectSheets);
      const interactiveElements: Record<number, InteractiveElement> = {};

      // Convert array to object indexed by element index
      for (const element of interactiveElementsData.elements) {
        interactiveElements[element.index] = element;
      }

      // Create highlighted version of the screenshot
      const screenshotWithHighlights = await putHighlightElementsOnScreenshot(
        interactiveElements,
        screenshot
      );

      // Get tabs info
      const tabs = await this.getTabsInfo();

      // Update state with all collected data
      this.state = {
        url,
        tabs,
        screenshot,
        screenshotWithHighlights,
        viewport: interactiveElementsData.viewport || new Viewport(),
        interactiveElements,
      };

      return this.state;
    } catch (e) {
      logger.error(`Failed to update state: ${e}`);

      // Return last known good state if available
      if (this.state) {
        return this.state;
      }
      throw e;
    }
  }

  /**
   * Get cookies from the browser
   * @returns Cookies from the browser
   */
  public async getCookies(): Promise<any[]> {
    if (this.context) {
      return await this.context.cookies();
    }
    return [];
  }

  /**
   * Get storage state from the browser
   * @returns Storage state from the browser
   */
  public async getStorageState(): Promise<any> {
    if (this.context) {
      const cookies = await this.context.cookies();

      return {
        cookies,
      };
    }
    return {};
  }

  /**
   * Take a screenshot of the current page
   * @returns Base64 encoded screenshot
   */
  public async takeScreenshot(): Promise<string> {
    const page = await this.getCurrentPage();
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    return screenshot.toString('base64');
  }

  /**
   * Get a CDP session for the current page
   * @returns CDP session
   */
  private async getCdpSession(): Promise<any> {
    if (!this.currentPage) {
      await this.initBrowser();
    }

    // Create a new session if we don't have one or the page has changed
    if (!this.cdpSession || !this.currentPage) {
      this.cdpSession = await this.context?.newCDPSession(this.currentPage!);
    }

    return this.cdpSession;
  }

  /**
   * Take a fast screenshot using CDP
   * @returns Base64 encoded screenshot
   */
  public async fastScreenshot(): Promise<string> {
    return await observe(
      {
        name: 'browser.fastScreenshot',
        ignoreOutput: true,
      },
      async () => {
        const cdpSession = await this.getCdpSession();
        if (!cdpSession) return '';

        const screenshotParams = {
          format: "png",
          fromSurface: false,
          captureBeyondViewport: false,
        };

        const screenshotData = await cdpSession.send("Page.captureScreenshot", screenshotParams);
        return screenshotData?.data ?? '';
      }
    );
  }

  /**
   * Get all interactive elements on the page
   * @returns Interactive elements data
   */
  public async detectBrowserElements(): Promise<any> {
    return await observe(
      {
        name: 'browser.detectBrowserElements',
      },
      async () => {
        const page = await this.getCurrentPage();
        const result = await page.evaluate(findVisibleInteractiveElements);
        return result;
      }
    );
  }

  /**
   * Get interactive elements using browser detection
   * @param screenshotB64 Optional base64 encoded screenshot
   * @param detectSheets Whether to detect sheets elements
   * @returns Combined detection results
   */
  public async getInteractiveElements(screenshotB64?: string, detectSheets: boolean = false): Promise<any> {
    return await observe(
      {
        name: 'browser.getInteractiveElements',
        input: {
          detectSheets
        }
      },
      async () => {
        if (this.detector) {
          const scaleFactor = (this.state?.viewport?.width ?? 1024) / 1024;
          const cvElementsData = await this.detector?.detect(screenshotB64 ?? '', scaleFactor, detectSheets);
          return {
            viewport: this.state?.viewport,
            elements: [...(Object.values(this.state?.interactiveElements ?? {})), ...(cvElementsData ?? [])],
          };
        }
        const browserElementsData = await this.detectBrowserElements();
        return {
          viewport: browserElementsData.viewport,
          elements: browserElementsData.elements,
        };
      }
    );
  }
} 