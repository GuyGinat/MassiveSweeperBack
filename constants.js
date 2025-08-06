/**
 * Backend Constants
 *
 * This file contains all constants used throughout the MassiveSweeper backend.
 * Centralizing these values makes the codebase more maintainable and reduces magic numbers.
 */

// ============================================================================
// GRID & CHUNK CONFIGURATION
// ============================================================================

/** Size of each chunk in cells (width x height) */
export const CHUNK_SIZE = 100;

/** Total grid dimensions in cells */
export const GRID_WIDTH = 800;
export const GRID_HEIGHT = 700;

/** Percentage of cells that contain mines (0.17 = 17%) */
export const MINE_PERCENTAGE = 0.17;

// ============================================================================
// SERVER CONFIGURATION
// ============================================================================

/** Server port */
export const PORT = 3001;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a chunk key for storage
 * @param {number} cx - Chunk X coordinate
 * @param {number} cy - Chunk Y coordinate
 * @returns {string} Chunk key string
 */
export function getChunkKey(cx, cy) {
  return `${cx},${cy}`;
}

/**
 * Validate chunk coordinates
 * @param {number} cx - Chunk X coordinate
 * @param {number} cy - Chunk Y coordinate
 * @returns {boolean} True if coordinates are valid
 */
export function isValidChunkCoords(cx, cy) {
  return Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cy >= 0;
}

/**
 * Validate cell coordinates within a chunk
 * @param {number} x - Local X coordinate
 * @param {number} y - Local Y coordinate
 * @returns {boolean} True if coordinates are valid
 */
export function isValidCellCoords(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) &&
         x >= 0 && y >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE;
} 