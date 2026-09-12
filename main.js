const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const defaultImageAdjustments = {
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  rotation: 0,
  brightness: 0,
  contrast: 0,
  shadows: 0,
  highlights: 0,
  grayscale: false
};

const defaultHeightMap = {
  layerCount: 12,
  layerHeight: 0.08,
  minHeight: 0.24,
  maxHeight: 1.2,
  invert: false
};

const defaultPalette = {
  ranges: [
    { id: 'palette-black', filamentId: 'black', endBand: 6 },
    { id: 'palette-white', filamentId: 'white', endBand: 12 }
  ]
};

const defaults = {
  project: {
    name: 'Untitled filament painting',
    notes: '',
    image: null,
    imageAdjustments: defaultImageAdjustments,
    heightMap: defaultHeightMap,
    palette: defaultPalette
  },
  inventory: [
    { id: 'black', brand: 'SUNLU', color: 'Black', material: 'PLA+', hex: '#15151a', td: '', grams: 1000 },
    { id: 'white', brand: 'SUNLU', color: 'White', material: 'PLA+', hex: '#f4f1e8', td: '', grams: 1000 }
  ],
  layers: [
    { id: 'base', name: 'Black base', color: '#15151a', thickness: 0.24, enabled: true },
    { id: 'highlight', name: 'White highlight', color: '#f4f1e8', thickness: 0.24, enabled: true }
  ],
  settings: { layerHeight: 0.08, printWidth: 200 },
  savedAt: null
};

const supportedImages = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp']
]);

const dataPath = () => path.join(app.getPath('userData'), 'filament-painting-lab.json');
const backupPath = () => path.join(app.getPath('userData'), 'filament-painting-lab.backup.json');
const imagesPath = () => path.join(app.getPath('userData'), 'images');

function clampNumber(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeRotation(value) {
  const rotation = Math.round(Number(value) / 90) * 90;
  return ((rotation % 360) + 360) % 360;
}

function normalizeImageAdjustments(adjustments) {
  return {
    cropTop: clampNumber(adjustments?.cropTop, 0, 45),
    cropRight: clampNumber(adjustments?.cropRight, 0, 45),
    cropBottom: clampNumber(adjustments?.cropBottom, 0, 45),
    cropLeft: clampNumber(adjustments?.cropLeft, 0, 45),
    rotation: normalizeRotation(adjustments?.rotation),
    brightness: clampNumber(adjustments?.brightness, -100, 100),
    contrast: clampNumber(adjustments?.contrast, -100, 100),
    shadows: clampNumber(adjustments?.shadows, -100, 100),
    highlights: clampNumber(adjustments?.highlights, -100, 100),
    grayscale: Boolean(adjustments?.grayscale)
  };
}

function normalizeHeightMap(settings) {
  const layerHeight = clampNumber(settings?.layerHeight, 0.02, 0.4, defaultHeightMap.layerHeight);
  const minHeight = clampNumber(settings?.minHeight, 0, 20, defaultHeightMap.minHeight);
  const requestedMaximum = clampNumber(settings?.maxHeight, 0, 40, defaultHeightMap.maxHeight);
  const maximumSteps = Math.max(1, Math.round((requestedMaximum - minHeight) / layerHeight));
  const maxHeight = Math.min(40, minHeight + maximumSteps * layerHeight);

  return {
    layerCount: Math.round(clampNumber(settings?.layerCount, 2, 64, defaultHeightMap.layerCount)),
    layerHeight,
    minHeight,
    maxHeight,
    invert: Boolean(settings?.invert)
  };
}

function normalizePalette(palette) {
  const source = Array.isArray(palette?.ranges) ? palette.ranges : defaultPalette.ranges;
  const ranges = source.slice(0, 64).map((range, index) => ({
    id: String(range?.id || `palette-${index + 1}`),
    filamentId: String(range?.filamentId || ''),
    endBand: Math.round(clampNumber(range?.endBand, 1, 64, index + 1))
  }));

  return { ranges };
}

function normalizeImage(image) {
  if (!image || typeof image !== 'object') return null;

  const storedName = path.basename(String(image.storedName || ''));
  const mime = String(image.mime || '');

  if (!storedName || !supportedImages.has(mime)) return null;

  return {
    storedName,
    originalName: String(image.originalName || storedName),
    mime,
    size: Math.max(0, Number(image.size) || 0),
    importedAt: image.importedAt || null
  };
}

function normalizeData(data) {
  return {
    project: {
      name: String(data?.project?.name ?? defaults.project.name),
      notes: String(data?.project?.notes ?? ''),
      image: normalizeImage(data?.project?.image),
      imageAdjustments: normalizeImageAdjustments(data?.project?.imageAdjustments),
      heightMap: normalizeHeightMap(data?.project?.heightMap),
      palette: normalizePalette(data?.project?.palette)
    },
    inventory: Array.isArray(data?.inventory) ? data.inventory : defaults.inventory,
    layers: Array.isArray(data?.layers) ? data.layers : defaults.layers,
    settings: {
      layerHeight: Number(data?.settings?.layerHeight) || defaults.settings.layerHeight,
      printWidth: Number(data?.settings?.printWidth) || defaults.settings.printWidth
    },
    savedAt: data?.savedAt ?? null
  };
}

function storedImagePath(image) {
  const normalized = normalizeImage(image);
  if (!normalized) throw new Error('Invalid stored-image record.');
  return path.join(imagesPath(), normalized.storedName);
}

async function readData(filePath) {
  return normalizeData(JSON.parse(await fs.readFile(filePath, 'utf8')));
}

async function saveData(data, options = {}) {
  const safe = normalizeData(data);
  safe.savedAt = new Date().toISOString();

  await fs.mkdir(path.dirname(dataPath()), { recursive: true });

  if (!options.skipBackup) {
    try {
      await fs.copyFile(dataPath(), backupPath());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const temporaryPath = `${dataPath()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(safe, null, 2), 'utf8');

  const verifiedTemporaryData = await readData(temporaryPath);
  await fs.copyFile(temporaryPath, dataPath());
  await fs.unlink(temporaryPath);

  const verifiedDiskData = await readData(dataPath());

  if (JSON.stringify(verifiedTemporaryData) !== JSON.stringify(verifiedDiskData)) {
    throw new Error('Saved data did not match the verified temporary copy.');
  }

  return {
    ok: true,
    data: verifiedDiskData,
    path: dataPath(),
    savedAt: verifiedDiskData.savedAt
  };
}

async function loadData() {
  try {
    return {
      ok: true,
      data: await readData(dataPath()),
      path: dataPath(),
      recovered: false
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      const created = await saveData(defaults, { skipBackup: true });
      return { ...created, recovered: false, created: true };
    }

    try {
      const backup = await readData(backupPath());
      const restored = await saveData(backup, { skipBackup: true });
      return { ...restored, recovered: true };
    } catch (backupError) {
      throw new Error(`Unable to load local data or its backup: ${error.message}`);
    }
  }
}

async function importImage(_event, payload) {
  const originalName = String(payload?.originalName || 'source-image');
  const mime = String(payload?.mime || '');
  const extension = supportedImages.get(mime);

  if (!extension) throw new Error('Choose a PNG, JPG, or WEBP image.');

  const bytes = payload?.bytes;
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);

  if (!buffer.length) throw new Error('The selected image was empty.');
  if (buffer.length > 40 * 1024 * 1024) throw new Error('The selected image is larger than 40 MB.');

  await fs.mkdir(imagesPath(), { recursive: true });

  const storedName = `source-${Date.now()}-${randomUUID()}${extension}`;
  const finalPath = path.join(imagesPath(), storedName);
  const temporaryPath = `${finalPath}.tmp`;

  await fs.writeFile(temporaryPath, buffer);
  const written = await fs.stat(temporaryPath);

  if (written.size !== buffer.length) {
    await fs.rm(temporaryPath, { force: true });
    throw new Error('The copied image did not pass verification.');
  }

  await fs.rename(temporaryPath, finalPath);

  return {
    ok: true,
    image: {
      storedName,
      originalName,
      mime,
      size: buffer.length,
      importedAt: new Date().toISOString()
    }
  };
}

async function readImage(_event, image) {
  const normalized = normalizeImage(image);
  if (!normalized) return { ok: false, missing: true };

  try {
    const buffer = await fs.readFile(storedImagePath(normalized));
    return {
      ok: true,
      dataUrl: `data:${normalized.mime};base64,${buffer.toString('base64')}`,
      image: normalized
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: false, missing: true };
    throw error;
  }
}

async function removeImage(_event, image) {
  const normalized = normalizeImage(image);
  if (!normalized) return { ok: true, removed: false };

  try {
    await fs.unlink(storedImagePath(normalized));
    return { ok: true, removed: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, removed: false };
    throw error;
  }
}

function safeExportName(value) {
  const cleaned = String(value || 'filament-painting')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || 'filament-painting';
}

async function exportHeightMap(_event, payload) {
  const dataUrl = String(payload?.dataUrl || '');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);

  if (!match) throw new Error('The height-map export was not a valid PNG.');

  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length) throw new Error('The height-map PNG was empty.');
  if (buffer.length > 100 * 1024 * 1024) throw new Error('The height-map PNG is larger than 100 MB.');

  const defaultName = `${safeExportName(payload?.projectName)}-height-map.png`;
  const result = await dialog.showSaveDialog({
    title: 'Export height-map PNG',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  await fs.writeFile(result.filePath, buffer);
  const written = await fs.stat(result.filePath);

  if (written.size !== buffer.length) {
    throw new Error('The exported height map did not pass verification.');
  }

  return { ok: true, path: result.filePath, size: written.size };
}

async function exportColorSchedule(_event, payload) {
  const text = String(payload?.text || '');
  if (!text.trim()) throw new Error('The color-change schedule was empty.');
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('The color-change schedule is larger than 1 MB.');

  const defaultName = `${safeExportName(payload?.projectName)}-color-change-schedule.txt`;
  const result = await dialog.showSaveDialog({
    title: 'Export color-change schedule',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Text document', extensions: ['txt'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  await fs.writeFile(result.filePath, text, 'utf8');
  const written = await fs.readFile(result.filePath, 'utf8');

  if (written !== text) throw new Error('The exported schedule did not pass verification.');

  return { ok: true, path: result.filePath, size: Buffer.byteLength(written, 'utf8') };
}

function openWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: '#090b10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('lab:load', loadData);
  ipcMain.handle('lab:save', (_event, data) => saveData(data));
  ipcMain.handle('lab:path', () => dataPath());
  ipcMain.handle('lab:image-import', importImage);
  ipcMain.handle('lab:image-read', readImage);
  ipcMain.handle('lab:image-remove', removeImage);
  ipcMain.handle('lab:heightmap-export', exportHeightMap);
  ipcMain.handle('lab:schedule-export', exportColorSchedule);
  openWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || openWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
