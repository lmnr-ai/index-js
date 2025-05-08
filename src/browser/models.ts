/**
 * Represents information about a browser tab
 */
export interface TabInfo {
  pageId: number
  url: string
  title: string
}

/**
 * Represents the coordinates of an element
 */
export interface Coordinates {
  x: number
  y: number
  width?: number
  height?: number
}

/**
 * Represents a rectangle
 */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface InteractiveElement {
  index: number
  tagName: string
  text: string
  attributes: Record<string, string>
  viewport: Coordinates
  page: Coordinates
  center: Coordinates
  weight: number
  browserAgentId: string
  inputType?: string
  rect: Rect
  zIndex: number
}

/**
 * Represents a browser error
 */
export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Represents an error raised when a URL is not allowed
 */
export class URLNotAllowedError extends BrowserError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Represents the viewport of the browser
 */
export class Viewport {
  width: number = 1024
  height: number = 768
  scrollX: number = 0
  scrollY: number = 0
  devicePixelRatio: number = 1
  scrollDistanceAboveViewport: number = 0
  scrollDistanceBelowViewport: number = 0
}

/**
 * Represents the data returned by the interactive elements script
 */
export interface InteractiveElementsData {
  viewport: Viewport
  elements: InteractiveElement[]
}

/**
 * Represents the state of the browser
 */
export class BrowserState {
  url: string = ''
  tabs: TabInfo[] = []
  viewport: Viewport = new Viewport()
  interactiveElements: Record<number, InteractiveElement> = {}
  screenshotWithHighlights?: string
  screenshot?: string
}
