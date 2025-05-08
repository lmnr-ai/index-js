import * as fs from 'fs';
import * as path from 'path';
import sharp, { OverlayOptions, Blend } from 'sharp';
import { InteractiveElement, Rect } from './models';
import { logger } from '../logger';
import fontkit, { Font } from 'fontkit';
import { getDirname } from '../utils';

type Label = {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type RGBColor = {
  r: number;
  g: number;
  b: number;
}

/**
 * Highlight elements on a screenshot
 */
export async function putHighlightElementsOnScreenshot(
  elements: Record<number, InteractiveElement>,
  screenshotB64: string
): Promise<string> {
  try {
    // Decode base64 to buffer
    const imageBuffer = Buffer.from(screenshotB64, 'base64');
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image dimensions');
    }

    // Create a composite array for overlays
    const composites: OverlayOptions[] = [];

    // Base colors (RGB format)
    const baseColors: RGBColor[] = [
      { r: 204, g: 0, b: 0 },
      { r: 0, g: 136, b: 0 },
      { r: 0, g: 0, b: 204 },
      { r: 204, g: 112, b: 0 },
      { r: 102, g: 0, b: 102 },
      { r: 0, g: 102, b: 102 },
      { r: 204, g: 51, b: 153 },
      { r: 44, g: 0, b: 102 },
      { r: 204, g: 35, b: 0 },
      { r: 28, g: 102, b: 66 },
      { r: 170, g: 0, b: 0 },
      { r: 36, g: 82, b: 123 }
    ];

    const placedLabels: Label[] = [];

    const generateUniqueColor = (baseColor: RGBColor, elementIdx: number): RGBColor => {
      // Generate a unique color variation based on element index
      let { r, g, b } = baseColor;

      // Use prime numbers to create deterministic but non-repeating patterns
      const offsetR = (elementIdx * 17) % 31 - 15; // Range: -15 to 15
      const offsetG = (elementIdx * 23) % 29 - 14; // Range: -14 to 14
      const offsetB = (elementIdx * 13) % 27 - 13; // Range: -13 to 13

      // Ensure RGB values stay within 0-255 range
      r = Math.max(0, Math.min(255, r + offsetR));
      g = Math.max(0, Math.min(255, g + offsetG));
      b = Math.max(0, Math.min(255, b + offsetB));

      return { r, g, b };
    };

    let font: Font | null = null;
    try {
      // Load custom font from the assets directory
      const standardPath = path.join(getDirname(), '..', 'assets', 'fonts', 'OpenSans-Medium.ttf');

      // Fallback paths for different environments and tests
      const fallbackPaths = [
        path.join(getDirname(), '..', '..', 'assets', 'fonts', 'OpenSans-Medium.ttf'), // For tests
        path.join(process.cwd(), 'assets', 'fonts', 'OpenSans-Medium.ttf'), // Using cwd
        path.join(process.cwd(), 'index-js', 'assets', 'fonts', 'OpenSans-Medium.ttf'), // Absolute path
      ];

      // Try standard path first
      try {
        font = await fontkit.open(standardPath) as Font;
      } catch (e) {
        // If standard path fails, try fallbacks
        let fontFound = false;
        for (const fallbackPath of fallbackPaths) {
          try {
            font = await fontkit.open(fallbackPath) as Font;
            fontFound = true;
            break;
          } catch {
            // Continue to the next fallback
            continue;
          }
        }

        // If all paths fail, throw to fallback to system fonts
        if (!fontFound) {
          throw new Error('Could not find font in any of the expected locations');
        }
      }
    } catch (e) {
      logger.warn(`Could not load custom font: ${e}, falling back to default`);
      let systemFontPath = '';
      // Different paths based on OS
      if (process.platform === 'darwin') {
        // macOS
        systemFontPath = '/System/Library/Fonts/Helvetica.ttc';
      } else if (process.platform === 'win32') {
        // Windows
        systemFontPath = 'C:\\Windows\\Fonts\\calibri.ttf';
      } else {
        // Linux and others
        systemFontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
      }
      if (fs.existsSync(systemFontPath)) {
        font = await fontkit.open(systemFontPath) as Font;
      } else {
        throw new Error('System font not found');
      }
    }

    if (!font) {
      throw new Error('Failed to load any font');
    }

    for (const [idxStr, element] of Object.entries(elements)) {
      // Object.entries converts the keys to strings, so we need to parse the index
      const idx = parseInt(idxStr, 10);

      // Don't draw sheets elements
      if (
        element.browserAgentId.startsWith('row_') ||
        element.browserAgentId.startsWith('column_')
      ) {
        continue;
      }

      const baseColor = baseColors[idx % baseColors.length];
      const color = generateUniqueColor(baseColor, idx);

      const rect = element.rect;

      // Draw rectangle
      // Create a rectangle SVG for the border
      const rectSvg = Buffer.from(
        `<svg width="${metadata.width}" height="${metadata.height}">
          <rect 
            x="${rect.left}" 
            y="${rect.top}" 
            width="${rect.width}" 
            height="${rect.height}" 
            fill="none" 
            stroke="rgb(${color.r},${color.g},${color.b})" 
            stroke-width="2" 
          />
        </svg>`
      );

      composites.push({
        input: rectSvg,
        blend: 'over' as Blend
      });

      // Prepare label
      const text = idxStr;

      // TODO: use heuristics?
      const textWidth = 10;  // Approximate width of a digit
      const textHeight = 12; // Approximate font height

      // Make label size exactly proportional for better aesthetics
      const labelWidth = textWidth + 4;
      const labelHeight = textHeight + 4;

      // Positioning logic
      let labelX = rect.left + rect.width;
      let labelY = rect.top;

      if (labelWidth > rect.width || labelHeight > rect.height) {
        labelX = rect.left + rect.width;
        labelY = rect.top;
      } else {
        labelX = rect.left + rect.width - labelWidth;
        labelY = rect.top;
      }

      // Check for overlaps with existing labels
      const labelRect = {
        left: labelX,
        top: labelY,
        right: labelX + labelWidth,
        bottom: labelY + labelHeight
      };

      for (const existing of placedLabels) {
        if (
          !(
            labelRect.right < existing.left ||
            labelRect.left > existing.right ||
            labelRect.bottom < existing.top ||
            labelRect.top > existing.bottom
          )
        ) {
          labelY = existing.bottom + 2;
          labelRect.top = labelY;
          labelRect.bottom = labelY + labelHeight;
          break;
        }
      }

      // Ensure label is visible within image boundaries
      if (labelX < 0) {
        labelX = 0;
      } else if (labelX + labelWidth >= metadata.width) {
        labelX = metadata.width - labelWidth - 1;
      }

      if (labelY < 0) {
        labelY = 0;
      } else if (labelY + labelHeight >= metadata.height) {
        labelY = metadata.height - labelHeight - 1;
      }

      // Create a label SVG
      const labelSvg = Buffer.from(
        `<svg width="${metadata.width}" height="${metadata.height}">
          <rect 
            x="${labelX}" 
            y="${labelY}" 
            width="${labelWidth}" 
            height="${labelHeight}" 
            fill="rgb(${color.r},${color.g},${color.b})" 
          />
          <text 
            x="${labelX + 3}" 
            y="${labelY + textHeight - 1}" 
            font-family="${font.familyName}" 
            font-size="11px" 
            fill="white"
          >${text}</text>
        </svg>`
      );

      composites.push({
        input: labelSvg,
        blend: 'over' as Blend
      });

      placedLabels.push(labelRect);
    }

    // Apply all composites at once
    const result = await image.composite(composites).toBuffer();

    // Convert to base64
    return result.toString('base64');
  } catch (e) {
    logger.error(`Failed to add highlights to screenshot: ${e}`);
    return screenshotB64;
  }
}

/**
 * Scale a base64 encoded image
 */
export async function scaleB64Image(imageB64: string, scaleFactor: number): Promise<string> {
  try {
    // Decode base64 to buffer
    const imageBuffer = Buffer.from(imageB64, 'base64');
    const image = sharp(imageBuffer);

    // Get original dimensions
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      return imageB64;
    }

    // Calculate new dimensions
    const newWidth = Math.floor(metadata.width * scaleFactor);
    const newHeight = Math.floor(metadata.height * scaleFactor);

    // Resize the image
    const resizedBuffer = await image
      .resize(newWidth, newHeight, {
        kernel: sharp.kernel.lanczos3, // High quality resampling
        fit: 'fill'
      })
      .toBuffer();

    // Convert back to base64
    return resizedBuffer.toString('base64');
  } catch (e) {
    return imageB64;
  }
}

/**
 * Calculate Intersection over Union between two rectangles
 */
export function calculateIou(rect1: Rect, rect2: Rect): number {
  // Calculate intersection
  const intersectLeft = Math.max(rect1.left, rect2.left);
  const intersectTop = Math.max(rect1.top, rect2.top);
  const intersectRight = Math.min(rect1.right, rect2.right);
  const intersectBottom = Math.min(rect1.bottom, rect2.bottom);

  // Check if intersection exists
  if (intersectRight < intersectLeft || intersectBottom < intersectTop) {
    return 0.0; // No intersection
  }

  // Calculate area of each rectangle
  const area1 = (rect1.right - rect1.left) * (rect1.bottom - rect1.top);
  const area2 = (rect2.right - rect2.left) * (rect2.bottom - rect2.top);

  // Calculate area of intersection
  const intersectionArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);

  // Calculate union area
  const unionArea = area1 + area2 - intersectionArea;

  // Calculate IoU
  return unionArea > 0 ? intersectionArea / unionArea : 0.0;
}

/**
 * Check if rect1 is fully contained within rect2
 */
export function isFullyContained(rect1: Rect, rect2: Rect): boolean {
  return (
    rect1.left >= rect2.left &&
    rect1.right <= rect2.right &&
    rect1.top >= rect2.top &&
    rect1.bottom <= rect2.bottom
  );
}

/**
 * Filter overlapping elements using weight and IoU
 */
export function filterOverlappingElements(
  elements: InteractiveElement[],
  iouThreshold: number = 0.7
): InteractiveElement[] {
  if (!elements || elements.length === 0) {
    return [];
  }

  // Sort by area (descending), then by weight (descending)
  elements.sort((a, b) => {
    const areaA = a.rect.width * a.rect.height;
    const areaB = b.rect.width * b.rect.height;

    if (areaB !== areaA) {
      return areaB - areaA; // Descending area
    }
    return b.weight - a.weight; // Descending weight
  });

  const filteredElements: InteractiveElement[] = [];

  // Add elements one by one, checking against already added elements
  for (const current of elements) {
    let shouldAdd = true;

    // For each element already in our filtered list
    for (let i = 0; i < filteredElements.length; i++) {
      const existing = filteredElements[i];

      // Check overlap with IoU
      const iou = calculateIou(current.rect, existing.rect);
      if (iou > iouThreshold) {
        shouldAdd = false;
        break;
      }

      // Check if current element is fully contained within an existing element with higher weight
      if (isFullyContained(current.rect, existing.rect)) {
        if (existing.weight >= current.weight && existing.zIndex === current.zIndex) {
          shouldAdd = false;
          break;
        } else {
          // If current element has higher weight and is more than 50% of the size of the existing element, remove the existing element
          if (current.rect.width * current.rect.height >= existing.rect.width * existing.rect.height * 0.5) {
            filteredElements.splice(i, 1);
            i--; // Adjust index after removal
            break;
          }
        }
      }
    }

    if (shouldAdd) {
      filteredElements.push(current);
    }
  }

  return filteredElements;
}

/**
 * Sort elements by position (top to bottom, left to right)
 */
export function sortElementsByPosition(elements: InteractiveElement[]): InteractiveElement[] {
  if (!elements || elements.length === 0) {
    return [];
  }

  // Define what "same row" means
  const ROW_THRESHOLD = 20; // pixels

  // First, group elements into rows based on Y position
  const rows: InteractiveElement[][] = [];
  let currentRow: InteractiveElement[] = [];

  // Copy and sort elements by Y position
  const sortedByY = [...elements].sort((a, b) => a.rect.top - b.rect.top);

  // Group into rows
  for (const element of sortedByY) {
    if (currentRow.length === 0) {
      // Start a new row
      currentRow.push(element);
    } else {
      // Check if this element is in the same row as the previous ones
      const lastElement = currentRow[currentRow.length - 1];
      if (Math.abs(element.rect.top - lastElement.rect.top) <= ROW_THRESHOLD) {
        // Same row
        currentRow.push(element);
      } else {
        // New row
        rows.push([...currentRow]);
        currentRow = [element];
      }
    }
  }

  // Add the last row if not empty
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  // Sort each row by X position (left to right)
  for (const row of rows) {
    row.sort((a, b) => a.rect.left - b.rect.left);
  }

  // Flatten the rows back into a single array
  const sortedElements = rows.flat();

  // Update the index property
  for (let i = 0; i < sortedElements.length; i++) {
    sortedElements[i].index = i;
  }

  return sortedElements;
}

/**
 * Combine interactive elements from multiple detection methods and filter duplicates
 */
export function filterElements(
  elements: InteractiveElement[],
  iouThreshold: number = 0.7
): InteractiveElement[] {
  // Filter overlapping elements
  const filtered = filterOverlappingElements(elements, iouThreshold);

  // Sort elements by position
  const sortedElements = sortElementsByPosition(filtered);

  return sortedElements;
}
