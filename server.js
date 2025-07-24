import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
  res.send('OK');
});

app.get('/chunk-count', (req, res) => {
  res.json({ count: gridChunks.size });
});

app.get('/revealed-stats', (req, res) => {
  let revealed = 0;
  let total = 0;
  for (const chunk of gridChunks.values()) {
    for (const row of chunk) {
      for (const cell of row) {
        total++;
        if (cell.revealed) revealed++;
      }
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
  for (const chunk of gridChunks.values()) {
    for (const row of chunk) {
      for (const cell of row) {
        if (cell.hasMine) totalMines++;
        if (cell.flagged) {
          flagged++;
          if (cell.hasMine) correctFlags++;
        }
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
  gridChunks.clear();
  res.json({ status: 'ok', message: 'All chunks cleared.' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

// --- Chunked grid storage ---
const CHUNK_SIZE = 100;
const GRID_WIDTH = 400;
const GRID_HEIGHT = 300;
const MINE_PERCENTAGE = 0.18;
const gridChunks = new Map(); // key: 'cx,cy' => chunkData

function createEmptyChunk(cx, cy) {
  const chunk = [];
  for (let y = 0; y < CHUNK_SIZE; y++) {
    const row = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
      row.push({
        x: cx * CHUNK_SIZE + x,
        y: cy * CHUNK_SIZE + y,
        revealed: false,
        hasMine: false,
        adjacentMines: 0,
        flagged: false,
      });
    }
    chunk.push(row);
  }
  return chunk;
}

function getChunkKey(cx, cy) {
  return `${cx},${cy}`;
}

function getOrCreateChunk(cx, cy) {
  const key = getChunkKey(cx, cy);
  if (!gridChunks.has(key)) {
    const chunk = createEmptyChunk(cx, cy);
    placeMinesInChunk(chunk);
    fillAdjacentCounts(chunk, cx, cy);
    gridChunks.set(key, chunk);
  }
  return gridChunks.get(key);
}

function placeMinesInChunk(chunk) {
  const totalCells = CHUNK_SIZE * CHUNK_SIZE;
  const mineCount = Math.round(totalCells * MINE_PERCENTAGE);
  let placed = 0;
  while (placed < mineCount) {
    const x = Math.floor(Math.random() * CHUNK_SIZE);
    const y = Math.floor(Math.random() * CHUNK_SIZE);
    if (!chunk[y][x].hasMine) {
      chunk[y][x].hasMine = true;
      placed++;
    }
  }
}

function fillAdjacentCounts(chunk, cx, cy) {
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      chunk[y][x].adjacentMines = countAdjacentMines(chunk, x, y, cx, cy);
    }
  }
}

function countAdjacentMines(chunk, x, y, cx, cy) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < CHUNK_SIZE && ny >= 0 && ny < CHUNK_SIZE) {
        if (chunk[ny][nx].hasMine) count++;
      } else {
        // Check neighbor chunk
        const n_cx = cx + Math.floor(nx / CHUNK_SIZE);
        const n_cy = cy + Math.floor(ny / CHUNK_SIZE);
        const n_chunk = gridChunks.get(getChunkKey(n_cx, n_cy));
        if (n_chunk) {
          const n_x = (nx + CHUNK_SIZE) % CHUNK_SIZE;
          const n_y = (ny + CHUNK_SIZE) % CHUNK_SIZE;
          if (n_chunk[n_y] && n_chunk[n_y][n_x] && n_chunk[n_y][n_x].hasMine) count++;
        }
      }
    }
  }
  return count;
}

let uniqueUsersEver = 0;
let bombsExploded = 0;

function revealCell(cx, cy, x, y) {
  const chunk = getOrCreateChunk(cx, cy);
  const cell = chunk[y][x];
  if (cell.revealed || cell.flagged) return [];
  const revealed = [];
  if (cell.adjacentMines === 0 && !cell.hasMine) {
    const visited = new Set();
    function flood(cx, cy, x, y) {
      const key = `${cx},${cy},${x},${y}`;
      if (visited.has(key)) return;
      visited.add(key);
      const chunk = getOrCreateChunk(cx, cy);
      const cell = chunk[y][x];
      if (cell.revealed || cell.flagged) return;
      cell.revealed = true;
      revealed.push({ cx, cy, x, y, cell });
      if (cell.adjacentMines === 0 && !cell.hasMine) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            let nx = x + dx;
            let ny = y + dy;
            let n_cx = cx;
            let n_cy = cy;
            if (nx < 0) { n_cx--; nx += CHUNK_SIZE; }
            if (ny < 0) { n_cy--; ny += CHUNK_SIZE; }
            if (nx >= CHUNK_SIZE) { n_cx++; nx -= CHUNK_SIZE; }
            if (ny >= CHUNK_SIZE) { n_cy++; ny -= CHUNK_SIZE; }
            if (n_cx < 0 || n_cy < 0 || n_cx * CHUNK_SIZE >= GRID_WIDTH || n_cy * CHUNK_SIZE >= GRID_HEIGHT) continue;
            const n_chunk = getOrCreateChunk(n_cx, n_cy);
            if (n_chunk && n_chunk[ny] && n_chunk[ny][nx]) {
              const n_cell = n_chunk[ny][nx];
              if (!n_cell.revealed && !n_cell.flagged && !n_cell.hasMine) {
                flood(n_cx, n_cy, nx, ny);
              }
            }
          }
        }
      }
    }
    flood(cx, cy, x, y);
  } else {
    if (cell.hasMine) bombsExploded++;
    cell.revealed = true;
    revealed.push({ cx, cy, x, y, cell });
  }
  return revealed;
}

// --- Socket.io events ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('user_connect', ({ token, firstTime }) => {
    if (firstTime) uniqueUsersEver++;
  });

  // Client requests a chunk
  socket.on('get_chunk', ({ cx, cy }) => {
    const chunk = getOrCreateChunk(cx, cy);
    socket.emit('chunk_data', { cx, cy, chunk });
  });

  // Client requests to reveal a cell
  socket.on('reveal_cell', ({ cx, cy, x, y }) => {
    const revealed = revealCell(cx, cy, x, y);
    // Broadcast revealed cells to all clients
    for (const r of revealed) {
      io.emit('cell_update', { cx: r.cx, cy: r.cy, x: r.x, y: r.y, cell: r.cell });
    }
  });

  // Client requests to flag/unflag a cell
  socket.on('flag_cell', ({ cx, cy, x, y }) => {
    const chunk = getOrCreateChunk(cx, cy);
    const cell = chunk[y][x];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    io.emit('cell_update', { cx, cy, x, y, cell });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 