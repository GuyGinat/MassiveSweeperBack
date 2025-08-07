import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { 
  CHUNK_SIZE, 
  GRID_WIDTH, 
  GRID_HEIGHT, 
  MINE_PERCENTAGE, 
  PORT,
  getChunkKey 
} from './constants.js';

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
  res.send('OK');
});

app.get('/grid-size', (req, res) => {
  res.json({ width: GRID_WIDTH, height: GRID_HEIGHT });
});

// Define all endpoints that depend on variables after they're declared
// (These will be set up after the variables are defined)

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

// Global variables
let completeGrid = null; // The complete grid state (source of truth)
let uniqueUsersEver = 0;
let bombsExploded = 0;

/**
 * Initialize the complete grid with mines and calculate all adjacent counts
 */
function initializeCompleteGrid() {
  console.log(`Initializing complete grid: ${GRID_WIDTH}x${GRID_HEIGHT}`);
  
  // Create the complete grid
  completeGrid = [];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      row.push({
        x: x,
        y: y,
        revealed: false,
        hasMine: false,
        adjacentMines: 0,
        flagged: false,
      });
    }
    completeGrid.push(row);
  }
  
  // Place mines across the entire grid
  placeMinesInCompleteGrid();
  
  // Calculate adjacent mine counts for all cells
  calculateAdjacentCountsForCompleteGrid();
  
  console.log('Complete grid initialized successfully');
  
  // Print initial grid state for debugging (small area)
  console.log('\n🎯 INITIAL GRID STATE (first 10x10 area):');
  printGridState(0, 0, 10, 10);
}

/**
 * Place mines randomly across the entire grid
 */
function placeMinesInCompleteGrid() {
  const totalCells = GRID_WIDTH * GRID_HEIGHT;
  const mineCount = Math.round(totalCells * MINE_PERCENTAGE);
  let placed = 0;
  
  console.log(`Placing ${mineCount} mines in ${totalCells} cells`);
  
  while (placed < mineCount) {
    const x = Math.floor(Math.random() * GRID_WIDTH);
    const y = Math.floor(Math.random() * GRID_HEIGHT);
    if (!completeGrid[y][x].hasMine) {
      completeGrid[y][x].hasMine = true;
      placed++;
    }
  }
  
  console.log(`Successfully placed ${placed} mines`);
}

/**
 * Calculate adjacent mine counts for all cells in the complete grid
 */
function calculateAdjacentCountsForCompleteGrid() {
  console.log('Calculating adjacent mine counts...');
  
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      completeGrid[y][x].adjacentMines = countAdjacentMinesInCompleteGrid(x, y);
    }
  }
  
  console.log('Adjacent mine counts calculated');
}

/**
 * Count adjacent mines for a cell in the complete grid
 */
function countAdjacentMinesInCompleteGrid(x, y) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      
      const nx = x + dx;
      const ny = y + dy;
      
      // Check bounds
      if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
        if (completeGrid[ny][nx].hasMine) count++;
      }
    }
  }
  return count;
}

/**
 * Get or create a chunk from the complete grid
 */
function getOrCreateChunk(cx, cy) {
  // Always extract fresh data from completeGrid instead of caching
  return extractChunkFromCompleteGrid(cx, cy);
}

/**
 * Extract a chunk from the complete grid
 */
function extractChunkFromCompleteGrid(cx, cy) {
  const chunk = [];
  const startX = cx * CHUNK_SIZE;
  const startY = cy * CHUNK_SIZE;
  
  for (let y = 0; y < CHUNK_SIZE; y++) {
    const row = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const gridX = startX + x;
      const gridY = startY + y;
      
      // Check if the cell is within the grid bounds
      if (gridX < GRID_WIDTH && gridY < GRID_HEIGHT) {  
        if (cx === 0 && cy === 0 && gridX === 0 && gridY === 0) {
          console.log('Cell is within bounds');
        }
        row.push({ ...completeGrid[gridY][gridX] });
      } else {
        // Create empty cell for out-of-bounds areas
        row.push({
          x: gridX,
          y: gridY,
          revealed: false,
          hasMine: false,
          adjacentMines: 0,
          flagged: false,
        });
      }
    }
    chunk.push(row);
  }
  
  return chunk;
}

function revealCell(cx, cy, x, y) {
  // Calculate global coordinates
  const globalX = cx * CHUNK_SIZE + x;
  const globalY = cy * CHUNK_SIZE + y;
  
  // Check bounds
  if (globalX < 0 || globalX >= GRID_WIDTH || globalY < 0 || globalY >= GRID_HEIGHT) {
    return [];
  }
  
  const cell = completeGrid[globalY][globalX];
  if (cell.revealed || cell.flagged) return [];
  
  const revealed = [];
  
  if (cell.adjacentMines === 0 && !cell.hasMine) {
    // Flood fill for empty cells
    const visited = new Set();
    function flood(globalX, globalY) {
      const key = `${globalX},${globalY}`;
      if (visited.has(key)) return;
      visited.add(key);
      
      const cell = completeGrid[globalY][globalX];
      if (cell.revealed || cell.flagged) return;
      
      cell.revealed = true;
      
      // Calculate chunk coordinates for the revealed cell
      const cellCx = Math.floor(globalX / CHUNK_SIZE);
      const cellCy = Math.floor(globalY / CHUNK_SIZE);
      const cellLocalX = globalX % CHUNK_SIZE;
      const cellLocalY = globalY % CHUNK_SIZE;
      
      revealed.push({ cx: cellCx, cy: cellCy, x: cellLocalX, y: cellLocalY, cell });
      
      if (cell.adjacentMines === 0 && !cell.hasMine) {
        // Check all 8 adjacent cells
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            
            const nx = globalX + dx;
            const ny = globalY + dy;
            
            // Check bounds
            if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
              const neighborCell = completeGrid[ny][nx];
              if (!neighborCell.revealed && !neighborCell.flagged && !neighborCell.hasMine) {
                flood(nx, ny);
              }
            }
          }
        }
      }
    }
    flood(globalX, globalY);
  } else {
    // Single cell reveal
    if (cell.hasMine) bombsExploded++;
    cell.revealed = true;
    revealed.push({ cx, cy, x, y, cell });
  }
  
  return revealed;
}

/**
 * Handle chord click (simultaneous left and right click) on a revealed number
 * Reveals all adjacent cells if the correct number of flags are placed
 */
function handleChordClick(cx, cy, x, y) {
  // Calculate global coordinates
  const globalX = cx * CHUNK_SIZE + x;
  const globalY = cy * CHUNK_SIZE + y;
  
  // Check bounds
  if (globalX < 0 || globalX >= GRID_WIDTH || globalY < 0 || globalY >= GRID_HEIGHT) {
    return [];
  }
  
  const cell = completeGrid[globalY][globalX];
  
  // Only allow chord clicks on revealed cells with numbers (adjacentMines > 0)
  if (!cell.revealed || cell.adjacentMines === 0) {
    return [];
  }
  
  // Count flags and revealed mines around this cell
  let flagCount = 0;
  let revealedMineCount = 0;
  const adjacentCells = [];
  
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      
      const nx = globalX + dx;
      const ny = globalY + dy;
      
      // Check bounds
      if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
        const neighborCell = completeGrid[ny][nx];
        if (neighborCell.flagged) {
          flagCount++;
        } else if (neighborCell.revealed && neighborCell.hasMine) {
          revealedMineCount++;
        } else if (!neighborCell.revealed) {
          adjacentCells.push({ x: nx, y: ny, cell: neighborCell });
        }
      }
    }
  }
  
  // If the total of flags + revealed mines matches the adjacent mine count, reveal all non-flagged adjacent cells
  if (flagCount + revealedMineCount === cell.adjacentMines) {
    const revealed = [];
    
    for (const { x: nx, y: ny, cell: neighborCell } of adjacentCells) {
      if (neighborCell.hasMine) {
        // Hit a mine - game over for this cell
        bombsExploded++;
        neighborCell.revealed = true;
        
        // Calculate chunk coordinates for the revealed cell
        const cellCx = Math.floor(nx / CHUNK_SIZE);
        const cellCy = Math.floor(ny / CHUNK_SIZE);
        const cellLocalX = nx % CHUNK_SIZE;
        const cellLocalY = ny % CHUNK_SIZE;
        
        revealed.push({ cx: cellCx, cy: cellCy, x: cellLocalX, y: cellLocalY, cell: neighborCell });
      } else {
        // Safe cell - reveal it and potentially flood fill
        const floodRevealed = revealCellWithFlood(nx, ny);
        revealed.push(...floodRevealed);
      }
    }
    
    return revealed;
  }
  
  // If flags don't match, do nothing (invalid chord click)
  return [];
}

/**
 * Reveal a cell and perform flood fill if needed
 */
function revealCellWithFlood(globalX, globalY) {
  const cell = completeGrid[globalY][globalX];
  if (cell.revealed || cell.flagged) return [];
  
  const revealed = [];
  
  if (cell.adjacentMines === 0 && !cell.hasMine) {
    // Flood fill for empty cells
    const visited = new Set();
    function flood(x, y) {
      const key = `${x},${y}`;
      if (visited.has(key)) return;
      visited.add(key);
      
      const cell = completeGrid[y][x];
      if (cell.revealed || cell.flagged) return;
      
      cell.revealed = true;
      
      // Calculate chunk coordinates for the revealed cell
      const cellCx = Math.floor(x / CHUNK_SIZE);
      const cellCy = Math.floor(y / CHUNK_SIZE);
      const cellLocalX = x % CHUNK_SIZE;
      const cellLocalY = y % CHUNK_SIZE;
      
      revealed.push({ cx: cellCx, cy: cellCy, x: cellLocalX, y: cellLocalY, cell });
      
      if (cell.adjacentMines === 0 && !cell.hasMine) {
        // Check all 8 adjacent cells
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            
            const nx = x + dx;
            const ny = y + dy;
            
            // Check bounds
            if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
              const neighborCell = completeGrid[ny][nx];
              if (!neighborCell.revealed && !neighborCell.flagged && !neighborCell.hasMine) {
                flood(nx, ny);
              }
            }
          }
        }
      }
    }
    flood(globalX, globalY);
  } else {
    // Single cell reveal
    cell.revealed = true;
    
    // Calculate chunk coordinates for the revealed cell
    const cellCx = Math.floor(globalX / CHUNK_SIZE);
    const cellCy = Math.floor(globalY / CHUNK_SIZE);
    const cellLocalX = globalX % CHUNK_SIZE;
    const cellLocalY = globalY % CHUNK_SIZE;
    
    revealed.push({ cx: cellCx, cy: cellCy, x: cellLocalX, y: cellLocalY, cell });
  }
  
  return revealed;
}

/**
 * Debug function to print the complete grid state in a visual format
 * @param {number} startX - Starting X coordinate (optional, defaults to 0)
 * @param {number} startY - Starting Y coordinate (optional, defaults to 0)
 * @param {number} width - Width of the area to print (optional, defaults to full grid)
 * @param {number} height - Height of the area to print (optional, defaults to full grid)
 */
function printGridState(startX = 0, startY = 0, width = GRID_WIDTH, height = GRID_HEIGHT) {
  if (!completeGrid) {
    console.log('❌ Grid not initialized yet');
    return;
  }

  const endX = Math.min(startX + width, GRID_WIDTH);
  const endY = Math.min(startY + height, GRID_HEIGHT);
  
  console.log(`\n🔍 GRID STATE DEBUG (${startX},${startY}) to (${endX-1},${endY-1})`);
  console.log('═'.repeat((endX - startX) * 2 + 3));
  
  // Print column headers
  let header = '   ';
  for (let x = startX; x < endX; x++) {
    header += `${x % 10} `;
  }
  console.log(header);
  console.log('  ┌' + '─'.repeat((endX - startX) * 2 - 1) + '┐');
  
  // Print grid rows
  for (let y = startY; y < endY; y++) {
    let row = `${y.toString().padStart(2)}│`;
    for (let x = startX; x < endX; x++) {
      const cell = completeGrid[y][x];
      let symbol = ' ';
      
      if (cell.flagged) {
        symbol = '🚩'; // Flag
      } else if (cell.revealed) {
        if (cell.hasMine) {
          symbol = '💣'; // Revealed mine
        } else if (cell.adjacentMines === 0) {
          symbol = '·'; // Empty revealed cell
        } else {
          symbol = cell.adjacentMines.toString(); // Number
        }
      } else {
        if (cell.hasMine) {
          symbol = '💣'; // Hidden mine (for debugging)
        } else {
          symbol = '█'; // Hidden cell
        }
      }
      
      row += `${symbol} `;
    }
    row += '│';
    console.log(row);
  }
  
  console.log('  └' + '─'.repeat((endX - startX) * 2 - 1) + '┘');
  console.log('═'.repeat((endX - startX) * 2 + 3));
  
  // Print legend
  console.log('📋 LEGEND:');
  console.log('  █ = Hidden cell');
  console.log('  · = Empty revealed cell');
  console.log('  🚩 = Flagged cell');
  console.log('  💣 = Mine (revealed or hidden)');
  console.log('  1-8 = Adjacent mine count');
  console.log('');
  
  // Print statistics for this area
  let stats = {
    total: 0,
    revealed: 0,
    flagged: 0,
    mines: 0,
    hidden: 0
  };
  
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const cell = completeGrid[y][x];
      stats.total++;
      if (cell.revealed) stats.revealed++;
      if (cell.flagged) stats.flagged++;
      if (cell.hasMine) stats.mines++;
      if (!cell.revealed && !cell.flagged) stats.hidden++;
    }
  }
  
  console.log(`📊 AREA STATS: ${stats.revealed}/${stats.total} revealed, ${stats.flagged} flagged, ${stats.mines} mines, ${stats.hidden} hidden`);
  console.log('');
}

/**
 * Debug function to print a specific chunk state
 * @param {number} cx - Chunk X coordinate
 * @param {number} cy - Chunk Y coordinate
 */
function printChunkState(cx, cy) {
  if (!completeGrid) {
    console.log('❌ Grid not initialized yet');
    return;
  }
  
  const startX = cx * CHUNK_SIZE;
  const startY = cy * CHUNK_SIZE;
  const endX = Math.min(startX + CHUNK_SIZE, GRID_WIDTH);
  const endY = Math.min(startY + CHUNK_SIZE, GRID_HEIGHT);
  
  console.log(`\n🔍 CHUNK STATE DEBUG (${cx},${cy}) - World coords: (${startX},${startY}) to (${endX-1},${endY-1})`);
  printGridState(startX, startY, endX - startX, endY - startY);
}

// --- Express endpoints that depend on variables ---
app.get('/chunk-count', (req, res) => {
  res.json({ count: 0 }); // No chunks to count
});

app.get('/revealed-stats', (req, res) => {
  let revealed = 0;
  let total = 0;
  
  // Use complete grid for accurate stats
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      total++;
      if (completeGrid[y][x].revealed) revealed++;
    }
  }
  
  res.json({
    revealed,
    total,
    percent: total > 0 ? (revealed / total) * 100 : 0,
    bombsExploded
  });
});

app.get('/flagged-stats', (req, res) => {
  let flagged = 0;
  let correctFlags = 0;
  let totalMines = 0;
  
  // Use complete grid for accurate stats
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const cell = completeGrid[y][x];
      if (cell.hasMine) totalMines++;
      if (cell.flagged) {
        flagged++;
        if (cell.hasMine) correctFlags++;
      }
    }
  }
  
  res.json({
    flagged,
    correctFlags,
    totalMines
  });
});

app.get('/active-users', (req, res) => {
  res.json({ count: io.engine.clientsCount, uniqueUsersEver });
});

app.post('/reset-chunks', (req, res) => {
  // No chunks to clear
  // Reinitialize the complete grid
  initializeCompleteGrid();
  res.json({ status: 'ok', message: 'All chunks cleared and grid reinitialized.' });
});

app.get('/test', (req, res) => {
  res.json({ status: 'ok', message: 'Test endpoint.' });
});

// Debug endpoints for grid state visualization
app.get('/debug/grid', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoints not available in production' });
  }
  
  const startX = parseInt(req.query.startX) || 0;
  const startY = parseInt(req.query.startY) || 0;
  const width = parseInt(req.query.width) || 20; // Default to 20x20 area
  const height = parseInt(req.query.height) || 20;
  
  printGridState(startX, startY, width, height);
  res.json({ 
    success: true, 
    message: `Printed grid state for area (${startX},${startY}) to (${startX+width-1},${startY+height-1})`,
    area: { startX, startY, width, height }
  });
});

app.get('/debug/chunk/:cx/:cy', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoints not available in production' });
  }
  
  const cx = parseInt(req.params.cx);
  const cy = parseInt(req.params.cy);
  
  printChunkState(cx, cy);
  res.json({ 
    success: true, 
    message: `Printed chunk state for chunk (${cx},${cy})`,
    chunk: { cx, cy }
  });
});

app.get('/debug/full-grid', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoints not available in production' });
  }
  
  printGridState(); // Print the entire grid
  res.json({ 
    success: true, 
    message: `Printed full grid state (${GRID_WIDTH}x${GRID_HEIGHT})`,
    gridSize: { width: GRID_WIDTH, height: GRID_HEIGHT }
  });
});

// Debug endpoint to reveal all cells (development only)
app.get('/reveal-all', (req, res) => {
  // Only allow in development
  console.log("revealing all cells");
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoint not available in production' });
  }
  
  try {
    let revealedCount = 0;
    
    // Iterate through the complete grid and reveal all cells
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = completeGrid[y][x];
        if (!cell.revealed && !cell.flagged) {
          cell.revealed = true;
          revealedCount++;
        }
      }
    }
    
    // Broadcast the updates to all connected clients
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = completeGrid[y][x];
        if (cell.revealed) {
          const cx = Math.floor(x / CHUNK_SIZE);
          const cy = Math.floor(y / CHUNK_SIZE);
          const localX = x % CHUNK_SIZE;
          const localY = y % CHUNK_SIZE;
          io.emit('cell_update', { cx, cy, x: localX, y: localY, cell });
        }
      }
    }
    
    console.log(`[DEBUG] Revealed ${revealedCount} cells`);
    res.json({ 
      success: true, 
      message: `Revealed ${revealedCount} cells`,
      revealedCount 
    });
  } catch (error) {
    console.error('[DEBUG] Error revealing all cells:', error);
    res.status(500).json({ error: 'Failed to reveal all cells' });
  }
});

// --- Socket.io events ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('user_connect', ({ token, firstTime }) => {
    if (firstTime) uniqueUsersEver++;
  });

  // Client requests a chunk
  socket.on('get_chunk', ({ cx, cy }) => {
    const chunk = getOrCreateChunk(cx, cy);
    // if (cx === 0 && cy === 0) {
    //   console.log('🔢 Revealed: x: 0, y: 0', chunk[0][0].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 1', chunk[0][1].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 2', chunk[0][2].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 3', chunk[0][3].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 4', chunk[0][4].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 5', chunk[0][5].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 6', chunk[0][6].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 7', chunk[0][7].revealed);
    //   console.log('🔢 Revealed: x: 0, y: 8', chunk[0][8].revealed);
    // }

    socket.emit('chunk_data', { cx, cy, chunk });
  });

  // Client requests to reveal a cell
  socket.on('reveal_cell', ({ cx, cy, x, y }) => {
    console.log(`[backend] Received reveal_cell:`, { cx, cy, x, y });
    const revealed = revealCell(cx, cy, x, y);
    console.log(`[backend] Revealed ${revealed.length} cells`);
    // Broadcast revealed cells to all clients
    for (const r of revealed) {
      io.emit('cell_update', { cx: r.cx, cy: r.cy, x: r.x, y: r.y, cell: r.cell });
    }
  });

  // Client requests to flag/unflag a cell
  socket.on('flag_cell', ({ cx, cy, x, y }) => {
    console.log(`[backend] Received flag_cell:`, { cx, cy, x, y });
    // Calculate global coordinates
    const globalX = cx * CHUNK_SIZE + x;
    const globalY = cy * CHUNK_SIZE + y;
    
    // Check bounds
    if (globalX < 0 || globalX >= GRID_WIDTH || globalY < 0 || globalY >= GRID_HEIGHT) {
      console.log(`[backend] Flag cell out of bounds:`, { globalX, globalY });
      return;
    }
    
    const cell = completeGrid[globalY][globalX];
    if (cell.revealed) {
      console.log(`[backend] Cannot flag revealed cell`);
      return;
    }
    cell.flagged = !cell.flagged;
    console.log(`[backend] Cell flagged:`, { flagged: cell.flagged });
    io.emit('cell_update', { cx, cy, x, y, cell });
  });

  // Client requests to chord click (simultaneous left and right click)
  socket.on('chord_click', ({ cx, cy, x, y }) => {
    const revealed = handleChordClick(cx, cy, x, y);
    // Broadcast revealed cells to all clients
    for (const r of revealed) {
      io.emit('cell_update', { cx: r.cx, cy: r.cy, x: r.x, y: r.y, cell: r.cell });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Initialize the complete grid when the server starts
initializeCompleteGrid();

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 